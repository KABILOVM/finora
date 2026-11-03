#!/usr/bin/env python3
"""
Готовит картинки образов для приложения из «сырья» в src/assets/skins/*/ (то, что скачано или нарисовано).
Запуск из корня репозитория: python3 scripts/skin-art/build.py   (нужны Pillow и numpy; логотипы клубов см. rasterize.cjs)

Что получается (всё в src/assets/skins/art/, webp):
  <образ>-hero.webp   640×320, фон карточки «Всего» на главной. Два вида:
                      — «кадр» (фото, арт на всю карточку): левая часть плавно уходит в прозрачность (под ней цвет карточки), а яркость
                        каждой точки ограничена (LCAP), поэтому белый текст читается поверх любой части (контраст не меньше 4,5);
                      — «вырез» (герой на прозрачном фоне): стоит в правом нижнем углу не выше двух третей карточки, под суммой за месяц,
                        поэтому текст его не задевает; яркость не ограничена, чтобы краски остались живыми.
  <образ>-mark.webp   256×256, водяной знак в углу карточки (герб).
  <образ>-thumb.webp  112×112, значок образа в «Настройки → Оформление» (есть у каждого образа).
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


# ---- «кадры»: фото и арты на всю карточку ----
def gradient_map(im: Image.Image, stops: list[tuple[float, tuple[int, int, int]]], lo: float = 2, hi: float = 98) -> Image.Image:
    """Фото -> картинка в цветах образа: яркость точки задаёт цвет по ступеням stops (0..1 -> цвет). Так любое фото получает цвета образа."""
    g = np.asarray(im.convert('L'), dtype=np.float64) / 255
    a, b = np.percentile(g, [lo, hi])
    g = np.clip((g - a) / max(b - a, 1e-6), 0, 1)
    xs = [st[0] for st in stops]
    out = np.zeros(g.shape + (3,))
    for c in range(3):
        out[..., c] = np.interp(g, xs, [st[1][c] for st in stops])
    return Image.fromarray(out.astype(np.uint8), 'RGB').convert('RGBA')


def cover(rel: str, fx: float, fy: float, zoom: float = 1.0) -> Image.Image:
    return crop_cover(load(rel), fx, fy, zoom).resize((W, H), Image.LANCZOS)


# Акацуки: Итачи в красной ночи. Кадр сдвинут так, чтобы фигура встала правее середины (левая треть уходит в прозрачность).
hero('akatsuki', cover('akatsuki/images/banner-itachi-red.jpg', 0.30, 0.5), 0.10, 0.50)
# Барселона: стадион ночью. Реал Мадрид: ночное поле, «Hala Madrid».
hero('barca', cover('barca/images/stadium-night.webp', 0.5, 0.62, 1.15), 0.05, 0.60)
hero('real', cover('real-madrid/images/hala-madrid-pitch.webp', 0.5, 0.72), 0.05, 0.60)
# Национальные: флаги и флагштоки (настоящие фото). Цвета флага сохраняются, яркость только ограничена.
TAJ = [(0, (30, 6, 20)), (0.4, (110, 18, 40)), (0.75, (190, 90, 50)), (1, (236, 190, 110))]
hero('tajik', gradient_map(cover('photos/tajik-flagpole.jpg', 0.44, 0.3, 1.8), TAJ), 0.04, 0.45)  # душанбинский флагшток (165 м) в закатной дымке, цвета образа
hero('spain', cover('photos/spain-flag.jpg', 0.55, 0.5, 1.0), 0.05, 0.55)  # огромный флаг на площади Колумба в Мадриде
# Памир: «Гималаи, Сикким» Николая Рериха (картина, общественное достояние): ночные снежные вершины и месяц в сине-бирюзовых тонах.
hero('pamir', cover('photos/pamir-roerich.jpg', 0.58, 0.62, 1.45), 0.0, 0.4)
# Стили: настоящие фото (Unsplash), у «Пикселя» своя пиксельная картинка в зелёных оттенках Game Boy.
hero('football', cover('photos/football-night.jpg', 0.5, 0.62, 1.0), 0.05, 0.55)
hero('racing', cover('photos/racing-f1.jpg', 0.62, 0.45, 1.0), 0.05, 0.55)
hero('cyber', cover('photos/cyber-shibuya.jpg', 0.5, 0.45, 1.0), 0.05, 0.55)
hero('aesthetic', cover('photos/aesthetic-roses.jpg', 0.5, 0.35, 1.0), 0.05, 0.55)
hero('kawaii', cover('photos/kawaii-unicorn.jpg', 0.5, 0.5, 1.0), 0.05, 0.55)
hero('comic', cover('photos/comic-superhero.jpg', 0.5, 0.42, 1.0), 0.05, 0.55)


# ---- «вырезы»: герой на прозрачном фоне, в правом нижнем углу ----
def trim(im: Image.Image) -> Image.Image:
    bb = im.getbbox()
    return im.crop(bb) if bb else im


def cutout(name: str, im: Image.Image, frac: float, pad: float = 0.04) -> None:
    """Вырез в правом нижнем углу: высота frac от карточки, отступ справа pad от ширины."""
    im = trim(im)
    h = round(H * frac)
    w = max(1, round(im.width * h / im.height))
    r = im.resize((w, h), Image.LANCZOS)
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    canvas.alpha_composite(r, (W - w - round(W * pad), H - h))
    save(canvas, f'{name}-hero.webp', 80)


# Паутина: человек-паук на чёрном -> вырезан по яркости. Месси: арт с майкой «10». Шиноби: Наруто с расенганом (PNG с прозрачным фоном).
cutout('spider', key_black(load('spider/images/hero-dynamic.webp'), 1.6), 0.88)
cutout('messi', feather_top(feather_left(load('barca/images/messi-10-art.webp'), 0.0, 0.55), 0.3), 0.74, pad=0.0)
cutout('shinobi', load('shinobi/png/rasengan.png'), 0.72, pad=0.0)
# Пиксель: своя пиксельная картинка (scripts/skin-art/pixel_scene.py) правой частью в правом нижнем углу; слева и сверху плавно исчезает,
# а яркость не ограничена, чтобы остались настоящие зелёные оттенки Game Boy.
scene = load('photos/pixel-scene.png').crop((280, 0, 640, 320))
scene = feather_top(feather_left(scene, 0.0, 0.45), 0.2)
ph = round(H * 0.66)
pw = round(scene.width * ph / scene.height)
canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
canvas.alpha_composite(scene.resize((pw, ph), Image.NEAREST), (W - pw, H - ph))
save(canvas, 'pixel-hero.webp', 80)
# Аргентина: «Солнце мая» с флага (рисунок общественного достояния), золотое на синем.
cutout('argentina', load('photos/sol-de-mayo.png'), 0.74, pad=0.03)
# Роналду: портрет в цветах образа (чёрное, гранат, золото), по высоте карточки у правого края, слева уходит в прозрачность.
CR = [(0, (8, 6, 8)), (0.45, (120, 16, 32)), (0.8, (200, 140, 40)), (1, (240, 210, 130))]
portrait = feather_top(feather_left(cap_luminance(gradient_map(load('photos/cr7.jpg'), CR)), 0.0, 0.6), 0.3)
canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ph = round(H * 0.86)
pw = round(portrait.width * ph / portrait.height)
canvas.alpha_composite(portrait.resize((pw, ph), Image.LANCZOS), (W - pw - round(W * 0.03), H - ph))
save(canvas, 'cr7-hero.webp', 80)


# ---- водяной знак (герб) и значки образов ----
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


def sq(rel: str, fx: float, fy: float, zoom: float = 1.0) -> Image.Image:
    """Квадратный кадр из фото для значка: настоящие цвета, без ограничения яркости."""
    return crop_cover(load(rel), fx, fy, zoom, ratio=1.0)


# «Стилевые» образы: свои векторные рисунки (draw_styles.py → rasterize.cjs), правым нижним «вырезом»
for style_id, frac in (('coquette', 0.74), ('gothic', 0.8), ('clay', 0.72), ('liquid', 0.74), ('chrome', 0.78), ('retro', 0.76), ('bauhaus', 0.74), ('sticker', 0.76), ('notebook', 0.78), ('dungeon', 0.78), ('graffiti', 0.8), ('cafe', 0.76), ('nowruz', 0.78), ('christmas', 0.8), ('halloween', 0.78), ('valentine', 0.78), ('bento', 0.8)):
    cutout(style_id, tmp(f'{style_id}-hero.png'), frac, pad=0.03)
marks = {'barca': tmp('barca-crest.png'), 'real': tmp('real-crest.png')}
for key, im in marks.items():
    save(square(im, 256), f'{key}-mark.webp', 80)

emblem = load('tajik/emblem/emblem-1024.png')
thumbs = {
    'classic': tmp('classic-icon.png'),
    'barca': marks['barca'],
    'real': marks['real'],
    'argentina': load('photos/sol-de-mayo.png'),
    'messi': sq('barca/images/messi-10-art.webp', 0.62, 0.30, 2.4),
    'spain': sq('photos/spain-flag-detail.jpg', 0.42, 0.4, 1.5),
    'cr7': sq('photos/cr7.jpg', 0.5, 0.28, 1.7),
    'football': sq('photos/football-night.jpg', 0.5, 0.6, 1.9),
    'shinobi': load('shinobi/png/face.png'),
    'akatsuki': sq('akatsuki/images/banner-itachi-red.jpg', 0.42, 0.45, 1.5),
    'spider': key_black(crop_cover(load('spider/images/hero-mask-closeup.webp'), fx=0.5, fy=0.5, zoom=1.05, ratio=1.0)),
    'comic': sq('photos/comic-superhero.jpg', 0.55, 0.5, 2.2),
    'tajik': sq('photos/tajik-flagpole-view.jpg', 0.34, 0.5, 1.5),  # флаг Таджикистана с высоты флагштока
    'pamir': sq('photos/pamir-roerich.jpg', 0.52, 0.55, 1.7),
    'kawaii': sq('photos/kawaii-unicorn.jpg', 0.45, 0.4, 2.0),
    'aesthetic': sq('photos/aesthetic-roses.jpg', 0.5, 0.45, 1.5),
    'racing': sq('photos/racing-f1.jpg', 0.65, 0.5, 2.2),
    'cyber': sq('photos/cyber-shibuya.jpg', 0.78, 0.3, 2.4),
    'pixel': sq('photos/pixel-scene.png', 0.76, 0.42, 2.2),
    **{style_id: tmp(f'{style_id}-thumb.png') for style_id in ('coquette', 'gothic', 'clay', 'liquid', 'chrome', 'retro', 'bauhaus', 'sticker', 'notebook', 'dungeon', 'graffiti', 'cafe', 'nowruz', 'christmas', 'halloween', 'valentine', 'bento')},
}
FULL = {'classic', 'barca', 'real', 'shinobi', 'argentina'}  # значок-герб или картинка с прозрачным фоном: вписываем целиком
def on_dark(im: Image.Image) -> Image.Image:
    """Прозрачная картинка на тёмном фоне: файл заметно легче, чем с прозрачностью."""
    bg = Image.new('RGBA', im.size, (12, 14, 30, 255))
    bg.alpha_composite(im.convert('RGBA'))
    return bg


def tri_thumb(ids: tuple[str, ...]) -> Image.Image:
    """Значок «Сезонных» образов: три праздничных значка косыми полосами (Новый год, Хэллоуин, 14 февраля)."""
    from PIL import ImageDraw

    out = Image.new('RGBA', (112, 112), (0, 0, 0, 255))
    n, slant = len(ids), 12
    for i, key in enumerate(ids):
        x0, x1 = 112 * i / n, 112 * (i + 1) / n
        mask = Image.new('L', (112, 112), 0)
        ImageDraw.Draw(mask).polygon([(x0 + (slant if i else 0), 0), (x1 + (slant if i < n - 1 else 0), 0), (x1 - (slant if i < n - 1 else 0), 112), (x0 - (slant if i else 0), 112)], fill=255)
        out.paste(thumbs[key].convert('RGBA').resize((112, 112), Image.LANCZOS), (0, 0), mask)
    return out


thumbs['seasonal'] = tri_thumb(('christmas', 'halloween', 'valentine'))

thumbs['spider'] = on_dark(thumbs['spider'].resize((112, 112), Image.LANCZOS))
for key, im in thumbs.items():
    save(square(im, 112, 0.06) if key in FULL else im.convert('RGBA').resize((112, 112), Image.LANCZOS), f'{key}-thumb.webp', 68)
