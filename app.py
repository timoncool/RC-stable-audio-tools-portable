"""
RC Stable Audio Tools — Portable RU
Генерация музыки и аудио по текстовому описанию

Авторы:
@Nerual Dreaming - портативная версия, русификация
Нейро-Софт (t.me/neuroport) - репаки и портативки полезных нейросетей
Оригинал: RoyalCities/RC-stable-audio-tools
Модель: Stable Audio (Stability AI)
"""

import os
import sys
import asyncio

# ============================================================
# Windows: патч файлового ввода-вывода с повторными попытками
# Решает проблему блокировки файлов антивирусами на Windows
# ============================================================
if sys.platform == "win32":
    import functools

    def _retry_open(original_open):
        @functools.wraps(original_open)
        async def wrapper(*args, **kwargs):
            last_error = None
            for attempt in range(20):
                try:
                    return await original_open(*args, **kwargs)
                except PermissionError as e:
                    last_error = e
                    delay = 0.2 * (1.2 ** attempt)
                    await asyncio.sleep(delay)
            raise last_error
        return wrapper

    try:
        import anyio
        anyio.open_file = _retry_open(anyio.open_file)
    except ImportError:
        pass

    try:
        import aiofiles.threadpool
        aiofiles.threadpool._open = _retry_open(aiofiles.threadpool._open)
    except (ImportError, AttributeError):
        pass

import json

# ============================================================
# Конфигурация — ОБЯЗАТЕЛЬНО ДО импорта stable_audio_tools!
# Библиотека читает config.json при загрузке модуля.
# ============================================================
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(SCRIPT_DIR, "RC-stable-audio-tools", "config.json")
MODELS_DIR = os.path.join(SCRIPT_DIR, "models")
GENERATIONS_DIR = os.path.join(SCRIPT_DIR, "generations")

os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(GENERATIONS_DIR, exist_ok=True)

if os.path.exists(CONFIG_PATH):
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config = json.load(f)
    config["models_directory"] = MODELS_DIR
    config["generations_directory"] = GENERATIONS_DIR
else:
    config = {
        "models_directory": MODELS_DIR,
        "generations_directory": GENERATIONS_DIR,
        "hffs": [{
            "path": MODELS_DIR,
            "options": [
                "RoyalCities/Foundation-1",
                "RoyalCities/RC_Infinite_Pianos",
                "cocktailpeanut/stable-audio-open-1.0",
                "RoyalCities/Vocal_Textures_Main",
                "adlb/Audialab_EDM_Elements"
            ]
        }]
    }

with open(os.path.join(SCRIPT_DIR, "config.json"), "w", encoding="utf-8") as f:
    json.dump(config, f, indent=4, ensure_ascii=False)

# ============================================================
# Теперь безопасно импортировать библиотеку
# ============================================================
import torch
from stable_audio_tools.interface.gradio import create_ui


def main():
    torch.manual_seed(42)

    print("=" * 60)
    print("  RC Stable Audio Tools -- Portable RU")
    print("  Генерация музыки и аудио по текстовому описанию")
    print("=" * 60)
    print()
    print(f"  Модели:     {MODELS_DIR}")
    print(f"  Генерации:  {GENERATIONS_DIR}")
    print()

    # Используем create_ui из библиотеки
    # Передаем model_half=True для экономии VRAM
    interface = create_ui(model_half=True)

    interface.queue(default_concurrency_limit=1).launch(
        server_name="127.0.0.1",
        server_port=None,
        share=False,
        show_error=True,
        inbrowser=True,
    )


if __name__ == "__main__":
    main()
