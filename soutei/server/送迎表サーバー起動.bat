@echo off
rem デイサービス送迎表 保存サーバー
rem このファイルをダブルクリックすると起動します。
rem 終わるときは、開いた黒い画面で Ctrl + C を押すか、画面を閉じてください。

chcp 65001 > nul
cd /d "%~dp0"
title Soutei Server

where node > nul 2>&1
if errorlevel 1 (
  echo.
  echo Node.js not found.
  echo Please install Node.js LTS from https://nodejs.org/ja/ and run this file again.
  echo.
  echo Node.js  がインストールされていません。
  echo https://nodejs.org/ja/  から LTS 版を入れてから、もう一度このファイルを開いてください。
  echo.
  pause
  exit /b 1
)

node soutei-server.js

echo.
echo Server stopped. サーバーが止まりました。この画面は閉じて構いません。
pause
