@echo off
title shilycia's DEV - Project Control Panel & Gateway
color 0b
echo ==========================================================
echo        shilycia's DEV - GATEWAY ROUTER & ADMIN PANEL
echo ==========================================================
echo.
echo Menjalankan server kontrol pada port 8080...
echo.
echo Akses Gateway Publik : http://localhost:8080
echo Akses Admin Panel    : http://localhost:8080/admin
echo Pratinjau Maintenance: http://localhost:8080/preview/maintenance
echo.
echo Tekan Ctrl+C untuk menghentikan server.
echo ==========================================================
node server.js
pause
