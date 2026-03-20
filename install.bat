@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo   RC Stable Audio Tools - Portable RU
echo   Установщик портативной версии
echo ========================================
echo.

REM Определяем директорию скрипта
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

REM Локальные temp директории
set "TEMP=%SCRIPT_DIR%temp"
set "TMP=%SCRIPT_DIR%temp"

REM Создаем необходимые директории
if not exist "python" mkdir python
if not exist "downloads" mkdir downloads
if not exist "temp" mkdir temp
if not exist "models" mkdir models
if not exist "cache" mkdir cache
if not exist "generations" mkdir generations

echo [1/7] Выбор версии CUDA для вашей видеокарты...
echo.
echo Выберите поколение вашей видеокарты Nvidia:
echo.
echo 1. GTX 10xx серия (Pascal) - CUDA 11.8
echo 2. RTX 20xx серия (Turing) - CUDA 11.8
echo 3. RTX 30xx серия (Ampere) - CUDA 12.6
echo 4. RTX 40xx серия (Ada Lovelace) - CUDA 12.8
echo 5. RTX 50xx серия (Blackwell) - CUDA 12.8
echo 6. CPU only (без GPU, медленнее)
echo.
set /p GPU_CHOICE="Введите номер (1-6): "

if "%GPU_CHOICE%"=="1" (
    set "CUDA_VERSION=cu118"
    set "CUDA_NAME=CUDA 11.8"
    set "TORCH_VERSION=2.7.1"
    set "TORCHAUDIO_VERSION=2.7.1"
)
if "%GPU_CHOICE%"=="2" (
    set "CUDA_VERSION=cu118"
    set "CUDA_NAME=CUDA 11.8"
    set "TORCH_VERSION=2.7.1"
    set "TORCHAUDIO_VERSION=2.7.1"
)
if "%GPU_CHOICE%"=="3" (
    set "CUDA_VERSION=cu126"
    set "CUDA_NAME=CUDA 12.6"
    set "TORCH_VERSION=2.7.1"
    set "TORCHAUDIO_VERSION=2.7.1"
)
if "%GPU_CHOICE%"=="4" (
    set "CUDA_VERSION=cu128"
    set "CUDA_NAME=CUDA 12.8"
    set "TORCH_VERSION=2.7.1"
    set "TORCHAUDIO_VERSION=2.7.1"
)
if "%GPU_CHOICE%"=="5" (
    set "CUDA_VERSION=cu128"
    set "CUDA_NAME=CUDA 12.8 (совместимо с RTX 50xx)"
    set "TORCH_VERSION=2.7.1"
    set "TORCHAUDIO_VERSION=2.7.1"
)
if "%GPU_CHOICE%"=="6" (
    set "CUDA_VERSION=cpu"
    set "CUDA_NAME=CPU only"
    set "TORCH_VERSION=2.8.0"
    set "TORCHAUDIO_VERSION=2.8.0"
)

if not defined CUDA_VERSION (
    echo Неверный выбор! Установка прервана.
    pause
    exit /b 1
)

echo.
echo Выбрано: %CUDA_NAME%
echo PyTorch: %TORCH_VERSION%
echo TorchAudio: %TORCHAUDIO_VERSION%
echo.
pause

REM Проверяем наличие Python
if exist "python\python.exe" (
    echo [2/7] Python уже установлен, пропускаем загрузку...
) else (
    echo [2/7] Загрузка Python 3.10.11 Embeddable...
    powershell -Command "& {[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.10.11/python-3.10.11-embed-amd64.zip' -OutFile 'downloads\python-3.10.11-embed-amd64.zip'}"

    if not exist "downloads\python-3.10.11-embed-amd64.zip" (
        echo Ошибка загрузки Python!
        pause
        exit /b 1
    )

    echo Распаковка Python...
    powershell -Command "& {Expand-Archive -Path 'downloads\python-3.10.11-embed-amd64.zip' -DestinationPath 'python' -Force}"
)

REM Настраиваем Python для использования pip
echo [3/7] Настройка Python...
cd python

REM Патч python310._pth для включения site-packages
if exist "python310._pth" (
    echo import site> python310._pth.new
    echo.>> python310._pth.new
    echo python310.zip>> python310._pth.new
    echo .>> python310._pth.new
    echo ..\Lib\site-packages>> python310._pth.new
    move /y python310._pth.new python310._pth >nul
)

cd ..

