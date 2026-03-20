# RC Stable Audio Tools — Portable RU

Портативная русскоязычная версия [RC-stable-audio-tools](https://github.com/RoyalCities/RC-stable-audio-tools) для Windows.

Генерация музыки и аудио по текстовому описанию с помощью Stable Audio.

## Возможности

- Генерация музыки по текстовому промпту
- Выбор BPM, тональности, количества тактов
- AI стилизация (Style Transfer)
- MIDI-экспорт + визуализация пианоролла
- Спектрограмма
- Загрузка моделей из HuggingFace прямо в интерфейсе

## Системные требования

| Компонент | Минимум | Рекомендуется |
|-----------|---------|---------------|
| OS | Windows 10 x64 | Windows 11 x64 |
| GPU | GTX 1060 6GB | RTX 3060 12GB+ |
| RAM | 8 GB | 16 GB |
| Диск | 5 GB | 10 GB |
| Git | Обязательно | - |

## Совместимость видеокарт

| Серия | CUDA | Поддержка |
|-------|------|-----------|
| GTX 10xx (Pascal) | 11.8 | Базовая |
| RTX 20xx (Turing) | 11.8 | Базовая |
| RTX 30xx (Ampere) | 12.6 | + Flash Attention 2 |
| RTX 40xx (Ada) | 12.8 | + Flash Attention 2 |
| RTX 50xx (Blackwell) | 12.8 | + Flash Attention 2 |

## Установка

1. Установите [Git](https://git-scm.com/downloads) если ещё не установлен
2. Скачайте архив из [Releases](../../releases) или клонируйте репозиторий:
   ```
   git clone https://github.com/timoncool/RC-stable-audio-tools-portable.git
   ```
3. Запустите `install.bat`
4. Выберите вашу видеокарту
5. Дождитесь завершения установки

## Запуск

Запустите `run.bat` — приложение откроется в браузере автоматически.

При первом запуске выберите и скачайте модель в интерфейсе (вкладка "Download Models").

## Обновление

Запустите `update.bat` для обновления приложения и библиотеки.

## Структура папок

```
RC-stable-audio-tools-portable/
├── app.py              — основной файл приложения
├── install.bat          — установщик
├── run.bat              — запуск
├── update.bat           — обновление
├── python/              — портативный Python (создаётся при установке)
├── RC-stable-audio-tools/ — библиотека (клонируется при установке)
├── models/              — модели HuggingFace
├── generations/         — сгенерированные аудио
├── cache/               — кэш
└── temp/                — временные файлы
```

## Полная изоляция

Приложение полностью изолировано:
- Портативный Python 3.10.11 (не требует установки в систему)
- Все модели, кэш и временные файлы хранятся в папке приложения
- Не загрязняет системные директории
- Можно перенести на другой компьютер простым копированием

## Доступные модели

- **Foundation-1** — универсальная генерация музыки
- **RC Infinite Pianos** — фортепианная музыка
- **Stable Audio Open 1.0** — открытая модель
- **Vocal Textures Main** — вокальные текстуры
- **Audialab EDM Elements** — EDM элементы

## Авторы

- **@Nerual Dreaming** — портативная версия
- **Нейро-Софт** ([t.me/neuroport](https://t.me/neuroport)) — репаки нейросетей
- **RoyalCities** — оригинальный проект RC-stable-audio-tools
- **Stability AI** — модель Stable Audio
