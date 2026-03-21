"""
RC Stable Audio Tools -- Portable RU
Генерация музыки и аудио по текстовому описанию

Авторы:
@Nerual Dreming - портативная версия, русификация
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

APP_NAME = "RC Stable Audio Tools"
APP_VERSION = "1.0"
DEFAULT_MODEL = "RoyalCities/Foundation-1"

# Доступные модели для скачивания
HF_MODELS = [
    "RoyalCities/Foundation-1",
    "RoyalCities/RC_Infinite_Pianos",
    "cocktailpeanut/stable-audio-open-1.0",
    "RoyalCities/Vocal_Textures_Main",
    "adlb/Audialab_EDM_Elements",
]

# Примеры промптов
EXAMPLE_PROMPTS = [
    "Synth Bass, Analog, Warm, Rich, Deep, Fat, Simple, Bassline",
    "Synth Lead, 303, Acid, Gritty, Arp, Fast Speed, Medium Reverb, Low Distortion",
    "Pad, Atmosphere, Dreamy, Wide, Soft, Warm, Silky, Sustained, Chord Progression",
    "Grand Piano, Bright, Clean, Rich, Chord Progression, Simple, Medium Reverb",
    "Violin, Bowed Strings, Intimate, Warm, Breathy, Melody, Rising, Slow Speed, High Reverb",
    "FM Bass, Sub Bass, Deep, Punchy, Crisp, Digital, Thick, Bassline, Choppy",
    "Kalimba, Mallet, Sparkly, Bright, Airy, Wide, Alternating, Arp, Medium Reverb",
    "Rhodes Piano, Warm, Smooth, Vintage, Round, Chord Progression, Low Reverb",
    "Supersaw, Synth Lead, Wide, Fat, Bright, Silky, Melody, Epic, High Reverb, Stereo Delay",
    "Acoustic Guitar, Warm, Woody, Intimate, Strummed, Chord Progression, Simple",
    "Choir, Formant Vocal, Dreamy, Wide, Spacey, Sustained, Dark, High Reverb, Ping Pong Delay",
    "Wavetable Bass, Acid, Overdriven, Gritty, Thick, Pitch Bend, Complex, Bassline, Low Distortion, Phaser",
    "Flute, Airy, Breathy, Soft, Melody, Catchy, Slow Speed, Medium Reverb",
    "Cello, Bowed Strings, Rich, Deep, Warm, Sustained, Melody, Rising, Low Reverb",
    "Harp, Plucked, Glassy, Bright, Shiny, Arp, Complex, Fast Speed, High Reverb",
    "Marimba, Mallet, Warm, Woody, Round, Punchy, Arp, Alternating, Low Delay",
    "Synth Lead, Wavetable Synth, Metallic, Crisp, Digital, Glassy, Top Melody, Fast Speed, Medium Delay",
    "Reese Bass, Sub Bass, Dark, Thick, Wide, Growl, Overdriven, Bassline, Phaser",
    "Hammond Organ, Vintage, Warm, Rich, Full, Chord Progression, Sustained, Low Distortion",
    "Music Box, Celesta, Glassy, Sparkly, Soft, Intimate, Melody, Simple, Slow Speed, High Reverb",
    "Trumpet, Brass, Smooth, Warm, Silky, Melody, Epic, Medium Reverb, Low Distortion",
    "Pluck, Synth, Crisp, Punchy, Bright, Digital, Arp, Rolling, Fast Speed, Ping Pong Delay",
    "Vibraphone, Mallet, Shiny, Warm, Spacey, Dreamy, Chord Progression, Medium Reverb, Stereo Delay",
    "FM Synth, Bell, Glassy, Metallic, Bright, Crisp, Arp, Complex, Medium Delay",
    "Electric Bass, Punchy, Clean, Focused, Tight, Bassline, Simple, Dry",
    "Fiddle, Bowed Strings, Intimate, Rich, Clean, Rolling, Arp, Fast Speed, Complex",
    "Synth Lead, Chiptune, Pulse Wave, Bitcrushed, Retro, Square, Melody, Catchy",
    "Pan Flute, Airy, Soft, Wide, Ambient, Spacey, Sustained, Melody, Slow Speed, High Reverb, Plate Reverb",
    "Glockenspiel, Mallet, Bright, Sparkly, Small, Crisp, Arp, Alternating, Medium Reverb",
    "Sub Bass, Wavetable Bass, Dark, Deep, Fat, Thick, Rumble, Sustained, Bassline, Low Phaser",
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

    # Убираем переводы строк из промпта — иначе они попадут в имя файла
    prompt = " ".join(prompt.split())
    if negative_prompt:
        negative_prompt = " ".join(negative_prompt.split())

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
    """Случайный промпт из списка примеров."""
    import random
    return random.choice(EXAMPLE_PROMPTS)


def add_to_editor(file_path, clips):
    """Добавляет сгенерированный файл в редактор."""
    if not file_path or not os.path.exists(str(file_path)):
        return clips, "Клипов в редакторе: " + str(len(clips)), "Нет файла для добавления"

    file_path = str(file_path)
    name = os.path.basename(file_path).rsplit(".", 1)[0][:50]
    clips = clips + [{"path": file_path, "name": name}]
    return clips, "Клипов в редакторе: " + str(len(clips)), "Добавлен: " + name


def prepare_editor_data(clips):
    """Подготавливает JSON с клипами для JS плеера."""
    data = []
    for clip in clips:
        path = clip["path"]
        if os.path.isfile(path):
            # Относительный путь от CWD (SCRIPT_DIR) — обходит проблему F:/ в URL
            rel = os.path.relpath(path, SCRIPT_DIR).replace("\\", "/")
            data.append({"url": "/gradio_api/file=" + rel, "name": clip["name"]})
        else:
            print(f"  [SKIP] {path}: file not found")
    return json.dumps(data)


# ============================================================
# JS для кастомного таймлайн-редактора
# ============================================================
EDITOR_INIT_JS = """
(clipsJson) => {
    const clips = JSON.parse(clipsJson);
    if (!clips || !clips.length) { return; }

    const container = document.getElementById('wp-container');
    if (!container) { return; }

    // Уничтожаем старый редактор
    if (window._timeline) {
        try { window._timeline.stop(); window._timeline.destroy(); } catch(e) {}
    }
    container.innerHTML = '';

    var editor = new TimelineEditor(container);
    window._timeline = editor;

    // Загрузка клипов — каждый на свой трек
    var loadPromises = clips.map(function(c, i) {
        return editor.loadClip(c.url, c.name, i, 0);
    });

    Promise.all(loadPromises).then(function() {
        console.log('[EDITOR] Loaded ' + clips.length + ' clips');
    }).catch(function(err) {
        console.error('[EDITOR] Load error:', err);
    });

    // Привязка тулбара
    var bar = document.getElementById('wp-toolbar');
    bar.querySelector('.wp-play').onclick = function() { editor.play(); };
    bar.querySelector('.wp-pause').onclick = function() { editor.pause(); };
    bar.querySelector('.wp-stop').onclick = function() { editor.stop(); };
    bar.querySelector('.wp-loop').onclick = function() {
        var on = editor.toggleLoop();
        this.classList.toggle('wp-active', on);
        if (on && !editor.isPlaying) editor.play();
    };
    bar.querySelector('.wp-zoomin').onclick = function() { editor.zoomIn(); };
    bar.querySelector('.wp-zoomout').onclick = function() { editor.zoomOut(); };
    bar.querySelector('.wp-export').onclick = function() { editor.exportWAV(); };
}
"""

EDITOR_ADD_CLIP_JS = """
(clipsJson) => {
    const clips = JSON.parse(clipsJson);
    if (!clips || !clips.length) { return; }

    // Задержка — вкладка только что переключилась, дать DOM отрисоваться
    setTimeout(function() {
        var container = document.getElementById('wp-container');
        if (!container) { console.error('[EDITOR] wp-container not found'); return; }

        // Если редактор уже есть — добавляем только последний клип
        if (window._timeline) {
            var last = clips[clips.length - 1];
            var trackIdx = window._timeline.tracks.length;
            window._timeline.loadClip(last.url, last.name, trackIdx, 0).then(function() {
                console.log('[EDITOR] Added clip: ' + last.name);
            }).catch(function(err) {
                console.error('[EDITOR] Add clip error:', err);
            });
            return;
        }

        // Создаём редактор с нуля
        container.innerHTML = '';
        var editor = new TimelineEditor(container);
        window._timeline = editor;

        var loadPromises = clips.map(function(c, i) {
            return editor.loadClip(c.url, c.name, i, 0);
        });
        Promise.all(loadPromises).then(function() {
            console.log('[EDITOR] Loaded ' + clips.length + ' clips');
        }).catch(function(err) {
            console.error('[EDITOR] Load error:', err);
        });

        // Привязка тулбара
        var bar = document.getElementById('wp-toolbar');
        bar.querySelector('.wp-play').onclick = function() { editor.play(); };
        bar.querySelector('.wp-pause').onclick = function() { editor.pause(); };
        bar.querySelector('.wp-stop').onclick = function() { editor.stop(); };
        bar.querySelector('.wp-loop').onclick = function() {
            var on = editor.toggleLoop();
            this.classList.toggle('wp-active', on);
            if (on && !editor.isPlaying) editor.play();
        };
        bar.querySelector('.wp-zoomin').onclick = function() { editor.zoomIn(); };
        bar.querySelector('.wp-zoomout').onclick = function() { editor.zoomOut(); };
        bar.querySelector('.wp-export').onclick = function() { editor.exportWAV(); };
    }, 200);
}
"""


def build_ui():
    """Строит Gradio UI."""

    css = """
    .gradio-container {max-width: none !important;}

    .main-header {
        background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
        padding: 1.5rem 2rem;
        border-radius: 15px;
        margin-bottom: 1rem;
        box-shadow: 0 10px 30px rgba(102, 126, 234, 0.2);
    }
    .main-header h1 {
        color: white;
        font-size: 2rem;
        font-weight: 700;
        margin: 0;
        text-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    .main-header p {
        color: rgba(255,255,255,0.9);
        margin: 0.5rem 0 0 0;
    }
    .main-header a {
        color: white !important;
        text-decoration: underline;
    }

    .tab-nav button {
        font-size: 1rem !important;
        padding: 0.75rem 1.5rem !important;
    }

    .prose {
        color: #e2e8f0 !important;
    }

    /* Editor */
    #wp-toolbar {
        margin-bottom: 8px;
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }
    #wp-toolbar button {
        background: #2a2a2a;
        color: #ccc;
        border: 1px solid #444;
        padding: 6px 14px;
        cursor: pointer;
        border-radius: 4px;
        font-size: 0.9rem;
    }
    #wp-toolbar button:hover { background: #3a3a3a; }
    #wp-toolbar button.wp-active {
        background: #667eea;
        color: #fff;
        border-color: #667eea;
    }
    #wp-container {
        min-height: 400px;
        background: #141414;
        border-radius: 8px;
        overflow: hidden;
    }
    """

    theme = gr.themes.Soft(
        font=[gr.themes.GoogleFont("Inter"), "Arial", "sans-serif"],
        primary_hue="indigo",
        secondary_hue="purple",
    )

    js = """
    () => {
        const url = new URL(window.location);
        if (url.searchParams.get('__theme') !== 'dark') {
            url.searchParams.set('__theme', 'dark');
            window.location.href = url.href;
        }
    }
    """

    editor_dir = os.path.join(SCRIPT_DIR, "editor")
    editor_rel = os.path.relpath(editor_dir, SCRIPT_DIR).replace("\\", "/")
    head = f"""
    <script src="/gradio_api/file={editor_rel}/timeline.js"></script>
    """

    with gr.Blocks(theme=theme, css=css, title=APP_NAME, js=js, head=head) as app:

        editor_clips = gr.State([])
        last_generated_path = gr.State(None)

        gr.HTML(f"""<div class="main-header">
