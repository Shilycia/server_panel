#!/usr/bin/env bash
# ========================================================
# shilycia's DEV — Automatic Server Deployment & PM2 Setup
# Host: Helipod.io Cloud (Ubuntu 24.04 LTS)
# ========================================================
set -e

echo "========================================================"
echo "🚀 Memulai Deployment shilyciaDEV Gateway & Portfolio..."
echo "========================================================"

BASE_DIR="/var/www"
PANEL_DIR="${BASE_DIR}/server_panel"
PORTO_DIR="${BASE_DIR}/prototype_porto"
NGINX_CONF="/etc/nginx/sites-available/shilycia-gateway"
NGINX_ENABLED="/etc/nginx/sites-enabled/shilycia-gateway"

# 1. Pastikan PM2 terpasang
if ! command -v pm2 &> /dev/null; then
    echo "📦 Menginstall PM2 process manager secara global..."
    sudo npm install -g pm2
fi

sudo mkdir -p "${BASE_DIR}"
sudo chown -R $USER:$USER "${BASE_DIR}"

# 2. Setup / Update server_panel
if [ -d "${PANEL_DIR}/.git" ]; then
    echo "🔄 Memperbarui server_panel..."
    cd "${PANEL_DIR}"
    git pull origin main
else
    echo "📥 Mengklon server_panel dari GitHub..."
    git clone https://github.com/Shilycia/server_panel.git "${PANEL_DIR}"
    cd "${PANEL_DIR}"
fi

echo "📦 Memasang dependensi server_panel..."
npm install

# 3. Setup / Update prototype_porto
if [ -d "${PORTO_DIR}/.git" ]; then
    echo "🔄 Memperbarui prototype_porto..."
    cd "${PORTO_DIR}"
    git pull origin main
else
    echo "📥 Mengklon prototype_porto dari GitHub..."
    git clone https://github.com/Shilycia/prototype_porto.git "${PORTO_DIR}"
    cd "${PORTO_DIR}"
fi

# 4. Build portfolio-web
echo "🔨 Membangun portfolio-web (Next.js)..."
cd "${PORTO_DIR}/portfolio-web"
npm install
NODE_OPTIONS="--max-old-space-size=1536" npm run build

# 5. Konfigurasi Nginx — arahkan semua domain ke gateway port 8080
echo "🌐 Mengkonfigurasi Nginx untuk routing via Gateway..."

# Hapus config lama yang mungkin langsung proxy ke port 3000
if sudo nginx -T 2>/dev/null | grep -q "proxy_pass http://127.0.0.1:3000"; then
    echo "⚠️  Ditemukan Nginx config lama yang bypass gateway (→:3000). Akan diganti..."
fi

# Tulis config baru dari repo ke sites-available
sudo cp "${PANEL_DIR}/nginx-gateway.conf" "${NGINX_CONF}"

# Hapus symlink default yang mungkin konflik
if [ -f /etc/nginx/sites-enabled/default ]; then
    sudo rm -f /etc/nginx/sites-enabled/default
    echo "   ✓ Removed default nginx site"
fi

# Aktifkan config gateway
if [ ! -L "${NGINX_ENABLED}" ]; then
    sudo ln -sf "${NGINX_CONF}" "${NGINX_ENABLED}"
    echo "   ✓ Nginx gateway config enabled"
fi

# Test & reload nginx
if sudo nginx -t; then
    sudo systemctl reload nginx
    echo "   ✓ Nginx reloaded successfully"
else
    echo "❌ Nginx config error! Periksa ${NGINX_CONF}"
    exit 1
fi

# 6. Konfigurasi Layanan PM2
echo "⚙️  Mengkonfigurasi PM2 Process Manager..."

# Start / Restart Portfolio Web
cd "${PORTO_DIR}/portfolio-web"
if pm2 describe "portfolio-web" > /dev/null 2>&1; then
    pm2 restart "portfolio-web"
else
    pm2 start npm --name "portfolio-web" -- start
fi

# Start / Restart Server Panel Gateway
cd "${PANEL_DIR}"
if pm2 describe "server-panel" > /dev/null 2>&1; then
    pm2 restart "server-panel"
else
    WORKSPACE_DIR="${PORTO_DIR}" pm2 start server.js --name "server-panel"
fi

pm2 save

echo "========================================================"
echo "✅ DEPLOYMENT BERHASIL!"
echo ""
echo "🌐 Domain        : http://nadyakhiarapurnomo.my.id"
echo "📡 Gateway IP    : http://43.173.33.116"
echo "⚙️  Admin Panel   : http://nadyakhiarapurnomo.my.id/admin"
echo "🔑 Login         : http://nadyakhiarapurnomo.my.id/login"
echo "🏖️  Maintenance   : http://nadyakhiarapurnomo.my.id/preview/maintenance"
echo "🔨 Building      : http://nadyakhiarapurnomo.my.id/preview/building"
echo ""
echo "📋 Semua traffic nadyakhiarapurnomo.my.id melewati"
echo "   gateway port 8080 — status panel langsung berlaku!"
echo "========================================================"