REM Устанавливаем pip
if exist "python\Scripts\pip.exe" (
    echo pip уже установлен
) else (
    echo Установка pip...
    powershell -Command "& {[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile 'downloads\get-pip.py'}"
    python\python.exe downloads\get-pip.py --no-warn-script-location
)

REM Обновляем pip и ставим setuptools<70 (для pkg_resources, нужен librosa)
echo Обновление pip и setuptools...
python\python.exe -m pip install --upgrade pip "setuptools<70" --no-warn-script-location

echo [4/7] Установка PyTorch %TORCH_VERSION% с %CUDA_NAME%...
python\python.exe -m pip install torch==%TORCH_VERSION% torchaudio==%TORCHAUDIO_VERSION% --index-url https://download.pytorch.org/whl/%CUDA_VERSION% --no-warn-script-location

echo [5/7] Клонирование RC-stable-audio-tools...
if exist "RC-stable-audio-tools" (
    echo Репозиторий уже склонирован, пропускаем...
) else (
    where git >nul 2>&1
    if errorlevel 1 (
        echo ОШИБКА: Git не найден!
        echo Установите Git: https://git-scm.com/downloads
        pause
        exit /b 1
    )
    git clone https://github.com/RoyalCities/RC-stable-audio-tools.git
    if errorlevel 1 (
        echo ОШИБКА: Не удалось склонировать репозиторий!
        pause
        exit /b 1
    )
)

echo [6/7] Установка зависимостей...
python\python.exe -m pip install -e RC-stable-audio-tools/ --no-warn-script-location
if errorlevel 1 (
    echo ОШИБКА: Не удалось установить зависимости!
    pause
    exit /b 1
)

echo [6.5/7] Установка Flash Attention 2 (опционально)...
echo.
echo Flash Attention 2 ускоряет генерацию!
echo Рекомендуется для RTX 30xx/40xx/50xx серий.
echo.

REM Устанавливаем flash-attn в зависимости от GPU
if "%GPU_CHOICE%"=="3" (
    echo Установка Flash Attention 2 для RTX 30xx...
    python\python.exe -m pip install https://huggingface.co/lldacing/flash-attention-windows-wheel/resolve/main/flash_attn-2.7.4+cu126torch2.6.0cxx11abiFALSE-cp310-cp310-win_amd64.whl --no-warn-script-location
    if errorlevel 1 (
        echo Не удалось установить Flash Attention 2. Приложение будет работать без него.
    ) else (
        echo Flash Attention 2 установлен успешно!
    )
)
if "%GPU_CHOICE%"=="4" (
    echo Установка Flash Attention 2 для RTX 40xx...
    python\python.exe -m pip install https://huggingface.co/lldacing/flash-attention-windows-wheel/resolve/main/flash_attn-2.7.4.post1+cu128torch2.7.0cxx11abiFALSE-cp310-cp310-win_amd64.whl --no-warn-script-location
    if errorlevel 1 (
        echo Не удалось установить Flash Attention 2. Приложение будет работать без него.
    ) else (
        echo Flash Attention 2 установлен успешно!
    )
)
if "%GPU_CHOICE%"=="5" (
    echo Установка Flash Attention 2 для RTX 50xx...
    python\python.exe -m pip install https://huggingface.co/lldacing/flash-attention-windows-wheel/resolve/main/flash_attn-2.7.4.post1+cu128torch2.7.0cxx11abiFALSE-cp310-cp310-win_amd64.whl --no-warn-script-location
    if errorlevel 1 (
        echo Не удалось установить Flash Attention 2. Приложение будет работать без него.
    ) else (
        echo Flash Attention 2 установлен успешно!
    )
)
if "%GPU_CHOICE%"=="1" (
    echo Flash Attention 2 не рекомендуется для GTX 10xx
)
if "%GPU_CHOICE%"=="2" (
    echo Flash Attention 2 не рекомендуется для RTX 20xx
)
if "%GPU_CHOICE%"=="6" (
    echo Flash Attention 2 пропущен - CPU mode
)

echo.

echo [7/7] Финализация установки...
REM Создаем конфигурационный файл с версией CUDA
echo %CUDA_VERSION%> cuda_version.txt

echo.
echo ========================================
echo   Установка завершена успешно!
echo ========================================
echo.
echo Структура папок:
echo   models\       - кэш моделей HuggingFace
echo   generations\  - сгенерированные аудио файлы
echo   temp\         - временные файлы
echo   cache\        - кэш приложения
echo.
echo Для запуска приложения используйте: run.bat
echo.
pause