<h1>{APP_NAME} v{APP_VERSION}</h1>
<p>Генерация музыки и аудио по текстовому описанию</p>
<p style="font-size:0.85rem; opacity:0.9; margin-top:0.5rem;">Собрал <a href="https://t.me/nerual_dreming" target="_blank">Nerual Dreming</a> — основатель <a href="https://artgeneration.me/" target="_blank">ArtGeneration.me</a>, техноблогер и нейро-евангелист.</p>
<p style="font-size:0.85rem; opacity:0.9; margin-top:0.3rem;"><a href="https://t.me/neuroport" target="_blank">Нейро-Софт</a> — репаки и портативки полезных нейросетей</p>
</div>""")

        with gr.Tabs() as main_tabs:
            # ==========================================
            # Вкладка 1: Генерация
            # ==========================================
            with gr.Tab("Генерация", id="tab_gen"):
                with gr.Row():
                    # Колонка 1: Управление
                    with gr.Column(scale=1):
                        with gr.Row():
                            bars = gr.Dropdown(label="Такты", choices=[4, 8], value=4)
                            bpm = gr.Dropdown(label="BPM", choices=list(range(60, 201, 5)), value=120)
                            note = gr.Dropdown(label="Тональность", choices=["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"], value="C")
                            scale_type = gr.Dropdown(label="Лад", choices=["major", "minor"], value="major")

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

                        import stable_audio_tools.interface.gradio as _sat
                        names, _ = scan_local_models()
                        _model_loaded = _sat.model is not None
                        _default = next((n for n in names if "Foundation" in n), names[0] if names else None)
                        model_status = gr.Textbox(
                            label="Статус модели",
                            value=f"Модель загружена ({_default})" if _model_loaded and _default else "Модель не загружена",
                            interactive=False,
                        )
                        model_dropdown = gr.Dropdown(
                            label="Выберите модель",
                            choices=names,
                            value=_default,
                        )
                        load_btn = gr.Button("Загрузить модель", variant="primary")

                        with gr.Accordion("Параметры генерации", open=False):
                            seed = gr.Number(label="Сид (-1 = случайный)", value=-1, precision=0)
                            sampler_type = gr.Dropdown(
                                label="Сэмплер",
                                choices=["dpmpp-3m-sde", "dpmpp-2m-sde", "k-heun", "k-lms",
                                         "k-dpmpp-2s-ancestral", "k-dpm-2", "k-dpm-fast"],
                                value="dpmpp-3m-sde",
                            )
                            with gr.Row():
                                steps = gr.Slider(label="Шаги", minimum=1, maximum=500, value=250, step=1)
                                cfg_scale = gr.Slider(label="CFG масштаб", minimum=0, maximum=25, value=7.0, step=0.1)
                            with gr.Row():
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

                        gr.Markdown("---")

                        gr.Markdown("### Примеры промптов")
                        gr.Examples(
                            examples=[[p] for p in EXAMPLE_PROMPTS],
                            inputs=[prompt],
                            label="",
                        )

                    # Колонка 2: Результат
                    with gr.Column(scale=1):
                        autoplay = gr.Checkbox(label="Автовоспроизведение", value=True)
                        output_audio = gr.Audio(label="Результат", type="filepath", autoplay=True)
                        add_to_editor_btn = gr.Button("Добавить в редактор", variant="secondary")
                        gen_status = gr.Textbox(label="Статус", interactive=False)
                        editor_info = gr.Markdown("Клипов в редакторе: 0")
                        spectrograms = gr.Gallery(label="Спектрограмма", columns=1, height=300)
                        piano_roll = gr.Image(label="MIDI пианоролл")
                        midi_file = gr.File(label="Скачать MIDI")

            # ==========================================
            # Вкладка 2: Загрузка моделей
            # ==========================================
            with gr.Tab("Загрузка моделей", id="tab_models"):
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

            # ==========================================
            # Вкладка 3: Редактор
            # ==========================================
            with gr.Tab("Редактор", id="tab_editor"):
                with gr.Row():
                    with gr.Column(scale=1):
                        editor_tab_info = gr.Markdown("Клипов в редакторе: 0")
                        load_editor_btn = gr.Button("Загрузить дорожки", variant="primary")
                        clear_editor_btn = gr.Button("Очистить редактор")
                        gr.Markdown("""---
