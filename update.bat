@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

echo ========================================
echo   RC Stable Audio Tools - Обновление
echo ========================================
echo.

REM Обновляем портативную обёртку
where git >nul 2>&1
if errorlevel 1 (
    echo ОШИБКА: Git не найден!
    echo Установите Git: https://git-scm.com/downloads
    pause
    exit /b 1
)

if exist ".git" (
    echo Обновление портативной обёртки...
    git pull
    echo.
)

REM Обновляем библиотеку
if exist "RC-stable-audio-tools" (
    echo Обновление RC-stable-audio-tools...
    cd RC-stable-audio-tools
    git pull
    cd ..
    echo.
    echo Переустановка зависимостей...
    python\python.exe -m pip install -e RC-stable-audio-tools/ --no-warn-script-location
) else (
    echo ОШИБКА: RC-stable-audio-tools не найден!
    echo Запустите install.bat для установки.
)

echo.
echo Обновление завершено!
echo.
pause
