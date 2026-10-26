@chcp 65001 >nul
@echo off
cls
title Yamaha PSR-SX920 伴奏風格創作台 (V2)
cd /d "%~dp0"

echo ========================================================
echo   Yamaha PSR-SX920 伴奏風格 (STY) 與多重擊墊 (PAD) 創作台
echo                       V2 專屬獨立版
echo ========================================================
echo.
echo [1/2] 正在為您開啟創作工作台網頁...
echo 網址: http://localhost:5173
echo.
echo [2/2] 正在啟動 Vite 本地伺服器...
echo (若要關閉系統，直接關閉此黑色視窗即可)
echo --------------------------------------------------------

start http://localhost:5173
call npx vite --host --port 5173
