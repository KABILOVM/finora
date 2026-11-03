#!/usr/bin/env python3
"""
Рисует картинки «стилевых» образов (Кокетка, Готика, Глина, Жидкое стекло, Y2K-хром, Ретро, Баухаус, Скрапбук, Тетрадь, Подземелье) векторными рисунками: ничьих чужих материалов в них нет, всё нарисовано здесь.
Запуск из корня репозитория: python3 scripts/skin-art/draw_styles.py

Что получается (src/assets/skins/<образ>/svg/):
  hero.svg   рисунок на прозрачном фоне 320×240 — для карточки «Всего» (build.py ставит его «вырезом» в правый нижний угол);
  thumb.svg  квадратный значок образа 112×112 в «Настройки → Оформление» — тот же рисунок на фоне цветов образа.
Дальше их превращает в webp scripts/skin-art/build.py (через rasterize.cjs, он же рисует SVG в PNG).
"""
from __future__ import annotations

from pathlib import Path

SRC = Path(__file__).resolve().parents[2] / 'src' / 'assets' / 'skins'


def lin(i: str, stops: list[tuple[float, str]], x1=0, y1=0, x2=0, y2=1) -> str:
    s = ''.join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops)
    return f'<linearGradient id="{i}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}">{s}</linearGradient>'


def rad(i: str, stops: list[tuple[float, str, float]], cx=0.35, cy=0.3, r=0.75) -> str:
    s = ''.join(f'<stop offset="{o}" stop-color="{c}" stop-opacity="{a}"/>' for o, c, a in stops)
    return f'<radialGradient id="{i}" cx="{cx}" cy="{cy}" r="{r}">{s}</radialGradient>'


# ---------------------------------------------------------------- Кокетка: атласный бант с жемчугом
def coquette() -> tuple[str, str]:
    defs = (
        lin('cq-a', [(0, '#ffd9e5'), (0.5, '#f7a8c1'), (1, '#e0708f')], 0, 0, 1, 1)
        + lin('cq-b', [(0, '#fbc3d5'), (1, '#c95a7c')], 0, 0, 0, 1)
        + rad('cq-p', [(0, '#ffffff', 1), (0.7, '#ffeef3', 1), (1, '#f0c4d1', 1)], 0.35, 0.3, 0.8)
    )
    loop_l = 'M160 118 C124 62 62 52 38 92 C26 122 52 172 108 152 C136 142 150 132 160 118 Z'
    loop_r = 'M160 118 C196 62 258 52 282 92 C294 122 268 172 212 152 C184 142 170 132 160 118 Z'
    tail_l = 'M152 130 C134 168 112 196 98 226 L126 214 L138 234 C142 196 156 164 164 136 Z'
    tail_r = 'M168 130 C186 168 208 196 222 226 L194 214 L182 234 C178 196 164 164 156 136 Z'
    body = (
        f'<path d="{tail_l}" fill="url(#cq-b)"/><path d="{tail_r}" fill="url(#cq-b)"/>'
        f'<path d="M128 214 L138 234 C142 196 156 164 164 136 L156 134 C146 160 134 188 128 214 Z" fill="#b94a6d" opacity=".35"/>'
        f'<path d="{loop_l}" fill="url(#cq-a)"/><path d="{loop_r}" fill="url(#cq-a)"/>'
        '<path d="M150 124 C120 90 78 80 54 100" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="3" stroke-linecap="round"/>'
        '<path d="M170 124 C200 90 242 80 266 100" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="3" stroke-linecap="round"/>'
        '<path d="M150 128 C118 112 84 116 66 134" fill="none" stroke="#c95a7c" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"/>'
        '<path d="M170 128 C202 112 236 116 254 134" fill="none" stroke="#c95a7c" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"/>'
        '<rect x="136" y="96" width="48" height="52" rx="22" fill="url(#cq-a)"/>'
        '<path d="M146 108 C150 102 160 100 168 104" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="4" stroke-linecap="round"/>'
        '<rect x="136" y="96" width="48" height="52" rx="22" fill="none" stroke="#d9698b" stroke-opacity=".55" stroke-width="2"/>'
    )
    # жемчуг, сердечки и искры
    pearls = ''.join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="url(#cq-p)"/>' for x, y, r in [(64, 184, 9), (88, 206, 6), (256, 184, 9), (234, 206, 6), (160, 40, 7), (40, 148, 5), (282, 150, 5)])
    heart = lambda x, y, s: f'<path transform="translate({x} {y}) scale({s})" d="M0 6 C-10 -2 -6 -12 0 -6 C6 -12 10 -2 0 6 Z" fill="#ff8fb0"/>'
    spark = lambda x, y, s: f'<path transform="translate({x} {y}) scale({s})" d="M0 -8 C1 -2 2 -1 8 0 C2 1 1 2 0 8 C-1 2 -2 1 -8 0 C-2 -1 -1 -2 0 -8 Z" fill="#fff" stroke="#f7a8c1" stroke-width=".8"/>'
    deco = heart(36, 62, 1.6) + heart(290, 70, 1.2) + heart(272, 214, 1.0) + spark(300, 112, 1.1) + spark(22, 118, 0.9) + spark(250, 34, 1.2)
    return defs, body + pearls + deco


