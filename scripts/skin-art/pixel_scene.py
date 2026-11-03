#!/usr/bin/env python3
"""
Рисует пиксельную картинку для образа «Пиксель» (свою, без чужих материалов): 160×80 точек в четырёх зелёных оттенках Game Boy,
увеличена в 4 раза без сглаживания (640×320). Небо с растром, луна, звёзды, облака, горы, замок, трава, герой с мечом и монета.
Запуск из корня репозитория: python3 scripts/skin-art/pixel_scene.py  ->  src/assets/skins/photos/pixel-scene.png
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'src' / 'assets' / 'skins' / 'photos' / 'pixel-scene.png'

PAL = [(15, 56, 15), (48, 98, 48), (139, 172, 15), (155, 188, 15)]  # от тёмного к светлому
GW, GH = 160, 80
BAYER = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) / 16.0

g = np.zeros((GH, GW), dtype=np.uint8)  # индексы в PAL

# небо: сверху тёмное, к горизонту светлее; переходы заливаются растром 4×4
for y in range(GH):
    t = min(1.0, y / 52)  # 0 — верх, 1 — горизонт
    level = t * 2.0  # 0..2: между оттенками 0, 1, 2
    base = int(level)
    frac = level - base
    for x in range(GW):
        dither = BAYER[y % 4, x % 4]
        g[y, x] = base + (1 if frac > dither else 0)


def disc(cx: int, cy: int, r: int, color: int) -> None:
    for y in range(GH):
        for x in range(GW):
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                g[y, x] = color


# луна с «кратерами»
disc(122, 20, 12, 3)
for cx, cy, r in [(118, 17, 3), (127, 24, 2), (124, 14, 1)]:
    disc(cx, cy, r, 2)

# звёзды
for x, y in [(18, 6), (40, 12), (66, 5), (84, 18), (100, 8), (146, 7), (150, 28), (30, 26), (8, 20), (74, 28)]:
    g[y, x] = 3
    if (x + y) % 3 == 0:
        g[y, x - 1] = g[y, x + 1] = g[y - 1, x] = g[y + 1, x] = 2


def cloud(x0: int, y0: int, w: int) -> None:
    for i in range(w):
        h = 3 + int(2 * np.sin(i / w * np.pi))
        for j in range(h):
            g[y0 - j, x0 + i] = 3
    g[y0 + 1, x0 + 2 : x0 + w - 2] = 2


cloud(56, 24, 22)
cloud(136, 38, 16)
cloud(20, 34, 18)

# горы: две гряды (далёкая светлее, ближняя темнее)
xs = np.arange(GW)
far = 54 - (np.abs(((xs * 0.05) % 2) - 1) * 16 + np.abs(((xs * 0.13 + 0.7) % 2) - 1) * 6)
near = 62 - (np.abs(((xs * 0.04 + 0.4) % 2) - 1) * 14 + np.abs(((xs * 0.11) % 2) - 1) * 5)
for x in range(GW):
    g[int(far[x]) :, x] = 1
for x in range(GW):
    # заснеженные вершины далёких гор
    top = int(far[x])
    if top < 43:
        g[top : top + 2, x] = 3
for x in range(GW):
    g[int(near[x]) :, x] = 0


# замок на дальней гряде
def rect(x0: int, y0: int, w: int, h: int, color: int) -> None:
    g[y0 : y0 + h, x0 : x0 + w] = color


cx = 104
rect(cx, 40, 14, 12, 0)
for i in range(0, 14, 4):
    rect(cx + i, 38, 2, 2, 0)
rect(cx - 4, 34, 5, 18, 0)
rect(cx + 13, 34, 5, 18, 0)
for off in (cx - 4, cx + 13):
    rect(off, 32, 1, 2, 0)
    rect(off + 2, 32, 1, 2, 0)
    rect(off + 4, 32, 1, 2, 0)
rect(cx + 5, 46, 4, 6, 3)  # ворота, светятся
rect(cx - 2, 38, 1, 2, 3)
rect(cx + 15, 38, 1, 2, 3)

# земля и трава
GROUND = 66
for y in range(GROUND, GH):
    g[y, :] = 0 if y > GROUND + 1 else 1
for x in range(0, GW, 3):
    h = 1 + (x * 7 % 3)
    g[GROUND - h : GROUND, x] = 1
for x in range(1, GW, 11):
    g[GROUND + 3 : GROUND + 4, x : x + 3] = 1

# герой: рыцарь с мечом (8×11)
KNIGHT = [
    "..###...",
    ".#222#..",
    ".#3#3#..",
    ".#222#..",
    "..###.#.",
    ".#111##.",
    "#1111#1#",
    "#1111#.#",
    ".#11#...",
    ".#..#...",
    "##..##..",
]
sx, sy = 132, GROUND - len(KNIGHT) + 1
for j, row in enumerate(KNIGHT):
    for i, ch in enumerate(row):
        if ch == '#':
            g[sy + j, sx + i] = 0
        elif ch in '123':
            g[sy + j, sx + i] = int(ch)
# меч
for k in range(7):
    g[sy + 3 - k // 2 if k % 2 == 0 else sy + 3 - k // 2, sx + 8 + k // 2] = 3

# монеты в воздухе
COIN = ["..##..", ".#33#.", "#3223#", "#3223#", ".#33#.", "..##.."]
for cx0, cy0 in [(146, 44), (150, 52)]:
    for j, row in enumerate(COIN):
        for i, ch in enumerate(row):
            if ch == '#':
                g[cy0 + j, cx0 + i] = 0
            elif ch in '23':
                g[cy0 + j, cx0 + i] = int(ch)

img = np.zeros((GH, GW, 3), dtype=np.uint8)
for idx, color in enumerate(PAL):
    img[g == idx] = color
Image.fromarray(img, 'RGB').resize((GW * 4, GH * 4), Image.NEAREST).save(OUT, optimize=True)
print('ok', OUT, OUT.stat().st_size // 1024, 'KB')
