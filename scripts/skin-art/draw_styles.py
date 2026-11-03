#!/usr/bin/env python3
"""
Рисует картинки «стилевых» образов (Кокетка, Готика, Глина, Жидкое стекло, Y2K-хром, Ретро, Баухаус, Скрапбук, Тетрадь, Подземелье, Граффити, Кофейня, Навруз, Новый год, Хэллоуин, 14 февраля, Бенто) векторными рисунками: ничьих чужих материалов в них нет, всё нарисовано здесь.
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


# ---------------------------------------------------------------- Граффити: баллончик, корона и брызги
def graffiti() -> tuple[str, str]:
    defs = (
        lin('gf-can', [(0, '#f4f5f8'), (0.5, '#c9ccd6'), (1, '#8d92a3')], 0, 0, 1, 0)
        + rad('gf-spray', [(0, '#00e0b0', 0.85), (1, '#00e0b0', 0)], 0.5, 0.5, 0.5)
    )
    ink = '#17171c'
    splat = 'M60 150 C40 130 52 100 80 104 C84 80 118 76 128 98 C152 92 170 112 158 134 C176 150 160 178 136 170 C124 190 92 190 84 170 C66 176 48 164 60 150 Z'
    body = (
        # бирюзовое облако и розовая клякса с потёками
        '<circle cx="118" cy="120" r="84" fill="url(#gf-spray)"/>'
        f'<path d="{splat}" fill="#ff3d71" stroke="{ink}" stroke-width="5" stroke-linejoin="round" transform="translate(-6 20)"/>'
        f'<g fill="#ff3d71" stroke="{ink}" stroke-width="4"><rect x="54" y="176" width="12" height="38" rx="6"/><rect x="92" y="186" width="12" height="26" rx="6"/><rect x="128" y="174" width="12" height="44" rx="6"/></g>'
        # корона
        f'<path d="M58 118 L70 66 L96 96 L122 56 L148 96 L174 66 L186 118 Z" fill="#ffd400" stroke="{ink}" stroke-width="5" stroke-linejoin="round"/>'
        f'<rect x="58" y="118" width="128" height="16" rx="3" fill="#ffd400" stroke="{ink}" stroke-width="5"/>'
        f'<circle cx="70" cy="62" r="6" fill="#ff3d71" stroke="{ink}" stroke-width="3"/><circle cx="122" cy="52" r="6" fill="#00e0b0" stroke="{ink}" stroke-width="3"/><circle cx="174" cy="62" r="6" fill="#ff3d71" stroke="{ink}" stroke-width="3"/>'
        # баллончик
        f'<g transform="translate(236 122) rotate(18)"><rect x="-34" y="-8" width="68" height="110" rx="14" fill="url(#gf-can)" stroke="{ink}" stroke-width="5"/>'
        f'<rect x="-34" y="30" width="68" height="26" fill="#ff3d71" stroke="{ink}" stroke-width="4"/>'
        f'<rect x="-22" y="-32" width="44" height="30" rx="8" fill="{ink}"/><rect x="-6" y="-46" width="12" height="16" rx="3" fill="#ffd400" stroke="{ink}" stroke-width="3"/>'
        '<path d="M-24 4 V92" stroke="#fff" stroke-opacity=".6" stroke-width="5" stroke-linecap="round"/></g>'
        '<g fill="#00e0b0"><circle cx="196" cy="62" r="5"/><circle cx="178" cy="46" r="3.6"/><circle cx="206" cy="42" r="4"/><circle cx="188" cy="30" r="2.8"/><circle cx="212" cy="76" r="3"/></g>'
        f'<path d="M26 210 C60 236 120 236 160 214 M146 202 L162 214 L142 224" fill="none" stroke="{ink}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>'
    )
    return defs, body


# ---------------------------------------------------------------- Кофейня: чашка, круассан и пар
def cafe() -> tuple[str, str]:
    defs = (
        lin('cf-cup', [(0, '#e9dcff'), (1, '#b79cf5')], 0, 0, 1, 1)
        + lin('cf-cof', [(0, '#8a5a3a'), (1, '#4a2b1a')], 0, 0, 0, 1)
        + lin('cf-cro', [(0, '#ffd0a0'), (0.5, '#f5a05a'), (1, '#c8702a')], 0, 0, 0, 1)
        + lin('cf-pl', [(0, '#ffffff'), (1, '#c8cdf0')], 0, 0, 0, 1)
    )
    steam = ''.join(f'<path d="M{x} 78 C{x - 14} 58 {x + 14} 46 {x} 24" fill="none" stroke="#cdd6f4" stroke-opacity=".75" stroke-width="6" stroke-linecap="round"/>' for x in (130, 160, 190))
    body = (
        steam
        + '<ellipse cx="160" cy="206" rx="112" ry="20" fill="url(#cf-pl)" stroke="#9aa4d8" stroke-width="3"/><ellipse cx="160" cy="200" rx="86" ry="13" fill="#e3e6fb"/>'
        '<path d="M96 96 H224 V150 C224 188 196 206 160 206 C124 206 96 188 96 150 Z" fill="url(#cf-cup)" stroke="#7c5bd0" stroke-width="4" stroke-linejoin="round"/>'
        '<path d="M224 108 C262 100 266 160 222 160" fill="none" stroke="#7c5bd0" stroke-width="10" stroke-linecap="round"/><path d="M224 108 C258 102 262 156 222 156" fill="none" stroke="#b79cf5" stroke-width="5" stroke-linecap="round"/>'
        '<ellipse cx="160" cy="96" rx="64" ry="14" fill="url(#cf-cof)" stroke="#7c5bd0" stroke-width="4"/>'
        '<path d="M160 100 C132 88 146 74 160 86 C174 74 188 88 160 100 Z" fill="#fbe9d0" transform="translate(0 -3) scale(1 .8) translate(0 20)"/>'
        '<path d="M110 120 C112 160 130 186 150 190" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="5" stroke-linecap="round"/>'
        # круассан
        '<g transform="translate(52 196) rotate(-14)"><path d="M-44 6 C-40 -30 -6 -42 0 -42 C6 -42 40 -30 44 6 C30 18 -30 18 -44 6 Z" fill="url(#cf-cro)" stroke="#9a5420" stroke-width="3.5" stroke-linejoin="round"/>'
        '<path d="M-22 -26 C-18 -6 -16 4 -16 12 M0 -34 C2 -12 2 4 2 14 M22 -26 C18 -6 16 4 16 12" fill="none" stroke="#9a5420" stroke-opacity=".7" stroke-width="3" stroke-linecap="round"/></g>'
        # зёрна
        + ''.join(f'<g transform="translate({x} {y}) rotate({r})"><ellipse rx="9" ry="12" fill="#5a3520" stroke="#2a180b" stroke-width="2"/><path d="M0 -10 C-4 -3 4 3 0 10" fill="none" stroke="#2a180b" stroke-width="2"/></g>' for x, y, r in [(272, 202, 30), (292, 180, -20), (256, 224, 60), (36, 70, 20), (292, 60, -40)])
    )
    return defs, body


# ---------------------------------------------------------------- Навруз: тюльпаны, солнце и расписное яйцо
def nowruz() -> tuple[str, str]:
    defs = (
        rad('nw-sun', [(0, '#fff3a0', 1), (1, '#f5c518', 1)], 0.4, 0.35, 0.8)
        + lin('nw-leaf', [(0, '#6fdc95'), (1, '#2f9e5b')], 0, 0, 1, 1)
        + lin('nw-egg', [(0, '#fff2d6'), (1, '#f1b8d0')], 0, 0, 0, 1)
    )

    def tulip(x: float, y: float, c1: str, c2: str, s: float = 1.0) -> str:
        return (
            f'<g transform="translate({x} {y}) scale({s})">'
            f'<path d="M0 0 C-2 40 -2 70 0 110" fill="none" stroke="#2f9e5b" stroke-width="6" stroke-linecap="round"/>'
            f'<path d="M0 108 C-30 96 -40 60 -34 34 C-14 50 -4 76 0 108 Z" fill="url(#nw-leaf)" stroke="#1f7a45" stroke-width="2"/>'
            f'<path d="M0 108 C30 98 40 66 34 44 C14 56 4 80 0 108 Z" fill="url(#nw-leaf)" stroke="#1f7a45" stroke-width="2"/>'
            f'<path d="M-24 -30 C-30 10 -12 30 0 30 C12 30 30 10 24 -30 L12 -12 L0 -34 L-12 -12 Z" fill="{c1}" stroke="{c2}" stroke-width="3" stroke-linejoin="round"/>'
            f'<path d="M-6 -4 C-8 10 -4 22 0 26 C4 22 8 10 6 -4" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="3" stroke-linecap="round"/></g>'
        )

    rays = ''.join(f'<path transform="rotate({a} 70 70)" d="M70 8 V24" stroke="#f5c518" stroke-width="6" stroke-linecap="round"/>' for a in range(0, 360, 30))
    body = (
        f'<g transform="translate(14 8)">{rays}<circle cx="70" cy="70" r="40" fill="url(#nw-sun)" stroke="#e0a800" stroke-width="3"/></g>'
        + tulip(150, 100, '#ff5f8f', '#c2306a', 1.05) + tulip(210, 112, '#ffd23f', '#d89a00', 0.95) + tulip(104, 128, '#e63a2e', '#a01c14', 0.85)
        # расписное яйцо
        + '<g transform="translate(266 192) rotate(12)"><path d="M0 -40 C28 -40 38 -4 38 14 C38 40 20 50 0 50 C-20 50 -38 40 -38 14 C-38 -4 -28 -40 0 -40 Z" fill="url(#nw-egg)" stroke="#c2306a" stroke-width="3"/>'
        '<path d="M-36 6 L-24 -6 L-12 6 L0 -6 L12 6 L24 -6 L36 6" fill="none" stroke="#2f9e5b" stroke-width="4" stroke-linejoin="round"/><path d="M-34 26 L-22 16 L-10 26 L2 16 L14 26 L26 16 L36 24" fill="none" stroke="#ff5f8f" stroke-width="4" stroke-linejoin="round"/>'
        '<circle cx="-14" cy="-20" r="4" fill="#ffd23f"/><circle cx="12" cy="-22" r="3.4" fill="#2f9e5b"/></g>'
        # цветки и росточки
        + ''.join(f'<g transform="translate({x} {y})"><circle r="5" fill="#fff3a0"/>' + ''.join(f'<circle cx="{7 * __import__("math").cos(a):.1f}" cy="{7 * __import__("math").sin(a):.1f}" r="4.2" fill="#ffffff" stroke="#f1b8d0" stroke-width="1.2"/>' for a in [i * 1.2566 for i in range(5)]) + '</g>' for x, y in [(40, 190), (74, 214), (296, 70)])
    )
    return defs, body


# ---------------------------------------------------------------- Новый год: ёлка, подарки и снежинки
def christmas() -> tuple[str, str]:
    import math

    defs = (
        lin('xm-tree', [(0, '#3fb27a'), (1, '#14633c')], 0, 0, 0, 1)
        + lin('xm-gold', [(0, '#fff0a0'), (0.5, '#f1c40f'), (1, '#c28f00')], 0, 0, 1, 1)
        + lin('xm-gift1', [(0, '#ff6b64'), (1, '#b3261f')], 0, 0, 0, 1)
        + lin('xm-gift2', [(0, '#5aa8ff'), (1, '#2b62c9')], 0, 0, 0, 1)
    )
    tier = lambda cx, top, bot, half: f'<path d="M{cx} {top} L{cx + half} {bot} Q{cx} {bot + 12} {cx - half} {bot} Z" fill="url(#xm-tree)" stroke="#0f4a2c" stroke-width="3" stroke-linejoin="round"/>'
    ball = lambda x, y, r, c: f'<circle cx="{x}" cy="{y}" r="{r}" fill="{c}" stroke="#fff" stroke-opacity=".5" stroke-width="1.5"/><circle cx="{x - r * 0.3:.1f}" cy="{y - r * 0.3:.1f}" r="{r * 0.28:.1f}" fill="#fff" opacity=".7"/>'

    def flake(x: float, y: float, r: float) -> str:
        arms = ''.join(f'<path transform="rotate({a} {x} {y})" d="M{x} {y - r} V{y + r} M{x - r * 0.3} {y - r * 0.7} L{x} {y - r * 0.4} L{x + r * 0.3} {y - r * 0.7}" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/>' for a in (0, 60, 120))
        return arms

    body = (
        '<ellipse cx="160" cy="226" rx="140" ry="12" fill="#ffffff" opacity=".9"/>'
        '<rect x="148" y="190" width="24" height="32" fill="#8a5a2b" stroke="#5b3519" stroke-width="3"/>'
        + tier(160, 98, 150, 56) + tier(160, 64, 110, 46) + tier(160, 30, 74, 34) + tier(160, 128, 196, 70)
        + '<path d="M118 150 Q160 168 204 150" fill="none" stroke="#f1c40f" stroke-width="3.4" stroke-linecap="round" stroke-dasharray="1 7"/>'
        '<path d="M126 110 Q160 124 196 110" fill="none" stroke="#f1c40f" stroke-width="3.4" stroke-linecap="round" stroke-dasharray="1 7"/>'
        + ball(140, 168, 7, '#ff6b64') + ball(184, 176, 7, '#5aa8ff') + ball(160, 140, 6, '#f1c40f') + ball(138, 120, 5, '#5aa8ff') + ball(178, 96, 5, '#ff6b64') + ball(160, 70, 5, '#f1c40f')
        + '<path d="M160 6 L166 22 L184 22 L170 32 L175 48 L160 38 L145 48 L150 32 L136 22 L154 22 Z" fill="url(#xm-gold)" stroke="#a87a00" stroke-width="2.5" stroke-linejoin="round"/>'
        # подарки
        '<g><rect x="44" y="184" width="52" height="42" rx="4" fill="url(#xm-gift1)" stroke="#7a1612" stroke-width="2.5"/><rect x="66" y="184" width="8" height="42" fill="#f1c40f"/><rect x="44" y="200" width="52" height="8" fill="#f1c40f"/>'
        '<path d="M70 184 C56 170 44 178 56 184 M70 184 C84 170 96 178 84 184" fill="none" stroke="#f1c40f" stroke-width="4" stroke-linecap="round"/></g>'
        '<g><rect x="228" y="192" width="46" height="34" rx="4" fill="url(#xm-gift2)" stroke="#1c3f8a" stroke-width="2.5"/><rect x="246" y="192" width="8" height="34" fill="#fff"/><rect x="228" y="204" width="46" height="7" fill="#fff"/></g>'
        + flake(48, 52, 14) + flake(276, 70, 12) + flake(262, 140, 9) + flake(70, 120, 8) + flake(296, 32, 8)
    )
    return defs, body


# ---------------------------------------------------------------- Хэллоуин: тыква, луна и летучие мыши
def halloween() -> tuple[str, str]:
    defs = (
        rad('hw-pump', [(0, '#ffb15a', 1), (0.6, '#ff7a18', 1), (1, '#c4510a', 1)], 0.4, 0.3, 0.85)
        + rad('hw-moon', [(0, '#fffbe0', 1), (1, '#f0dc8a', 1)], 0.4, 0.35, 0.8)
        + rad('hw-glow', [(0, '#ffe066', 0.9), (1, '#ffe066', 0)], 0.5, 0.5, 0.5)
    )
    bat = lambda x, y, sc: f'<g transform="translate({x} {y}) scale({sc})"><path d="M0 0 C-6 -10 -18 -12 -30 -6 C-24 -4 -22 2 -18 6 C-14 2 -8 2 -4 8 C-2 4 2 4 4 8 C8 2 14 2 18 6 C22 2 24 -4 30 -6 C18 -12 6 -10 0 0 Z" fill="#1a0f26" stroke="#7a3fd1" stroke-width="1.4"/><circle cx="-3" cy="-2" r="1.2" fill="#ffe066"/><circle cx="3" cy="-2" r="1.2" fill="#ffe066"/></g>'
    body = (
        '<circle cx="262" cy="62" r="46" fill="url(#hw-glow)"/><circle cx="262" cy="62" r="30" fill="url(#hw-moon)"/><circle cx="252" cy="54" r="5" fill="#e6d06a" opacity=".6"/><circle cx="272" cy="70" r="4" fill="#e6d06a" opacity=".5"/>'
        + bat(214, 40, 1.0) + bat(70, 56, 0.8) + bat(290, 126, 0.6)
        + '<ellipse cx="160" cy="224" rx="104" ry="10" fill="#000" opacity=".28"/>'
        '<path d="M156 78 C154 62 164 50 176 44 C176 54 172 64 168 78 Z" fill="#3aa05a" stroke="#1f6a38" stroke-width="3" stroke-linejoin="round"/>'
        '<ellipse cx="98" cy="146" rx="62" ry="68" fill="url(#hw-pump)" stroke="#8a3a06" stroke-width="3.5" transform="translate(62 0)"/>'
        '<ellipse cx="124" cy="146" rx="38" ry="70" fill="none" stroke="#c4510a" stroke-opacity=".55" stroke-width="3" transform="translate(36 0)"/>'
        '<ellipse cx="160" cy="146" rx="22" ry="70" fill="none" stroke="#c4510a" stroke-opacity=".55" stroke-width="3"/>'
        '<ellipse cx="196" cy="146" rx="38" ry="70" fill="none" stroke="#c4510a" stroke-opacity=".55" stroke-width="3" transform="translate(-36 0)"/>'
        # лицо
        '<path d="M120 124 L140 108 L148 134 Z M200 124 L180 108 L172 134 Z" fill="#ffe066" stroke="#3b1f66" stroke-width="3" stroke-linejoin="round"/>'
        '<path d="M158 150 L160 160 L162 150 Z" fill="#ffe066" stroke="#3b1f66" stroke-width="2.5"/>'
        '<path d="M112 168 C130 198 190 198 208 168 L196 168 L190 180 L180 168 L170 182 L160 168 L150 182 L140 168 L130 180 L124 168 Z" fill="#ffe066" stroke="#3b1f66" stroke-width="3" stroke-linejoin="round"/>'
        '<path d="M88 100 C86 128 90 160 98 182" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="5" stroke-linecap="round"/>'
    )
    spark = lambda x, y, r: f'<path transform="translate({x} {y}) scale({r})" d="M0 -8 C1 -2 2 -1 8 0 C2 1 1 2 0 8 C-1 2 -2 1 -8 0 C-2 -1 -1 -2 0 -8 Z" fill="#b78cff"/>'
    return defs, body + spark(44, 120, 1.2) + spark(300, 200, 1.0) + spark(40, 200, 0.8)


# ---------------------------------------------------------------- 14 февраля: сердце со стрелой и письмо
def valentine() -> tuple[str, str]:
    defs = (
        lin('vl-h', [(0, '#ff8fb0'), (0.5, '#e0295a'), (1, '#a8123e')], 0, 0, 1, 1)
        + lin('vl-env', [(0, '#fff6f8'), (1, '#f7c9d6')], 0, 0, 0, 1)
        + lin('vl-gold', [(0, '#fff0a0'), (1, '#c28f00')], 0, 0, 1, 1)
    )
    heart = lambda x, y, sc, fill: f'<path transform="translate({x} {y}) scale({sc})" d="M0 44 C-70 -6 -38 -62 0 -22 C38 -62 70 -6 0 44 Z" fill="{fill}"/>'
    body = (
        heart(148, 112, 1.5, 'url(#vl-h)')
        + '<path d="M82 86 Q96 56 128 62" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="7" stroke-linecap="round"/>'
        # стрела
        '<g transform="rotate(-28 160 118)"><rect x="40" y="114" width="240" height="7" rx="3.5" fill="url(#vl-gold)" stroke="#8a6212" stroke-width="2"/>'
        '<path d="M280 117 L306 117 L292 106 Z M280 117 L306 117 L292 128 Z" fill="#fff" stroke="#8a6212" stroke-width="2" stroke-linejoin="round"/>'
        '<path d="M40 117 L22 104 L22 130 Z" fill="#ffd0dc" stroke="#8a6212" stroke-width="2" stroke-linejoin="round"/></g>'
        # письмо
        '<g transform="translate(236 196) rotate(8)"><rect x="-44" y="-30" width="88" height="60" rx="6" fill="url(#vl-env)" stroke="#d6204f" stroke-width="3"/>'
        '<path d="M-44 -26 L0 6 L44 -26" fill="none" stroke="#d6204f" stroke-width="3" stroke-linejoin="round"/>'
        '<path transform="translate(0 4) scale(.5)" d="M0 44 C-70 -6 -38 -62 0 -22 C38 -62 70 -6 0 44 Z" fill="#d6204f"/></g>'
        + heart(40, 56, 0.4, '#ff8fb0') + heart(286, 60, 0.5, '#ff5c8a') + heart(70, 206, 0.35, '#ff5c8a') + heart(180, 36, 0.3, '#ffb3c8') + heart(300, 120, 0.28, '#ff8fb0')
    )
    return defs, body


# ---------------------------------------------------------------- Бенто: коробка с плитками разного размера
def bento() -> tuple[str, str]:
    body = (
        '<rect x="14" y="20" width="292" height="204" rx="26" fill="#fff" fill-opacity=".14" stroke="#fff" stroke-opacity=".5" stroke-width="3"/>'
        # большая коралловая плитка со столбиками
        '<rect x="26" y="32" width="132" height="110" rx="20" fill="#ff7a59"/>'
        '<g fill="#fff"><rect x="48" y="96" width="18" height="30" rx="5"/><rect x="74" y="78" width="18" height="48" rx="5"/><rect x="100" y="60" width="18" height="66" rx="5"/><rect x="126" y="48" width="14" height="78" rx="5" opacity=".75"/></g>'
        # мятное кольцо
        '<rect x="170" y="32" width="124" height="68" rx="20" fill="#3dd6a0"/><circle cx="214" cy="66" r="22" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="9"/><path d="M214 44 A22 22 0 1 1 194 76" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round"/>'
        '<rect x="248" y="56" width="32" height="8" rx="4" fill="#fff"/><rect x="248" y="72" width="22" height="8" rx="4" fill="#fff" opacity=".7"/>'
        # тёмная плитка с сердцем
        '<rect x="170" y="112" width="60" height="64" rx="20" fill="#1e293b"/><path transform="translate(200 146) scale(.42)" d="M0 44 C-70 -6 -38 -62 0 -22 C38 -62 70 -6 0 44 Z" fill="#ff7a59"/>'
        # жёлтая монета
        '<rect x="238" y="112" width="56" height="64" rx="20" fill="#ffd23f"/><circle cx="266" cy="144" r="16" fill="#fff" fill-opacity=".55"/><path d="M266 134 V154 M259 140 H273 M259 148 H273" stroke="#c28f00" stroke-width="3.5" stroke-linecap="round"/>'
        # нижние плитки
        '<rect x="26" y="154" width="64" height="58" rx="20" fill="#b79cf5"/><path d="M42 188 L52 174 L62 184 L74 166" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'
        '<rect x="98" y="154" width="60" height="58" rx="20" fill="#1e293b"/><circle cx="128" cy="183" r="16" fill="none" stroke="#3dd6a0" stroke-width="7"/><path d="M128 171 V183 L137 188" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/>'
        '<rect x="170" y="188" width="124" height="24" rx="12" fill="#fff" fill-opacity=".9"/><rect x="184" y="196" width="60" height="8" rx="4" fill="#1e293b" opacity=".75"/><circle cx="270" cy="200" r="6" fill="#ff7a59"/>'
    )
    return '', body


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
    'graffiti': (graffiti, ('#2e2e3a', '#17171c')),
    'cafe': (cafe, ('#3a3a55', '#1e1e2e')),
    'nowruz': (nowruz, ('#e5f6d8', '#f6e08a')),
    'christmas': (christmas, ('#16315a', '#0b1d33')),
    'halloween': (halloween, ('#2a1a42', '#140a1f')),
    'valentine': (valentine, ('#ffd9e3', '#ff9ab6')),
    'bento': (bento, ('#ff9a7e', '#1e293b')),
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
