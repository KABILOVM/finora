#!/usr/bin/env python3
"""
Рисует картинки «стилевых» образов (Кокетка, Готика, Глина, Жидкое стекло, Y2K-хром…) векторными рисунками: ничьих чужих материалов в них нет, всё нарисовано здесь.
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


# id -> (рисунок, фон значка: два цвета градиента)
ART = {
    'coquette': (coquette, ('#ffe7ef', '#f6b6cb')),
    'gothic': (gothic, ('#24101a', '#0e0b10')),
    'clay': (clay, ('#f3e9ff', '#d9c7fb')),
    'liquid': (liquid, ('#1a2650', '#0c1224')),
    'chrome': (chrome, ('#d8def0', '#aab6d6')),
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