# ---------------------------------------------------------------- Готика: стрельчатое окно с розой
def gothic() -> tuple[str, str]:
    defs = (
        lin('gt-g', [(0, '#7a1f36'), (1, '#2a0a14')], 0, 0, 0, 1)
        + lin('gt-s', [(0, '#f1ecee'), (0.5, '#a89aa1'), (1, '#e6dde1')], 0, 0, 1, 1)
        + lin('gt-r', [(0, '#c4465f'), (1, '#5a1426')], 0, 0, 1, 1)
        + lin('gt-v', [(0, '#6a3b8f'), (1, '#2b1450')], 0, 0, 0, 1)
        + rad('gt-glow', [(0, '#ffcf8a', 0.9), (1, '#ffcf8a', 0)], 0.5, 0.5, 0.5)
    )
    arch = 'M70 232 V112 C70 66 124 40 160 8 C196 40 250 66 250 112 V232 Z'
    inner = 'M84 226 V114 C84 74 128 50 160 24 C192 50 236 74 236 114 V226 Z'
    lancet = lambda x0, x1: f'M{x0} 226 V160 C{x0} 134 {(x0 + x1) / 2 - 6} 126 {(x0 + x1) / 2} 112 C{(x0 + x1) / 2 + 6} 126 {x1} 134 {x1} 160 V226 Z'
    petals = ''.join(f'<circle cx="{160 + 17 * __import__("math").cos(a * 0.7854):.1f}" cy="{86 + 17 * __import__("math").sin(a * 0.7854):.1f}" r="9" fill="url(#gt-r)" stroke="url(#gt-s)" stroke-width="2"/>' for a in range(8))
    body = (
        f'<path d="{arch}" fill="url(#gt-g)" stroke="url(#gt-s)" stroke-width="6" stroke-linejoin="round"/>'
        f'<path d="{inner}" fill="#150710" stroke="url(#gt-s)" stroke-width="3" stroke-linejoin="round"/>'
        '<circle cx="160" cy="86" r="34" fill="url(#gt-glow)"/>'
        '<circle cx="160" cy="86" r="32" fill="#240b18" stroke="url(#gt-s)" stroke-width="4"/>'
        + petals
        + '<circle cx="160" cy="86" r="9" fill="url(#gt-s)"/>'
        f'<path d="{lancet(96, 156)}" fill="url(#gt-v)" stroke="url(#gt-s)" stroke-width="3"/>'
        f'<path d="{lancet(164, 224)}" fill="url(#gt-r)" stroke="url(#gt-s)" stroke-width="3"/>'
        '<path d="M160 120 V226" stroke="url(#gt-s)" stroke-width="4"/>'
        '<path d="M96 180 H156 M164 180 H224" stroke="url(#gt-s)" stroke-width="2" opacity=".8"/>'
        '<path d="M58 232 H262" stroke="url(#gt-s)" stroke-width="6" stroke-linecap="round"/>'
    )
    spark = lambda x, y, s: f'<path transform="translate({x} {y}) scale({s})" d="M0 -8 C1 -2 2 -1 8 0 C2 1 1 2 0 8 C-1 2 -2 1 -8 0 C-2 -1 -1 -2 0 -8 Z" fill="#e6dde1"/>'
    return defs, body + spark(40, 60, 1.3) + spark(284, 90, 1.0) + spark(278, 40, 0.8)


