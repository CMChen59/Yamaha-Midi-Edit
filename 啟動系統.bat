@echo off
chcp 65001 >nul
title Yamaha PSR-SX920 伴奏與打擊墊編輯器
cd /d "%~dp0"

echo ========================================================
echo   Yamaha PSR-SX920 STY ^& PAD 編輯器啟動程式
echo ========================================================
echo.
echo [啟動中] 正在開啟本地伺服器與瀏覽器...
echo 網址: http://localhost:5173
echo.
echo (若要關閉程式，直接關閉此黑色視窗即可)
echo --------------------------------------------------------

start http://localhost:5173
call npx vite --host --port 5173
