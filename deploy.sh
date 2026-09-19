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

# 5. Konfigurasi Layanan PM2
echo "⚙️ Mengkonfigurasi PM2 Process Manager..."

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
echo "✅ DEPLOYMENT SERVER BERHASIL DILAKUKAN!"
echo "📡 Gateway Route         : http://43.173.33.116:8080"
echo "⚙️ Admin Control Panel   : http://43.173.33.116:8080/admin"
echo "🏖️ Maintenance Preview   : http://43.173.33.116:8080/preview/maintenance"
echo "🌐 Direct Portfolio Web  : http://43.173.33.116:3000"
echo "========================================================"
