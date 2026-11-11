#!/usr/bin/env python3
"""
Нарисованные образы (scripts/skin-art/new-skins.json): собирает их палитры и блоки украшений и вписывает в src/index.css между отметками.

Запуск из корня репозитория:
  python3 scripts/skin-art/gen_new_skins.py           — пересобрать блоки в src/index.css
  python3 scripts/skin-art/gen_new_skins.py --check   — только проверить, что index.css совпадает (выход 1, если нет)
  python3 scripts/skin-art/gen_new_skins.py --ts      — напечатать строки для src/skinCore.ts, src/skins.ts, src/skinIcons.ts и реестра наборов

Палитра каждого образа выводится из трёх «зерновых» цветов (главный, второй, цвет рамки) и двух фонов (светлый и тёмный) теми же правилами,
что у остальных образов (skin_palette.py): цвет, который не проходит контраст, сдвигается к чёрному или белому ровно настолько, чтобы пройти.
Картинки образов рисует отдельный скрипт — scripts/skin-art/gen_scenes.mjs.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from skin_palette import BLACK, WHITE, build, check, css, h2r, mix, r2h, trip  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CSS = ROOT / 'src' / 'index.css'
SPEC = json.loads((Path(__file__).parent / 'new-skins.json').read_text(encoding='utf-8'))['skins']

PAL_BEGIN = '/* >>> нарисованные образы, палитры: не править руками, `python3 scripts/skin-art/gen_new_skins.py` */'
PAL_END = '/* <<< нарисованные образы, палитры */'
EXT_BEGIN = '/* >>> нарисованные образы, украшения: не править руками, `python3 scripts/skin-art/gen_new_skins.py` */'
EXT_END = '/* <<< нарисованные образы, украшения */'

SERIF = {'Alegreya', 'Lora', 'Forum', 'Cormorant Garamond', 'Podkova'}
UPPER = {'Oswald', 'Tektur', 'mono'}


def seeds(s):
    """Зерновые цвета образа → полный набор семян для skin_palette.build."""
    p, q = h2r(s['primary']), h2r(s['secondary'])
    bg_l, bg_d = h2r(s['bgL']), h2r(s['bgD'])
    brand_d = h2r(s['brandD']) if 'brandD' in s else mix(p, WHITE, .5)
    return {
        'label': s['label'],
        'bgL': r2h(bg_l), 's2L': r2h(mix(bg_l, p, .09)), 'textL': r2h(mix(BLACK, p, .22)),
        'brandL': s['primary'], 'accentL': s['secondary'], 'heroL': s.get('hero', r2h(mix(p, BLACK, .5))), 'lineC': s['line'],
        'bgD': r2h(bg_d), 'surfD': r2h(mix(bg_d, WHITE, .055)), 's2D': r2h(mix(bg_d, WHITE, .11)), 'textD': r2h(mix(WHITE, p, .07)),
        'brandD': r2h(brand_d), 'accentD': r2h(mix(q, WHITE, .45)),
        'heroFromD': r2h(mix(p, BLACK, .3)), 'heroD': r2h(mix(h2r(s.get('hero', r2h(mix(p, BLACK, .5)))), BLACK, .35)),
    }


def existing_values(text):
    """Значения главных цветов и фонов у образов, которые уже есть в index.css вне наших отметок (чтобы новые с ними не совпали)."""
    outside = text
    if PAL_BEGIN in text and PAL_END in text:
        outside = text[:text.index(PAL_BEGIN)] + text[text.index(PAL_END):]
    taken = {k: set() for k in ('ac-brand-l', 'ac-brand-d', 'ac-bg-l', 'ac-bg-d')}
    for block in re.finditer(r":root\[data-skin='[a-z0-9]+'\][^{]*\{([^}]*)\}", outside):
        for k in taken:
            m = re.search(rf'--{k}: (\d+ \d+ \d+);', block.group(1))
            if m:
                taken[k].add(m.group(1))
    return taken


def nudge(rgb, taken):
    """Сдвигает цвет на единицу по синему каналу, пока он не станет единственным: тест требует, чтобы главные цвета и фоны образов не повторялись."""
    r, g, b = [int(round(v)) for v in rgb]
    step = -1 if b > 127 else 1
    while f'{r} {g} {b}' in taken:
        b += step
    taken.add(f'{r} {g} {b}')
    return (r, g, b)


def pattern(kind, s):
    p = trip(h2r(s['primary']))
    line = trip(h2r(s['line']))
    return {
        'stripes': (f'repeating-linear-gradient(90deg, rgb({p} / 0.05) 0 26px, transparent 26px 52px)', None),
        'diag': (f'repeating-linear-gradient(135deg, rgb({p} / 0.05) 0 2px, transparent 2px 14px)', None),
        'dots': (f'radial-gradient(rgb({p} / 0.13) 1.5px, transparent 2px)', '20px 20px'),
        'stars': (f'radial-gradient(rgb({line} / 0.55) 1px, transparent 1.5px)', '38px 38px'),
        'scales': (f'radial-gradient(circle at 50% 100%, transparent 10px, rgb({p} / 0.1) 10px 11.5px, transparent 11.5px)', '24px 12px'),
        'checks': (f'conic-gradient(rgb({p} / 0.05) 25%, transparent 0 50%, rgb({p} / 0.05) 0 75%, transparent 0)', '28px 28px'),
        'grid': (f'linear-gradient(rgb({p} / 0.07) 1px, transparent 1px), linear-gradient(90deg, rgb({p} / 0.07) 1px, transparent 1px)', '24px 24px'),
        'veins': (f'repeating-linear-gradient(115deg, transparent 0 38px, rgb({p} / 0.07) 38px 39px, transparent 39px 91px)', None),
    }[kind]


def extras(s):
    font = s['font']
    if font == 'mono':
        head = "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"
    elif font in SERIF:
        head = f"'{font}', 'Onest', Georgia, serif"
    else:
        head = f"'{font}', 'Onest', ui-sans-serif, system-ui, sans-serif"
    image, size = pattern(s['pattern'], s)
    out = f"html[data-skin='{s['id']}'] {{\n  --skin-head: {head};\n"
    if font in UPPER:
        out += '  --skin-head-tt: uppercase;\n  --skin-head-ls: 0.04em;\n'
    if font == 'Cormorant Garamond':
        out += '  --skin-head-adjust: 0.5;\n'
    out += f'  --skin-pattern: {image};\n'
    if size:
        out += f'  --skin-pattern-size: {size};\n'
    out += f"  --skin-line: {trip(h2r(s['line']))};\n"
    out += f"  --skin-art: url('./assets/skins/art/{s['id']}-hero.webp');\n  --skin-art-content: '';\n"
    # рисунок меньше карточки и прижат к правому нижнему углу: сумма и подписи остаются на чистом фоне (см. .skin-hero::after в look.css)
    out += '  --skin-art-size: auto 76%;\n  --skin-art-pos: right bottom;\n}\n'
    return out


def generate(text):
    taken = existing_values(text)
    pal, ext, bars, bad_any = '', '', {}, False
    palettes = {}
    for s in SPEC:
        p = build(seeds(s))
        for key in ('brand-l', 'brand-d', 'bg-l', 'bg-d'):
            p[key] = nudge(p[key], taken[f'ac-{key}'])
        bad = check(s['id'], p)
        if bad:
            bad_any = True
            print(s['id'].ljust(14), bad, file=sys.stderr)
        # тот же блок годится и для предпросмотра образа в витрине: палитру берёт любой элемент с data-skin-scope
        pal += f"/* {s['label']} */\n" + css(s['id'], p).replace(f":root[data-skin='{s['id']}'] {{", f":root[data-skin='{s['id']}'], [data-skin-scope='{s['id']}'] {{")
        ext += extras(s)
        bars[s['id']] = (r2h(p['bg-l']), r2h(p['bg-d']))
        palettes[s['id']] = p
    return pal, ext, bars, palettes, bad_any


def splice(text, begin, end, body, anchor):
    block = f'{begin}\n{body}{end}\n'
    if begin in text and end in text:
        return text[:text.index(begin)] + block + text[text.index(end) + len(end) + 1:]
    at = text.index(anchor)
    return text[:at] + block + text[at:]


if __name__ == '__main__':
    text = CSS.read_text(encoding='utf-8')
    pal, ext, bars, palettes, bad = generate(text)
    if bad:
        sys.exit('Палитра не проходит контраст (см. выше): поправьте зерновые цвета в new-skins.json')
    if '--ts' in sys.argv:
        print('// src/skinCore.ts → SkinId')
        print(''.join(f"  | '{s['id']}'\n" for s in SPEC), end='')
        print('// src/skinCore.ts → SKIN_BARS')
        for s in SPEC:
            print(f"  {s['id']}: {{ light: '{bars[s['id']][0]}', dark: '{bars[s['id']][1]}' }},")
        print('// src/skinCore.ts → TRAITS')
        for s in SPEC:
            print(f"  {s['id']}: '{s['traits']}',")
        print('// src/skins.ts → SKINS')
        for s in SPEC:
            print(f"  {{ id: '{s['id']}', label: '{s['label']}', hint: '{s['hint']}', group: '{s['group']}', bar: SKIN_BARS.{s['id']} }},")
        print('// src/skinIcons.ts → SKIN_ICON_STYLE')
        for s in SPEC:
            print(f"  {s['id']}: '{s['icon']}',")
        print('// src/skinIconPacks/registry.ts → SKIN_ICONIFY')
        for s in SPEC:
            if 'pack' in s:
                print(f"  {s['id']}: '{s['pack']}',")
        sys.exit(0)
    if '--palettes' in sys.argv:
        # для scripts/skin-art/gen_scenes.mjs: цвета карточки «Всего» и фона каждого образа
        out = {sid: {k: r2h(p[k]) for k in ('brand-l', 'hero-l', 'accent-l', 'bg-l', 'hero-from-d', 'hero-d')} for sid, p in palettes.items()}
        print(json.dumps(out))
        sys.exit(0)
    # палитры встают после последнего ручного блока палитры (перед первым блоком украшений), украшения — перед общим правилом заголовков
    fresh = splice(text, PAL_BEGIN, PAL_END, pal, "\nhtml[data-skin='barca'] {")
    fresh = splice(fresh, EXT_BEGIN, EXT_END, ext, '/* Заголовки экранов и карточек — шрифтом образа')
    if '--check' in sys.argv:
        if fresh != text:
            sys.exit('src/index.css расходится с new-skins.json: запустите python3 scripts/skin-art/gen_new_skins.py')
        print('Блоки нарисованных образов в index.css совпадают с new-skins.json.')
    else:
        CSS.write_text(fresh, encoding='utf-8')
        print(f'Нарисованных образов в src/index.css: {len(SPEC)}.')