# ---------------------------------------------------------------- Глина: мягкие объёмные фигурки
def clay() -> tuple[str, str]:
    def ball(i: str, light: str, mid: str, dark: str) -> str:
        return rad(i, [(0, light, 1), (0.55, mid, 1), (1, dark, 1)], 0.32, 0.28, 0.85)

    defs = (
        ball('cl-o', '#ffe0cb', '#ffb385', '#e07a47')
        + ball('cl-m', '#d8f5ee', '#8fd3c7', '#4ea99a')
        + ball('cl-y', '#fff0bd', '#ffd36e', '#e6a92f')
        + ball('cl-p', '#e9dcff', '#b79cf5', '#7c5bd0')
        + rad('cl-h', [(0, '#fff', 0.9), (1, '#fff', 0)], 0.5, 0.5, 0.5)
    )
    shadow = '<ellipse cx="160" cy="226" rx="120" ry="9" fill="#5b3a8a" opacity=".18"/>'
    body = (
        shadow
        # мятный закруглённый кубик
        + '<g transform="rotate(-8 92 160)"><rect x="42" y="112" width="100" height="100" rx="30" fill="url(#cl-m)"/><ellipse cx="74" cy="134" rx="20" ry="9" fill="url(#cl-h)" transform="rotate(-25 74 134)"/></g>'
        # оранжевый шар
        + '<circle cx="204" cy="150" r="64" fill="url(#cl-o)"/><ellipse cx="178" cy="112" rx="26" ry="13" fill="url(#cl-h)" transform="rotate(-30 178 112)"/>'
        # жёлтый бублик
        + '<g transform="translate(112 62)"><circle r="40" fill="url(#cl-y)"/><circle r="15" fill="#f3d9a0" opacity=".0"/><ellipse cx="-14" cy="-22" rx="16" ry="8" fill="url(#cl-h)" transform="rotate(-20 -14 -22)"/></g>'
        + '<circle cx="112" cy="62" r="14" fill="#e0a431" opacity=".55"/><circle cx="112" cy="60" r="12" fill="#ffefc2" opacity=".0"/>'
        # сиреневая пилюля
        + '<g transform="rotate(24 262 70)"><rect x="236" y="38" width="52" height="64" rx="26" fill="url(#cl-p)"/><ellipse cx="253" cy="54" rx="9" ry="5" fill="url(#cl-h)" transform="rotate(-25 253 54)"/></g>'
        + '<circle cx="34" cy="70" r="12" fill="url(#cl-o)"/><circle cx="296" cy="188" r="10" fill="url(#cl-m)"/>'
    )
    return defs, body


