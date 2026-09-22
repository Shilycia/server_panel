#!/usr/bin/env bash
# ========================================================
# shilycia's DEV — Automatic Server Deployment & PM2 Setup
# Host: Helipod.io Cloud (Ubuntu 24.04 LTS)
# ========================================================
set -e

# ========================================================
# ENVIRONMENT VARIABLES & CONFIG
# ========================================================
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "${SCRIPT_DIR}/.env" ]; then
    set -a
    . "${SCRIPT_DIR}/.env"
    set +a
fi

DOMAIN="${DOMAIN:-nadyakhiarapurnomo.my.id}"
SERVER_IP="${SERVER_IP:-43.173.33.116}"
BASE_DIR="${BASE_DIR:-/var/www}"
PANEL_DIR="${PANEL_DIR:-${BASE_DIR}/server_panel}"
PORTO_DIR="${WORKSPACE_DIR:-${PORTO_DIR:-${BASE_DIR}/prototype_porto}}"
NGINX_CONF="${NGINX_CONF:-/etc/nginx/sites-available/shilycia-gateway}"
NGINX_ENABLED="${NGINX_ENABLED:-/etc/nginx/sites-enabled/shilycia-gateway}"

echo "========================================================"
echo "🚀 Memulai Deployment shilyciaDEV Gateway & Portfolio..."
echo "========================================================"

# 0. Pre-flight checks
for cmd in git node npm pm2 nginx curl; do
  if ! command -v $cmd &> /dev/null; then
      echo "❌ Error: $cmd belum terinstall atau tidak ada di PATH."
      if [ "$cmd" = "pm2" ]; then
          echo "📦 Menginstall PM2 process manager secara global..."
          sudo npm install -g pm2
      else
          exit 1
      fi
  fi
done

sudo mkdir -p "${BASE_DIR}"
# Hanya ubah ownership direktori yang diperlukan, bukan seluruh /var/www secara membabi buta
sudo chown -R $USER:$USER "${PANEL_DIR}" 2>/dev/null || true
sudo chown -R $USER:$USER "${PORTO_DIR}" 2>/dev/null || true

# 1. Setup / Update server_panel
if [ -d "${PANEL_DIR}/.git" ]; then
    echo "🔄 Memperbarui server_panel..."
    cd "${PANEL_DIR}"
    PREV_PANEL_COMMIT=$(git rev-parse HEAD)
    git pull origin main
else
    echo "📥 Mengklon server_panel dari GitHub..."
    git clone https://github.com/Shilycia/server_panel.git "${PANEL_DIR}"
    cd "${PANEL_DIR}"
    PREV_PANEL_COMMIT=$(git rev-parse HEAD)
fi

echo "📦 Memasang dependensi server_panel (npm ci)..."
npm ci

# 2. Setup / Update prototype_porto
if [ -d "${PORTO_DIR}/.git" ]; then
    echo "🔄 Memperbarui prototype_porto..."
    cd "${PORTO_DIR}"
    PREV_PORTO_COMMIT=$(git rev-parse HEAD)
    git pull origin main
else
    echo "📥 Mengklon prototype_porto dari GitHub..."
    git clone https://github.com/Shilycia/prototype_porto.git "${PORTO_DIR}"
    cd "${PORTO_DIR}"
    PREV_PORTO_COMMIT=$(git rev-parse HEAD)
fi

# 3. Build portfolio-web (cek memory & tambahkan swap bila sangat perlu)
echo "🔨 Membangun portfolio-web (Next.js)..."
cd "${PORTO_DIR}/portfolio-web"
npm ci

# Cek RAM sebelum build (opsional/informasi)
FREE_MEM=$(free -m | awk '/^Mem:/{print $4}')
echo "ℹ️  Free Memory: ${FREE_MEM}MB"

NODE_OPTIONS="--max-old-space-size=1536" npm run build

# 4. Konfigurasi Nginx
echo "🌐 Mengkonfigurasi Nginx untuk routing via Gateway..."
sudo cp "${PANEL_DIR}/nginx-gateway.conf" "${NGINX_CONF}"

if [ -f /etc/nginx/sites-enabled/default ]; then
    sudo rm -f /etc/nginx/sites-enabled/default
fi

if [ ! -L "${NGINX_ENABLED}" ]; then
    sudo ln -sf "${NGINX_CONF}" "${NGINX_ENABLED}"
fi

if sudo nginx -t; then
    sudo systemctl reload nginx
else
    echo "❌ Nginx config error! Periksa ${NGINX_CONF}"
    exit 1
fi

# 5. Konfigurasi Layanan PM2
echo "⚙️  Mengkonfigurasi PM2 Process Manager..."

# Start menggunakan ecosystem jika ada, atau fallback
cd "${PANEL_DIR}"
if [ -f "ecosystem.config.js" ]; then
    WORKSPACE_DIR="${PORTO_DIR}" pm2 start ecosystem.config.js
else
    WORKSPACE_DIR="${PORTO_DIR}" pm2 start server.js --name "server-panel" --update-env
    cd "${PORTO_DIR}/portfolio-web"
    pm2 start npm --name "portfolio-web" -- start
fi

pm2 save

# 6. PM2 Startup (hanya jika belum terkonfigurasi, tapi aman dijalankan ulang - ini mencetak command sudo)
# Jalankan pm2 startup dan langsung evaluasi perintahnya.
echo "🔄 Menerapkan PM2 Startup script untuk reboot..."
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u $USER --hp /home/$USER || true

# 7. Health Check
echo "🩺 Melakukan Health Check pada Gateway Server..."
sleep 3
if curl -s -f http://127.0.0.1:8080/preview/maintenance > /dev/null; then
    echo "✅ Health check berhasil! Server online."
else
    echo "❌ Health check gagal! Melakukan rollback..."
    cd "${PANEL_DIR}"
    git reset --hard ${PREV_PANEL_COMMIT}
    npm ci
    cd "${PORTO_DIR}"
    git reset --hard ${PREV_PORTO_COMMIT}
    cd portfolio-web && npm ci && npm run build
    
    cd "${PANEL_DIR}"
    WORKSPACE_DIR="${PORTO_DIR}" pm2 restart ecosystem.config.js || pm2 restart server-panel
    
    echo "⚠️ Rollback selesai. Aplikasi kembali ke state sebelumnya."
    exit 1
fi

echo "========================================================"
echo "✅ DEPLOYMENT BERHASIL!"
echo ""
echo "🌐 Domain        : http://${DOMAIN}"
echo "📡 Gateway IP    : http://${SERVER_IP}"
echo "========================================================"
