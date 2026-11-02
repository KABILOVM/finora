#!/usr/bin/env python3
"""
Готовит картинки образов для приложения из «сырья» в src/assets/skins/*/ (то, что скачано или нарисовано).
Запуск из корня репозитория: python3 scripts/skin-art/build.py   (нужны Pillow и numpy; логотипы клубов см. rasterize.cjs)

Что получается (всё в src/assets/skins/art/, webp):
  <образ>-hero.webp   640×320, фон карточки «Всего» на главной. Два вида:
                      — «кадр» (фото, арт на всю карточку): левая часть плавно уходит в прозрачность (под ней цвет карточки), а яркость
                        каждой точки ограничена (LCAP), поэтому белый текст читается поверх любой части (контраст не меньше 4,5);
                      — «вырез» (герой или значок на прозрачном фоне): стоит в правом нижнем углу не выше двух третей карточки, под суммой
                        за месяц, поэтому текст его не задевает; яркость не ограничена, чтобы краски остались живыми.
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
    """Фото -> двухцветная (многоцветная) картинка: яркость точки задаёт цвет по ступеням stops (0..1 -> цвет). Так любое фото получает цвета образа."""
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
# Таджикистан: арка памятника Исмоили Сомони в закатных красно-золотых цветах (фото CC BY-SA 4.0, см. CREDITS.md).
TAJ = [(0, (30, 6, 20)), (0.4, (110, 18, 40)), (0.75, (190, 90, 50)), (1, (236, 190, 110))]
hero('tajik', gradient_map(cover('tajik/photos/somoni-arch.jpg', 0.56, 0.52, 1.7), TAJ), 0.03, 0.40)
# Памир: хребет над озером Каракуль в ледяных сине-голубых цветах (фото CC BY-SA 4.0, см. CREDITS.md).
PAM = [(0, (6, 12, 38)), (0.35, (22, 44, 96)), (0.7, (60, 120, 150)), (1, (190, 215, 225))]
hero('pamir', gradient_map(cover('tajik/photos/karakul-lake.jpg', 0.5, 0.40, 1.5), PAM), 0.05, 0.60)


# ---- «вырезы»: герой или значок на прозрачном фоне, в правом нижнем углу ----
def trim(im: Image.Image) -> Image.Image:
    bb = im.getbbox()
    return im.crop(bb) if bb else im


def glow(size: tuple[int, int], center: tuple[float, float], radius: float, alpha: float) -> Image.Image:
    """Мягкое белое пятно за фигурой: чтобы она не терялась на цвете карточки."""
    yy, xx = np.mgrid[0:size[1], 0:size[0]]
    d = np.hypot(xx - center[0], yy - center[1]) / radius
    a = np.clip(1 - d, 0, 1) ** 2 * alpha * 255
    out = np.zeros((size[1], size[0], 4), dtype=np.uint8)
    out[..., :3] = 255
    out[..., 3] = a.astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def cutout(name: str, im: Image.Image, frac: float, glow_alpha: float = 0.0, extra: Image.Image | None = None, pad: float = 0.04) -> None:
    """Вырез в правом нижнем углу: высота frac от карточки, отступ справа pad от ширины. Всё, что в extra, ложится поверх на тот же холст."""
    im = trim(im)
    h = round(H * frac)
    w = max(1, round(im.width * h / im.height))
    r = im.resize((w, h), Image.LANCZOS)
    x = W - w - round(W * pad)
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    if glow_alpha:
        canvas.alpha_composite(glow((W, H), (x + w / 2, H - h / 2), h * 0.75, glow_alpha))
    canvas.alpha_composite(r, (x, H - h))
    if extra is not None:
        canvas.alpha_composite(extra)
    save(canvas, f'{name}-hero.webp', 80)


def tmp(name: str) -> Image.Image:
    return Image.open(TMP / name).convert('RGBA')


# Паутина: человек-паук на чёрном -> вырезан по яркости. Месси: арт с майкой «10». Шиноби: Наруто с расенганом (PNG с прозрачным фоном).
cutout('spider', key_black(load('spider/images/hero-dynamic.webp'), 1.6), 0.88)
messi = feather_top(feather_left(load('barca/images/messi-10-art.webp'), 0.0, 0.55), 0.3)
cutout('messi', messi, 0.74, pad=0.0)
cutout('shinobi', load('shinobi/png/rasengan.png'), 0.72, pad=0.0)
# Остальные образы: значок-иллюстрация (Fluent Emoji Flat, MIT) с мягким пятном за ним.
cutout('argentina', tmp('emoji-sun-with-face.png'), 0.66, 0.16)  # «Солнце мая» с флага
cutout('football', tmp('emoji-soccer-ball.png'), 0.62, 0.16)
cutout('comic', tmp('emoji-collision.png'), 0.68, 0.14)
cutout('kawaii', tmp('emoji-cat-face.png'), 0.62, 0.18)
cutout('aesthetic', tmp('emoji-rose.png'), 0.70, 0.14)
cutout('cyber', tmp('emoji-robot.png'), 0.66, 0.14)
cutout('pixel', tmp('emoji-alien-monster.png'), 0.62, 0.14)
# Гонки: болид на фоне клетчатых флагов.
flag = trim(tmp('emoji-chequered-flag.png'))
fh = round(H * 0.7)
flag = flag.resize((round(flag.width * fh / flag.height), fh), Image.LANCZOS)
front = Image.new('RGBA', (W, H), (0, 0, 0, 0))
front.alpha_composite(flag, (W - flag.width - round(W * 0.06), H - fh))
car = trim(tmp('emoji-racing-car.png'))
cw = round(W * 0.5)
car = car.resize((cw, round(car.height * cw / car.width)), Image.LANCZOS)
canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
canvas.alpha_composite(glow((W, H), (W * 0.78, H * 0.6), H * 0.7, 0.14))
canvas.alpha_composite(front)
canvas.alpha_composite(car, (W - cw - round(W * 0.02), H - car.height - round(H * 0.04)))
save(canvas, 'racing-hero.webp', 80)


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


marks = {'barca': tmp('barca-crest.png'), 'real': tmp('real-crest.png')}
for key, im in marks.items():
    save(square(im, 256), f'{key}-mark.webp', 80)

emblem = load('tajik/emblem/emblem-1024.png')
thumbs = {
    'classic': tmp('classic-icon.png'),
    'barca': marks['barca'],
    'real': marks['real'],
    'argentina': tmp('ar-flag.png'),
    'messi': crop_cover(load('barca/images/messi-10-art.webp'), fx=0.62, fy=0.30, zoom=2.4, ratio=1.0),
    'spain': tmp('spain-flag.png'),
    'cr7': tmp('pt-flag.png'),
    'football': tmp('emoji-soccer-ball.png'),
    'shinobi': load('shinobi/png/face.png'),
    'akatsuki': tmp('akatsuki-cloud.png'),
    'spider': key_black(crop_cover(load('spider/images/hero-mask-closeup.webp'), fx=0.5, fy=0.5, zoom=1.05, ratio=1.0)),
    'comic': tmp('emoji-collision.png'),
    'tajik': emblem,
    'pamir': tmp('emoji-snow-capped-mountain.png'),
    'kawaii': tmp('emoji-cat-face.png'),
    'aesthetic': tmp('emoji-rose.png'),
    'racing': tmp('emoji-chequered-flag.png'),
    'cyber': tmp('emoji-cityscape-at-dusk.png'),
    'pixel': tmp('emoji-alien-monster.png'),
}
for key, im in thumbs.items():
    save(square(im, 112, 0.0 if key == 'messi' else 0.06), f'{key}-thumb.webp', 78)
