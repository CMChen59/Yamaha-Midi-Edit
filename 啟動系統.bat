@echo off
chcp 65001 >nul
title Yamaha PSR-SX920 Style & Pad 編輯器

cd /d "%~dp0"

echo ========================================================
echo   Yamaha PSR-SX920 STY & PAD 編輯系統 啟動程式
echo ========================================================
echo.

:: 檢查是否安裝依賴套件
if not exist "node_modules" (
    echo [提示] 首次執行，正在安裝相依套件，請稍候...
    call npm install
    if errorlevel 1 (
        echo [錯誤] 套件安裝失敗，請確認已安裝 Node.js。
        pause
        exit /b 1
    )
)

echo [啟動] 正在啟動本地伺服器並自動開啟瀏覽器...
echo 預設網址: http://localhost:5173
echo.
echo (若要停止程式，請關閉此黑色視窗即可)
echo --------------------------------------------------------

:: 啟動 Vite 並自動打開瀏覽器
call npx vite --open

pause
