#!/usr/bin/env python3
"""
Готовит картинки образов для приложения из «сырья» в src/assets/skins/*/ (то, что скачано или нарисовано).
Запуск из корня репозитория: python3 scripts/skin-art/build.py   (нужны Pillow и numpy; логотипы клубов см. rasterize.cjs)

Что получается (всё в src/assets/skins/art/, webp):
  <образ>-hero.webp   640×320, фон карточки «Всего» на главной. Левая часть плавно уходит в прозрачность (под ней цвет карточки),
                      а яркость каждой точки ограничена (LCAP): белый текст поверх всегда читается (контраст не меньше 4,5).
  <образ>-mark.webp   256×256, водяной знак в углу карточки (герб).
  <образ>-thumb.webp  112×112, миниатюра образа в «Настройки → Оформление».
Файлы грузятся только у тех, кто выбрал образ, и в офлайн-кэш (precache) не попадают: webp нет в globPatterns у vite.config.ts.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'src' / 'assets' / 'skins'
OUT = SRC / 'art'
TMP = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('/tmp/skin-art')  # сюда rasterize.cjs кладёт гербы из SVG
OUT.mkdir(parents=True, exist_ok=True)

W, H = 640, 320
# Предел яркости (относительной, 0..1) любой точки картинки. Карточка «Всего» — градиент, на котором белый текст даёт контраст ≥ 4,5:
# у фона яркость не выше 0,183. Смесь двух цветов не ярче, чем смесь их яркостей, поэтому при пределе 0,17 текст читается поверх любой точки.
LCAP = 0.17


def to_linear(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(c: np.ndarray) -> np.ndarray:
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def cap_luminance(im: Image.Image, cap: float = LCAP) -> Image.Image:
    a = np.asarray(im.convert('RGBA'), dtype=np.float64) / 255
    lin = to_linear(a[..., :3])
    lum = lin @ np.array([0.2126, 0.7152, 0.0722])
    # «мягкое колено»: тёмные тона почти не меняются, светлые прижимаются к cap и никогда его не превышают (яркий кадр не превращается в плоское серое)
    target = cap * (1 - np.exp(-lum / cap))
    f = target / np.maximum(lum, 1e-9)
    out = to_srgb(lin * f[..., None])
    res = np.concatenate([out, a[..., 3:4]], axis=-1)
    return Image.fromarray((res * 255 + 0.5).astype(np.uint8), 'RGBA')


def feather_left(im: Image.Image, start: float, end: float) -> Image.Image:
    """Прозрачность слева направо: до start — нет картинки, после end — вся (плавно, smoothstep)."""
    a = np.asarray(im.convert('RGBA'), dtype=np.float64)
    x = np.linspace(0, 1, im.width)
    t = np.clip((x - start) / max(end - start, 1e-6), 0, 1)
    s = t * t * (3 - 2 * t)
    a[..., 3] *= s[None, :]
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def feather_top(im: Image.Image, end: float) -> Image.Image:
    """Прозрачность сверху вниз: у верхнего края нет картинки, к end (доля высоты) вся (smoothstep)."""
    a = np.asarray(im.convert('RGBA'), dtype=np.float64)
    y = np.linspace(0, 1, im.height)
    t = np.clip(y / max(end, 1e-6), 0, 1)
    a[..., 3] *= (t * t * (3 - 2 * t))[:, None]
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def key_black(im: Image.Image, gain: float = 1.0) -> Image.Image:
    """Картинка на чёрном фоне -> с прозрачностью: непрозрачность = самый яркий канал точки (цвет возвращаем без этого множителя)."""
    a = np.asarray(im.convert('RGB'), dtype=np.float64) / 255
    alpha = np.clip(a.max(axis=-1) * gain, 0, 1)
    col = a / np.maximum(alpha[..., None], 1e-6)
    res = np.concatenate([np.clip(col, 0, 1), alpha[..., None]], axis=-1)
    return Image.fromarray((res * 255 + 0.5).astype(np.uint8), 'RGBA')


def crop_cover(im: Image.Image, fx: float, fy: float, zoom: float = 1.0, ratio: float = W / H) -> Image.Image:
    """Кадр нужной пропорции; (fx, fy) — куда в кадре попадёт центр интереса (0..1 по ширине/высоте исходника), zoom>1 — крупнее."""
    iw, ih = im.size
    cw = iw / zoom
    ch = cw / ratio
    if ch > ih / zoom:
        ch = ih / zoom
        cw = ch * ratio
    x0 = min(max(fx * iw - cw / 2, 0), iw - cw)
    y0 = min(max(fy * ih - ch / 2, 0), ih - ch)
    return im.crop((int(x0), int(y0), int(x0 + cw), int(y0 + ch)))


def to_canvas(img: Image.Image, height_frac: float = 1.0, align: str = 'right', bottom: bool = False) -> Image.Image:
    """Кладёт картинку (с прозрачностью) на прозрачный холст W×H: по высоте height_frac, прижата к правому краю."""
    scale = H * height_frac / img.height
    w = max(1, round(img.width * scale))
    r = img.resize((w, max(1, round(img.height * scale))), Image.LANCZOS)
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    x = W - r.width if align == 'right' else 0
    y = H - r.height if bottom else (H - r.height) // 2
    canvas.alpha_composite(r, (x, y))
    return canvas


def save(im: Image.Image, name: str, quality: int = 74) -> None:
    path = OUT / name
    im.save(path, 'WEBP', quality=quality, alpha_quality=80, method=6)
    print(f'{name:28s} {im.size[0]}x{im.size[1]}  {path.stat().st_size / 1024:5.1f} KB')


def load(rel: str) -> Image.Image:
    return Image.open(SRC / rel).convert('RGBA')


def hero(name: str, im: Image.Image, start: float = 0.12, end: float = 0.55, quality: int = 74, cap: float = LCAP) -> None:
    save(feather_left(cap_luminance(im, cap), start, end), f'{name}-hero.webp', quality)


# ---- фон карточки «Всего» ----
# Акацуки: Итачи в красной ночи. Кадр сдвинут так, чтобы фигура встала правее середины (левая треть уходит в прозрачность).
hero('akatsuki', crop_cover(load('akatsuki/images/banner-itachi-red.jpg'), fx=0.30, fy=0.5, zoom=1.0).resize((W, H), Image.LANCZOS), 0.10, 0.50)
# Паутина: человек-паук на чёрном -> вырезан по яркости и поставлен справа во всю высоту.
hero('spider', to_canvas(key_black(load('spider/images/hero-dynamic.webp'), 1.6), 0.88, bottom=True), 0.0, 0.01)
# Шиноби: пиксельный Наруто, прижат к правому нижнему углу.
hero('shinobi', to_canvas(load('shinobi/art/naruto-pixel.png'), 0.66, bottom=True), 0.0, 0.01)
# Барселона: стадион ночью.
hero('barca', crop_cover(load('barca/images/stadium-night.webp'), fx=0.5, fy=0.62, zoom=1.15).resize((W, H), Image.LANCZOS), 0.05, 0.60)
# Реал Мадрид: ночное поле, «Hala Madrid».
hero('real', crop_cover(load('real-madrid/images/hala-madrid-pitch.webp'), fx=0.5, fy=0.72, zoom=1.0).resize((W, H), Image.LANCZOS), 0.05, 0.60)
# Месси: арт с майкой «10», стоит справа (холст прозрачный слева от него).
hero('messi', to_canvas(feather_top(feather_left(load('barca/images/messi-10-art.webp'), 0.0, 0.55), 0.3), 0.74, bottom=True), 0.0, 0.01)
# Таджикистан: ткань икат из Бухары.
hero('tajik', crop_cover(load('tajik/images/bukhara-ikat-fabric.webp'), fx=0.5, fy=0.5, zoom=1.0).resize((W, H), Image.LANCZOS), 0.05, 0.60, cap=0.085)  # ткань пёстрая: приглушена сильнее остальных
# Памир: озеро Булункуль.
hero('pamir', crop_cover(load('tajik/images/pamir-bulunkul-lake.webp'), fx=0.5, fy=0.5, zoom=1.0).resize((W, H), Image.LANCZOS), 0.05, 0.60)


# ---- водяной знак (герб) и миниатюры ----
def square(im: Image.Image, size: int, pad: float = 0.04) -> Image.Image:
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    inner = round(size * (1 - 2 * pad))
    s = inner / max(im.size)
    r = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    c = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    c.alpha_composite(r, ((size - r.width) // 2, (size - r.height) // 2))
    return c


def tmp(name: str) -> Image.Image:
    return Image.open(TMP / name).convert('RGBA')


marks = {
    'barca': tmp('barca-crest.png'),
    'real': tmp('real-crest.png'),
    'tajik': load('tajik/emblem/emblem-1024.png'),
}
for key, im in marks.items():
    save(square(im, 256), f'{key}-mark.webp', 80)

thumbs = {
    'barca': marks['barca'],
    'real': marks['real'],
    'tajik': marks['tajik'],
    'spain': tmp('spain-flag.png'),
    'akatsuki': tmp('akatsuki-cloud.png'),
    'messi': crop_cover(load('barca/images/messi-10-art.webp'), fx=0.62, fy=0.30, zoom=2.4, ratio=1.0),
    'spider': key_black(crop_cover(load('spider/images/hero-mask-closeup.webp'), fx=0.5, fy=0.5, zoom=1.05, ratio=1.0)),
    'shinobi': crop_cover(load('shinobi/art/naruto-pixel.png'), fx=0.5, fy=0.16, zoom=1.6, ratio=1.0),
    'pamir': crop_cover(load('tajik/images/pamir-bulunkul-lake.webp'), fx=0.5, fy=0.55, zoom=1.0, ratio=1.0),
}
for key, im in thumbs.items():
    save(square(im, 112, 0.0 if key in ('messi', 'pamir') else 0.06), f'{key}-thumb.webp', 78)
