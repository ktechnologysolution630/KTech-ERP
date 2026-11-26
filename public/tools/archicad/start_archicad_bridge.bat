@echo off
chcp 65001 >nul
cd /d "%~dp0"
title KTech ERP - Archicad
where python >nul 2>nul
if errorlevel 1 (
  echo ไม่พบ Python ในเครื่องนี้ ติดตั้งจาก https://www.python.org/downloads/ แล้วรันใหม่
  pause
  exit /b 1
)
python ktec_archicad_bridge.py
pause
