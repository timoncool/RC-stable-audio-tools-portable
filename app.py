"""
RC Stable Audio Tools -- Portable RU
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
import gc

# ============================================================
# Конфигурация -- ОБЯЗАТЕЛЬНО ДО импорта stable_audio_tools!
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
# Импорт библиотеки
# ============================================================
import torch
import gradio as gr
import numpy as np
from huggingface_hub import snapshot_download

from stable_audio_tools.interface.gradio import (
    load_model,
    generate_cond,
    get_models_and_configs,
    get_config_files,
    load_model_action,
)

# Доступные модели для скачивания
HF_MODELS = [
    "RoyalCities/Foundation-1",
    "RoyalCities/RC_Infinite_Pianos",
    "cocktailpeanut/stable-audio-open-1.0",
    "RoyalCities/Vocal_Textures_Main",
    "adlb/Audialab_EDM_Elements",
]


def scan_local_models():
    """Сканирует папку models/ на наличие скачанных моделей."""
    ckpt_files = get_models_and_configs(MODELS_DIR)
    names = [name for name, path in ckpt_files]
    return names, ckpt_files


def download_hf_model(model_id, progress=gr.Progress()):
    """Скачивает модель из HuggingFace в папку models/."""
    if not model_id:
        return "Выберите модель для скачивания", gr.update(), gr.update()

    progress(0, desc=f"Скачивание {model_id}...")
    try:
        snapshot_download(
            repo_id=model_id,
            local_dir=os.path.join(MODELS_DIR, model_id.replace("/", "_")),
            local_dir_use_symlinks=False,
        )
        progress(1, desc="Готово!")

        # Обновляем список моделей
        names, _ = scan_local_models()
        return (
            f"Модель {model_id} скачана!",
            gr.update(choices=names, value=names[0] if names else None),
            gr.update(choices=names, value=names[0] if names else None),
        )
    except Exception as e:
        return f"Ошибка скачивания: {e}", gr.update(), gr.update()


def do_load_model(selected_ckpt):
    """Загружает выбранную модель."""
    if not selected_ckpt:
        return "Сначала выберите модель"

    names, ckpt_files = scan_local_models()
    try:
        ckpt_path = next(path for name, path in ckpt_files if name == selected_ckpt)
        configs = get_config_files(ckpt_path)
        if not configs:
            return "Конфигурация модели не найдена"

        config_path = os.path.join(os.path.dirname(ckpt_path), configs[0])
        with open(config_path, "r") as f:
            model_config = json.load(f)

        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        if device.type == "cuda":
            try:
                preferred_dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
            except Exception:
                preferred_dtype = torch.float16
        else:
            preferred_dtype = torch.float32

        load_model(
            model_config=model_config,
            model_ckpt_path=ckpt_path,
            device=device,
            preferred_dtype=preferred_dtype,
        )
        return f"Модель {selected_ckpt} загружена на {device} ({preferred_dtype})"
    except Exception as e:
        return f"Ошибка загрузки: {e}"


def do_generate(prompt, negative_prompt, bars, bpm, note, scale,
                cfg_scale, steps, seed, sampler_type, sigma_min, sigma_max,
                cfg_rescale, use_init, init_audio, init_noise_level):
    """Генерация аудио."""
    from stable_audio_tools.interface.gradio import model as current_model
    if current_model is None:
        return None, [], None, None, "Сначала загрузите модель!"

    try:
        result = generate_cond(
            prompt=prompt,
            negative_prompt=negative_prompt if negative_prompt else None,
            bars=int(bars),
            bpm=int(bpm),
            note=note,
            scale=scale,
            cfg_scale=float(cfg_scale),
            steps=int(steps),
            preview_every=0,
            seed=int(seed),
            sampler_type=sampler_type,
            sigma_min=float(sigma_min),
            sigma_max=float(sigma_max),
            cfg_rescale=float(cfg_rescale),
            use_init=use_init,
            init_audio=init_audio,
            init_noise_level=float(init_noise_level),
        )
        file_path, spectrograms, piano_roll, midi_path = result
        return file_path, spectrograms, piano_roll, midi_path, f"Готово! Сохранено: {os.path.basename(file_path)}"
    except Exception as e:
        return None, [], None, None, f"Ошибка генерации: {e}"


def random_prompt():
    """Случайный промпт из генератора библиотеки."""
    from stable_audio_tools.interface.gradio import current_prompt_generator
    try:
        return current_prompt_generator()
    except Exception:
        prompts = [
            "ambient electronic music with soft pads and reverb",
            "energetic drum and bass with heavy bassline",
            "calm piano melody with strings accompaniment",
            "lo-fi hip hop beat with vinyl crackle",
            "epic orchestral soundtrack with brass and percussion",
            "smooth jazz with saxophone solo",
            "dark techno with industrial synths",
        ]
        import random
        return random.choice(prompts)


def build_ui():
    """Строит Gradio UI на русском языке."""

    with gr.Blocks(
        title="RC Stable Audio Tools -- Portable RU",
        theme=gr.themes.Base(primary_hue="orange"),
    ) as app:

        gr.Markdown("# RC Stable Audio Tools -- Portable RU")
        gr.Markdown("Генерация музыки и аудио по текстовому описанию")

        with gr.Tabs():
            # ==========================================
            # Вкладка 1: Генерация
            # ==========================================
            with gr.Tab("Генерация"):
                with gr.Row():
                    # Колонка 1: Управление
                    with gr.Column(scale=1):
                        model_status = gr.Textbox(
                            label="Статус модели",
                            value="Модель не загружена",
                            interactive=False,
                        )

                        names, _ = scan_local_models()
                        model_dropdown = gr.Dropdown(
                            label="Выберите модель",
                            choices=names,
                            value=names[0] if names else None,
                        )
                        load_btn = gr.Button("Загрузить модель", variant="primary")

                        gr.Markdown("---")

                        prompt = gr.Textbox(
                            label="Промпт",
                            placeholder="Опишите желаемую музыку на английском...",
                            lines=3,
                        )
                        negative_prompt = gr.Textbox(
                            label="Негативный промпт",
                            placeholder="Что исключить...",
                            lines=1,
                        )

                        with gr.Row():
                            generate_btn = gr.Button("Генерировать", variant="primary", scale=3)
                            random_btn = gr.Button("Случайный промпт", scale=1)

                        gr.Markdown("---")

                        with gr.Row():
                            bars = gr.Dropdown(
                                label="Такты",
                                choices=[4, 8],
                                value=4,
                            )
                            bpm = gr.Dropdown(
                                label="BPM",
                                choices=list(range(60, 201, 5)),
                                value=120,
                            )

                        with gr.Row():
                            note = gr.Dropdown(
                                label="Тональность",
                                choices=["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"],
                                value="C",
                            )
                            scale_type = gr.Dropdown(
                                label="Лад",
                                choices=["major", "minor"],
                                value="major",
                            )

                        seed = gr.Number(label="Сид (-1 для случайного)", value=-1, precision=0)

                        with gr.Accordion("Параметры сэмплера", open=False):
                            steps = gr.Slider(label="Шаги", minimum=1, maximum=500, value=75, step=1)
                            cfg_scale = gr.Slider(label="CFG масштаб", minimum=0, maximum=25, value=7.0, step=0.1)
                            sampler_type = gr.Dropdown(
                                label="Сэмплер",
                                choices=["dpmpp-3m-sde", "dpmpp-2m-sde", "k-heun", "k-lms",
                                         "k-dpmpp-2s-ancestral", "k-dpm-2", "k-dpm-fast"],
                                value="dpmpp-3m-sde",
                            )
                            sigma_min = gr.Slider(label="Sigma min", minimum=0, maximum=2, value=0.03, step=0.01)
                            sigma_max = gr.Slider(label="Sigma max", minimum=0, maximum=1000, value=500, step=1)
                            cfg_rescale = gr.Slider(label="CFG rescale", minimum=0, maximum=1, value=0, step=0.01)

                        with gr.Accordion("AI Стилизация", open=False):
                            use_init = gr.Checkbox(label="Использовать исходное аудио", value=False)
                            init_audio = gr.Audio(label="Исходное аудио", type="numpy")
                            init_noise_level = gr.Slider(
                                label="Уровень шума",
                                minimum=0, maximum=1, value=0.7, step=0.01,
                            )

                    # Колонка 2: Результат
                    with gr.Column(scale=1):
                        output_audio = gr.Audio(label="Результат", type="filepath")
                        gen_status = gr.Textbox(label="Статус", interactive=False)
                        spectrograms = gr.Gallery(label="Спектрограмма", columns=1, height=300)
                        piano_roll = gr.Image(label="MIDI пианоролл")
                        midi_file = gr.File(label="Скачать MIDI")

            # ==========================================
            # Вкладка 2: Загрузка моделей
            # ==========================================
            with gr.Tab("Загрузка моделей"):
                gr.Markdown("## Скачивание моделей из HuggingFace")
                gr.Markdown("Выберите модель и нажмите 'Скачать'. После скачивания модель появится на вкладке 'Генерация'.")

                hf_model_dropdown = gr.Dropdown(
                    label="Модель HuggingFace",
                    choices=HF_MODELS,
                    value=HF_MODELS[0],
                )
                hf_model_custom = gr.Textbox(
                    label="Или введите ID модели вручную",
                    placeholder="user/model-name",
                )
                download_btn = gr.Button("Скачать модель", variant="primary")
                download_status = gr.Textbox(label="Статус скачивания", interactive=False)

                gr.Markdown("---")
                gr.Markdown("### Скачанные модели")
                local_models_list = gr.Dropdown(
                    label="Локальные модели",
                    choices=names,
                    interactive=False,
                )

        # Футер
        gr.Markdown(
            "---\n"
            "**RC Stable Audio Tools -- Portable RU** | "
            "[@Nerual Dreaming](https://t.me/neuroport) | "
            "[GitHub](https://github.com/timoncool/RC-stable-audio-tools-portable) | "
            "Оригинал: [RoyalCities/RC-stable-audio-tools](https://github.com/RoyalCities/RC-stable-audio-tools)"
        )

        # ==========================================
        # Привязка событий
        # ==========================================

        load_btn.click(
            fn=do_load_model,
            inputs=[model_dropdown],
            outputs=[model_status],
        )

        random_btn.click(
            fn=random_prompt,
            outputs=[prompt],
        )

        generate_btn.click(
            fn=do_generate,
            inputs=[
                prompt, negative_prompt, bars, bpm, note, scale_type,
                cfg_scale, steps, seed, sampler_type, sigma_min, sigma_max,
                cfg_rescale, use_init, init_audio, init_noise_level,
            ],
            outputs=[output_audio, spectrograms, piano_roll, midi_file, gen_status],
        )

        def do_download(hf_id, custom_id):
            model_id = custom_id.strip() if custom_id and custom_id.strip() else hf_id
            return download_hf_model(model_id)

        download_btn.click(
            fn=do_download,
            inputs=[hf_model_dropdown, hf_model_custom],
            outputs=[download_status, model_dropdown, local_models_list],
        )

    return app


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

    app = build_ui()
    app.queue(default_concurrency_limit=1).launch(
        server_name="127.0.0.1",
        server_port=None,
        share=False,
        show_error=True,
        inbrowser=True,
    )


if __name__ == "__main__":
    main()