### Управление
- **Перетаскивание** -- двигайте сегменты мышью
- **Alt+перетаскивание** -- копировать сегмент
- **Края сегмента** -- тяните за край для обрезки
- **Линия громкости** -- тяните вверх/вниз (до 200%)
- **Треугольники** -- fade-in / fade-out
- **Клик по линейке** -- переместить плейхед
- **Колесо мыши** -- прокрутка, Ctrl+колесо -- зум
- **Пробел** -- воспроизведение / пауза
- **Ctrl+C/V/X** -- копировать / вставить / вырезать
- **Delete** -- удалить выбранный сегмент
- **D** -- дублировать, **M** -- mute, **S** -- solo
- **X** -- удалить трек, **+/-** -- зум
""")
                    with gr.Column(scale=4):
                        editor_html = gr.HTML("""
<div id="wp-toolbar">
    <button class="wp-play">Воспроизвести</button>
    <button class="wp-pause">Пауза</button>
    <button class="wp-stop">Стоп</button>
    <button class="wp-loop">Цикл</button>
    <button class="wp-zoomin">Zoom +</button>
    <button class="wp-zoomout">Zoom -</button>
    <button class="wp-export">Экспорт WAV</button>
</div>
<div id="wp-container">
    <p style="color:#666; padding:2rem; text-align:center;">
        Добавьте клипы на вкладке "Генерация" — они появятся здесь автоматически
    </p>
