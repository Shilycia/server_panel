# shilyciaDEV Gateway & Control Panel

Sebuah panel kontrol dan reverse proxy gateway berbasis Node.js yang berfungsi mengelola portofolio dan proyek-proyek terkait. Panel ini berjalan di port lokal 8080 dan disambungkan secara transparan oleh Nginx. 

## Arsitektur
* **Node.js (Express)**: Pusat routing cerdas dan panel manajemen proyek.
* **Nginx**: Reverse Proxy and rate limiter.
* **PM2**: Daemon process manager untuk menjaga kelancaran aplikasi.
* **Keamanan**: Implementasi `helmet`, CSRF Protection berbasis origin, brute-force protection dengan `express-rate-limit`, dan hashing password `bcrypt`.

## Syarat Instalasi (VPS)
1. OS Ubuntu 24.04 LTS (disarankan)
2. Node.js & npm (v20+ disarankan)
3. Nginx
4. Git
5. UFW, Certbot & Fail2ban (untuk level jaringan)

## Instalasi dan Setup
1. Clone repositori ini:
   ```bash
   git clone https://github.com/Shilycia/server_panel.git /var/www/server_panel
   cd /var/www/server_panel
   ```
2. Salin template `.env`:
   ```bash
   cp .env.example .env
   # Silakan edit file .env sesuai kebutuhan
   ```
3. Install dependensi:
   ```bash
   npm ci
   ```
4. Eksekusi script otomatis (Akan membangun gateway, Nginx, & service PM2):
   ```bash
   ./deploy.sh
   ```

## Variabel Lingkungan (.env)
Variabel ini dibaca oleh aplikasi dan skrip bash:
* `PORT`: Port lokal aplikasi Node.js berjalan (default 8080)
* `NODE_ENV`: Lingkungan aplikasi (default `production`)
* `WORKSPACE_DIR`: Root path untuk instalasi multiple project

## Kontribusi & Keamanan
Aplikasi ini menerapkan standar operasional yang ketat termasuk perlindungan injeksi shell dan kontrol akses ke direktori kerja spesifik.
