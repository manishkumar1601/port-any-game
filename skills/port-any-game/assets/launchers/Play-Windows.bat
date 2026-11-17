@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve-windows.ps1"
if errorlevel 1 pause