# ---------------------------------------------------------------- Жидкое стекло: прозрачные шары с бликами
def liquid() -> tuple[str, str]:
    def orb(i: str, a: str, b: str) -> str:
        return rad(i, [(0, a, 0.55), (0.7, b, 0.35), (1, b, 0.6)], 0.38, 0.3, 0.8)

    defs = (
        orb('lq-b', '#cfe0ff', '#5b86ff')
        + orb('lq-v', '#eadcff', '#9a6bff')
        + orb('lq-c', '#d4fbff', '#35c9e8')
        + lin('lq-rim', [(0, '#ffffff'), (0.5, '#ffffff'), (1, '#9bb7ff')], 0, 0, 1, 1)
        + rad('lq-h', [(0, '#fff', 0.95), (1, '#fff', 0)], 0.5, 0.5, 0.5)
    )

    def glass(cx: float, cy: float, r: float, fill: str) -> str:
        return (
            f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="url(#{fill})"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{r - 1}" fill="none" stroke="url(#lq-rim)" stroke-width="2.4" stroke-opacity=".8"/>'
            f'<ellipse cx="{cx - r * 0.32}" cy="{cy - r * 0.5}" rx="{r * 0.34}" ry="{r * 0.15}" fill="url(#lq-h)" transform="rotate(-28 {cx - r * 0.32} {cy - r * 0.5})"/>'
            f'<path d="M{cx - r * 0.55} {cy + r * 0.62} A{r * 0.8} {r * 0.8} 0 0 0 {cx + r * 0.62} {cy + r * 0.5}" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="3" stroke-linecap="round"/>'
        )

    body = glass(112, 138, 72, 'lq-b') + glass(206, 108, 62, 'lq-v') + glass(190, 186, 40, 'lq-c') + glass(268, 60, 22, 'lq-b') + glass(40, 60, 16, 'lq-c')
    return defs, body


# ---------------------------------------------------------------- Y2K-хром: хромированная звезда и пузыри
def chrome() -> tuple[str, str]:
    defs = (
        lin('cr-s', [(0, '#ffffff'), (0.22, '#9aa7c7'), (0.42, '#f4f7ff'), (0.55, '#5a6a95'), (0.78, '#cdd6ee'), (1, '#ffffff')], 0, 0, 0, 1)
        + lin('cr-t', [(0, '#fff'), (0.4, '#b6c0dc'), (0.6, '#6b7aa6'), (1, '#e9eefb')], 0, 0, 1, 1)
        + lin('cr-pk', [(0, '#ffe3f6'), (0.5, '#ff7fd0'), (1, '#b02f8c')], 0, 0, 0, 1)
        + rad('cr-b', [(0, '#ffffff', 0.9), (0.35, '#cfe0ff', 0.55), (1, '#4c7bff', 0.55)], 0.32, 0.3, 0.8)
    )
    star = 'M160 14 C170 86 196 112 262 122 C196 132 170 158 160 230 C150 158 124 132 58 122 C124 112 150 86 160 14 Z'
    small = 'M0 -30 C4 -8 10 -4 30 0 C10 4 4 8 0 30 C-4 8 -10 4 -30 0 C-10 -4 -4 -8 0 -30 Z'
    body = (
        f'<path d="{star}" fill="url(#cr-s)" stroke="#ffffff" stroke-width="3" stroke-linejoin="round"/>'
        '<path d="M160 36 C166 90 188 112 236 122" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="3" stroke-linecap="round"/>'
        f'<g transform="translate(262 58) scale(.8)"><path d="{small}" fill="url(#cr-pk)" stroke="#fff" stroke-width="3"/></g>'
        f'<g transform="translate(66 190) scale(.6)"><path d="{small}" fill="url(#cr-t)" stroke="#fff" stroke-width="4"/></g>'
        '<circle cx="64" cy="64" r="26" fill="url(#cr-b)"/><circle cx="64" cy="64" r="25" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="2"/>'
        '<ellipse cx="55" cy="53" rx="9" ry="5" fill="#fff" opacity=".9" transform="rotate(-30 55 53)"/>'
        '<circle cx="262" cy="196" r="20" fill="url(#cr-b)"/><circle cx="262" cy="196" r="19" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="2"/>'
        '<ellipse cx="255" cy="188" rx="7" ry="4" fill="#fff" opacity=".9" transform="rotate(-30 255 188)"/>'
    )
    return defs, body


# ---------------------------------------------------------------- Ретро: пластинка, закат и три полоски
def retro() -> tuple[str, str]:
    defs = (
        lin('rt-sun', [(0, '#ffd24a'), (0.55, '#f0742f'), (1, '#d8402a')], 0, 0, 0, 1)
        + lin('rt-lab', [(0, '#f0742f'), (1, '#e6a532')], 0, 0, 1, 1)
        + rad('rt-sh', [(0, '#fff', 0.35), (1, '#fff', 0)], 0.3, 0.25, 0.7)
        + '<mask id="rt-m"><rect width="320" height="240" fill="#fff"/>'
        + ''.join(f'<rect x="0" y="{y}" width="320" height="{h}" fill="#000"/>' for y, h in [(112, 3), (126, 5), (141, 7), (157, 9), (174, 11)])
        + '</mask>'
    )
    grooves = ''.join(f'<circle cx="104" cy="138" r="{r}" fill="none" stroke="#3a2a20" stroke-width="1.6"/>' for r in (80, 70, 60, 50, 42))
    body = (
        '<g mask="url(#rt-m)"><circle cx="226" cy="108" r="66" fill="url(#rt-sun)"/></g>'
        '<circle cx="104" cy="138" r="90" fill="#1c1410"/>' + grooves
        + '<path d="M104 138 L170 82 A90 90 0 0 1 188 118 Z" fill="#fff" opacity=".07"/>'
        '<circle cx="104" cy="138" r="90" fill="url(#rt-sh)"/>'
        '<circle cx="104" cy="138" r="30" fill="url(#rt-lab)"/><circle cx="104" cy="138" r="22" fill="none" stroke="#fff3d6" stroke-width="2" stroke-dasharray="3 4"/>'
        '<circle cx="104" cy="138" r="5" fill="#f7ead0"/>'
        '<rect x="34" y="208" width="262" height="9" rx="4.5" fill="#d8572a"/><rect x="34" y="221" width="262" height="9" rx="4.5" fill="#e6a532"/><rect x="34" y="234" width="262" height="6" rx="3" fill="#3a6b5a"/>'
    )
    star = lambda x, y, r, c: f'<path transform="translate({x} {y}) scale({r})" d="M0 -8 C1 -2 2 -1 8 0 C2 1 1 2 0 8 C-1 2 -2 1 -8 0 C-2 -1 -1 -2 0 -8 Z" fill="{c}"/>'
    return defs, body + star(286, 40, 1.3, '#e6a532') + star(40, 44, 1.0, '#d8572a') + star(268, 176, 0.8, '#3a6b5a')


# ---------------------------------------------------------------- Баухаус: круг, квадрат и треугольник
def bauhaus() -> tuple[str, str]:
    body = (
        '<rect x="150" y="30" width="124" height="124" fill="#e63a2e"/>'
        '<polygon points="170,228 244,104 318,228" fill="#f2b705"/>'
        '<circle cx="118" cy="140" r="72" fill="#1d4fd8" style="mix-blend-mode:multiply"/>'
        '<rect x="24" y="204" width="270" height="8" fill="#16161a"/>'
        '<circle cx="52" cy="52" r="12" fill="#16161a"/>'
        '<path d="M214 30 A62 62 0 0 1 276 92" fill="none" stroke="#16161a" stroke-width="6"/>'
        '<rect x="26" y="226" width="40" height="8" fill="#e63a2e"/><rect x="72" y="226" width="40" height="8" fill="#f2b705"/><rect x="118" y="226" width="40" height="8" fill="#1d4fd8"/>'
    )
    return '', body


# ---------------------------------------------------------------- Скрапбук: наклейки и скотч
def sticker() -> tuple[str, str]:
    defs = '<filter id="sk-sh" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#5b3a3f" flood-opacity=".35"/></filter>'
    star_path = 'M0 -62 L18 -20 L62 -18 L28 10 L40 54 L0 30 L-40 54 L-28 10 L-62 -18 L-18 -20 Z'
    heart_path = 'M0 52 C-74 -4 -40 -64 0 -24 C40 -64 74 -4 0 52 Z'
    body = (
        f'<g filter="url(#sk-sh)"><g transform="translate(98 112) rotate(-12)"><path d="{star_path}" fill="#fff" stroke="#fff" stroke-width="16" stroke-linejoin="round"/><path d="{star_path}" fill="#ffd23f" stroke="#e8a900" stroke-width="3" stroke-linejoin="round"/>'
        '<circle cx="-12" cy="2" r="4.5" fill="#3b2a3f"/><circle cx="14" cy="2" r="4.5" fill="#3b2a3f"/><path d="M-10 16 Q1 26 12 16" fill="none" stroke="#3b2a3f" stroke-width="3.2" stroke-linecap="round"/></g></g>'
        f'<g filter="url(#sk-sh)"><g transform="translate(214 98) rotate(10)"><path d="{heart_path}" fill="#fff" stroke="#fff" stroke-width="16" stroke-linejoin="round"/><path d="{heart_path}" fill="#ff7aa8" stroke="#e0457c" stroke-width="3" stroke-linejoin="round"/>'
        '<path d="M-34 -22 Q-30 -34 -18 -34" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="5" stroke-linecap="round"/></g></g>'
        '<g filter="url(#sk-sh)"><g transform="translate(160 178)"><circle r="46" fill="#fff"/><circle r="38" fill="#5ec7ff" stroke="#2f9bd6" stroke-width="3"/>'
        '<circle cx="-13" cy="-6" r="5" fill="#3b2a3f"/><circle cx="13" cy="-6" r="5" fill="#3b2a3f"/><path d="M-16 8 Q0 24 16 8" fill="none" stroke="#3b2a3f" stroke-width="3.6" stroke-linecap="round"/>'
        '<ellipse cx="-24" cy="6" rx="6" ry="4" fill="#ff7aa8" opacity=".7"/><ellipse cx="24" cy="6" rx="6" ry="4" fill="#ff7aa8" opacity=".7"/></g></g>'
        # скотч
        '<g transform="translate(60 26) rotate(-24)" opacity=".92"><rect width="96" height="26" rx="2" fill="#8fe3c8"/><path d="M0 0 l4 6 l-4 6 l4 6 l-4 6 l4 2 M96 0 l-4 6 l4 6 l-4 6 l4 6 l-4 2" fill="none" stroke="#8fe3c8" stroke-width="1"/>'
        '<path d="M10 6 H86 M10 13 H86 M10 20 H86" stroke="#fff" stroke-opacity=".5" stroke-width="2" stroke-dasharray="6 5"/></g>'
    )
    spark = lambda x, y, r, c: f'<path transform="translate({x} {y}) scale({r})" d="M0 -8 C1 -2 2 -1 8 0 C2 1 1 2 0 8 C-1 2 -2 1 -8 0 C-2 -1 -1 -2 0 -8 Z" fill="{c}"/>'
    return defs, body + spark(286, 44, 1.3, '#5ec7ff') + spark(34, 200, 1.0, '#ff7aa8') + spark(292, 196, 0.9, '#ffd23f')


# ---------------------------------------------------------------- Тетрадь: клетчатый лист, красное поле и ручка
def notebook() -> tuple[str, str]:
    defs = (
        '<filter id="nb-sh" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#1b1e2b" flood-opacity=".3"/></filter>'
        + lin('nb-pen', [(0, '#5f7cf0'), (1, '#2f4bb5')], 0, 0, 1, 0)
    )
    grid = ''.join(f'<path d="M0 {y} H190" stroke="#3b5bdb" stroke-opacity=".28" stroke-width="1"/>' for y in range(16, 176, 16)) + ''.join(f'<path d="M{x} 0 V176" stroke="#3b5bdb" stroke-opacity=".28" stroke-width="1"/>' for x in range(16, 190, 16))
    rings = ''.join(f'<rect x="-6" y="{y}" width="20" height="9" rx="4.5" fill="#2a2e40"/><circle cx="6" cy="{y + 4.5}" r="2.4" fill="#f6f7f2"/>' for y in range(14, 170, 26))
    body = (
        '<g filter="url(#nb-sh)"><g transform="translate(66 28) rotate(-6)"><rect width="190" height="176" rx="6" fill="#fdfdfb"/>' + grid
        + '<path d="M38 0 V176" stroke="#e03131" stroke-opacity=".75" stroke-width="2"/>' + rings
        + '<path d="M52 36 q8 -10 16 0 t16 0 t16 0 t16 0 t16 0" fill="none" stroke="#3b5bdb" stroke-width="2.6" stroke-linecap="round"/>'
        '<path d="M52 68 q8 -10 16 0 t16 0 t16 0 t16 0" fill="none" stroke="#3b5bdb" stroke-width="2.6" stroke-linecap="round"/>'
        '<path d="M52 100 q8 -10 16 0 t16 0 t16 0 t16 0 t16 0 t16 0" fill="none" stroke="#3b5bdb" stroke-width="2.6" stroke-linecap="round"/>'
        '<text x="112" y="150" font-family="Comic Sans MS, cursive, sans-serif" font-weight="700" font-size="30" fill="#e03131" transform="rotate(-8 112 150)">A+</text></g></g>'
        # ручка
        '<g transform="translate(176 206) rotate(-38)" filter="url(#nb-sh)"><rect x="0" y="-9" width="118" height="18" rx="9" fill="url(#nb-pen)"/><rect x="82" y="-9" width="10" height="18" fill="#fff" opacity=".85"/>'
        '<rect x="96" y="-6" width="3" height="12" fill="#e03131"/><path d="M0 -9 L-22 0 L0 9 Z" fill="#dfe3f0"/><path d="M-22 0 L-30 0 L-22 -2 Z" fill="#2f4bb5"/><rect x="8" y="-5" width="60" height="3" rx="1.5" fill="#fff" opacity=".35"/></g>'
    )
    return defs, body


# ---------------------------------------------------------------- Подземелье: сундук с золотом и самоцветами
def dungeon() -> tuple[str, str]:
    defs = (
        rad('dg-glow', [(0, '#ffd777', 0.85), (0.6, '#e0a030', 0.25), (1, '#e0a030', 0)], 0.5, 0.45, 0.55)
        + lin('dg-wood', [(0, '#9a6532'), (1, '#5b3519')], 0, 0, 0, 1)
        + lin('dg-lid', [(0, '#7a4a22'), (1, '#4a2b14')], 0, 0, 0, 1)
        + lin('dg-gold', [(0, '#fff0a0'), (0.5, '#f1c23b'), (1, '#b8851f')], 0, 0, 1, 1)
        + lin('dg-iron', [(0, '#5a6070'), (1, '#2a2e3a')], 0, 0, 0, 1)
    )
    coin = lambda x, y, r: f'<circle cx="{x}" cy="{y}" r="{r}" fill="url(#dg-gold)" stroke="#8a6212" stroke-width="2"/><circle cx="{x}" cy="{y}" r="{r * 0.55:.1f}" fill="none" stroke="#b8851f" stroke-width="1.6"/>'
    coins = ''.join(coin(x, y, r) for x, y, r in [(112, 140, 11), (134, 132, 11), (156, 128, 11), (178, 130, 11), (200, 134, 11), (222, 142, 11), (124, 118, 10), (148, 112, 10), (172, 112, 10), (196, 118, 10), (160, 98, 10), (136, 100, 9), (184, 100, 9)])
    body = (
        '<circle cx="162" cy="122" r="112" fill="url(#dg-glow)"/>'
        # открытая крышка (вид сзади)
        '<path d="M96 138 L108 52 Q162 28 216 52 L228 138 Z" fill="url(#dg-lid)" stroke="#2a180b" stroke-width="3"/>'
        '<path d="M130 40 L124 138 M194 40 L200 138" stroke="url(#dg-iron)" stroke-width="12"/>'
        '<path d="M108 52 Q162 28 216 52" fill="none" stroke="url(#dg-iron)" stroke-width="10" stroke-linecap="round"/>'
        + coins +
        # самоцветы
        '<path d="M150 82 l12 -14 l12 14 l-12 20 Z" fill="#e0457c" stroke="#7a1f3f" stroke-width="2"/><path d="M150 82 h24 M162 68 l-4 14 l4 20 l4 -20 Z" stroke="#fff" stroke-opacity=".45" stroke-width="1.5" fill="none"/>'
        '<path d="M206 104 l9 -10 l9 10 l-9 14 Z" fill="#4a9dff" stroke="#1c3f9e" stroke-width="2"/>'
        # корпус
        '<rect x="86" y="140" width="152" height="78" rx="10" fill="url(#dg-wood)" stroke="#2a180b" stroke-width="3"/>'
        '<path d="M86 164 H238 M86 190 H238" stroke="#2a180b" stroke-opacity=".5" stroke-width="2"/>'
        '<rect x="86" y="140" width="18" height="78" rx="6" fill="url(#dg-iron)"/><rect x="220" y="140" width="18" height="78" rx="6" fill="url(#dg-iron)"/>'
        '<rect x="86" y="140" width="152" height="14" rx="5" fill="url(#dg-iron)"/>'
        '<rect x="148" y="150" width="28" height="34" rx="5" fill="url(#dg-gold)" stroke="#8a6212" stroke-width="2"/><circle cx="162" cy="164" r="4.5" fill="#2a180b"/><rect x="160" y="166" width="4" height="10" rx="2" fill="#2a180b"/>'
        + ''.join(f'<circle cx="{x}" cy="{y}" r="2.6" fill="#d9c38a"/>' for x, y in [(95, 150), (95, 208), (229, 150), (229, 208)])
    )
    spark = lambda x, y, r: f'<path transform="translate({x} {y}) scale({r})" d="M0 -8 C1 -2 2 -1 8 0 C2 1 1 2 0 8 C-1 2 -2 1 -8 0 C-2 -1 -1 -2 0 -8 Z" fill="#ffe9a0"/>'
    return defs, body + spark(44, 70, 1.3) + spark(282, 56, 1.1) + spark(272, 190, 0.9) + spark(48, 190, 0.8)


# id -> (рисунок, фон значка: два цвета градиента)
ART = {
    'coquette': (coquette, ('#ffe7ef', '#f6b6cb')),
    'gothic': (gothic, ('#24101a', '#0e0b10')),
    'clay': (clay, ('#f3e9ff', '#d9c7fb')),
    'liquid': (liquid, ('#1a2650', '#0c1224')),
    'chrome': (chrome, ('#d8def0', '#aab6d6')),
    'retro': (retro, ('#f7e0b0', '#e9b45a')),
    'bauhaus': (bauhaus, ('#f2efe6', '#d9d3bd')),
    'sticker': (sticker, ('#fff0b8', '#ffc6dc')),
    'notebook': (notebook, ('#eef2ff', '#c9d3f5')),
    'dungeon': (dungeon, ('#3b2412', '#140f0b')),
}

def main() -> None:
    for sid, (fn, (c1, c2)) in ART.items():
        defs, body = fn()
        out = SRC / sid / 'svg'
        out.mkdir(parents=True, exist_ok=True)
        (out / 'hero.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240"><defs>{defs}</defs>{body}</svg>\n', encoding='utf-8')
        bg = f'<linearGradient id="bg-{sid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/></linearGradient>'
        (out / 'thumb.svg').write_text(
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 112"><defs>{defs}{bg}</defs><rect width="112" height="112" fill="url(#bg-{sid})"/>'
            f'<g transform="translate(-18.7 0) scale(.4667)">{body}</g></svg>\n',
            encoding='utf-8',
        )
        print(sid, 'ok')


if __name__ == '__main__':
    main()