</div>
""")

                editor_hidden = gr.Textbox(visible=False)

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

        def do_generate_wrap(prompt_val, negative_prompt_val, bars_val, bpm_val,
                             note_val, scale_val, cfg_scale_val, steps_val, seed_val,
                             sampler_type_val, sigma_min_val, sigma_max_val,
                             cfg_rescale_val, use_init_val, init_audio_val,
                             init_noise_level_val, autoplay_val):
            file_path, specs, pr, midi, status = do_generate(
                prompt_val, negative_prompt_val, bars_val, bpm_val,
                note_val, scale_val, cfg_scale_val, steps_val, seed_val,
                sampler_type_val, sigma_min_val, sigma_max_val,
                cfg_rescale_val, use_init_val, init_audio_val, init_noise_level_val,
            )
            return gr.update(value=file_path, autoplay=autoplay_val), specs, pr, midi, status, file_path

        generate_btn.click(
            fn=do_generate_wrap,
            inputs=[
                prompt, negative_prompt, bars, bpm, note, scale_type,
                cfg_scale, steps, seed, sampler_type, sigma_min, sigma_max,
                cfg_rescale, use_init, init_audio, init_noise_level, autoplay,
            ],
            outputs=[output_audio, spectrograms, piano_roll, midi_file, gen_status, last_generated_path],
        )

        def do_download(hf_id, custom_id):
            model_id = custom_id.strip() if custom_id and custom_id.strip() else hf_id
            return download_hf_model(model_id)

        download_btn.click(
            fn=do_download,
            inputs=[hf_model_dropdown, hf_model_custom],
            outputs=[download_status, model_dropdown, local_models_list],
        )

        # Редактор: добавить клип и сразу загрузить в таймлайн
        add_to_editor_btn.click(
            fn=add_to_editor,
            inputs=[last_generated_path, editor_clips],
            outputs=[editor_clips, editor_info, gen_status],
        ).then(
            fn=lambda clips: "Клипов в редакторе: " + str(len(clips)),
            inputs=[editor_clips],
            outputs=[editor_tab_info],
        ).then(
            fn=lambda: gr.update(selected="tab_editor"),
            outputs=[main_tabs],
        ).then(
            fn=prepare_editor_data,
            inputs=[editor_clips],
            outputs=[editor_hidden],
        ).then(
            fn=None,
            inputs=[editor_hidden],
            js=EDITOR_ADD_CLIP_JS,
        )

        # Редактор: загрузить дорожки
        load_editor_btn.click(
            fn=prepare_editor_data,
            inputs=[editor_clips],
            outputs=[editor_hidden],
        ).then(
            fn=None,
            inputs=[editor_hidden],
            js=EDITOR_INIT_JS,
        )

        # Редактор: очистить
        def do_clear_editor():
            return [], "Клипов в редакторе: 0", "Клипов в редакторе: 0"

        clear_editor_btn.click(
            fn=do_clear_editor,
            outputs=[editor_clips, editor_info, editor_tab_info],
        )

    return app


def ensure_and_load_model():
    """Скачивает модель по умолчанию если нет ни одной, загружает первую найденную."""
    names, _ = scan_local_models()
    if not names:
        print(f"  Моделей не найдено. Скачивание {DEFAULT_MODEL}...")
        try:
            snapshot_download(
                repo_id=DEFAULT_MODEL,
                local_dir=os.path.join(MODELS_DIR, DEFAULT_MODEL.replace("/", "_")),
                local_dir_use_symlinks=False,
            )
            print(f"  Модель {DEFAULT_MODEL} скачана!")
        except Exception as e:
            print(f"  Ошибка скачивания: {e}")
            return
        names, _ = scan_local_models()

    if names:
        target = next((n for n in names if "Foundation" in n), names[0])
        print(f"  Загрузка модели: {target}...")
        result = do_load_model(target)
        print(f"  {result}")


def main():
    torch.manual_seed(42)

    print("=" * 60)
    print(f"  {APP_NAME} v{APP_VERSION} -- Portable RU")
    print("  Генерация музыки и аудио по текстовому описанию")
    print("=" * 60)
    print()
    print(f"  Модели:     {MODELS_DIR}")
    print(f"  Генерации:  {GENERATIONS_DIR}")
    print()

    ensure_and_load_model()
    print()

    os.chdir(SCRIPT_DIR)

    app = build_ui()
    app.queue(default_concurrency_limit=1).launch(
        server_name="127.0.0.1",
        server_port=None,
        share=False,
        show_error=True,
        inbrowser=True,
        allowed_paths=[GENERATIONS_DIR, os.path.join(SCRIPT_DIR, "editor")],
    )


if __name__ == "__main__":
    main()
