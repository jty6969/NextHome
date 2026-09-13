@echo off
chcp 65001 >nul
title Nexthome AI 购房助手
cd /d "%~dp0"
echo ================================================
echo   Nexthome AI 购房助手
echo   http://127.0.0.1:3000
echo   关闭此窗口即停止服务器
echo ================================================
echo.
start "" http://127.0.0.1:3000
node server.js
pause
