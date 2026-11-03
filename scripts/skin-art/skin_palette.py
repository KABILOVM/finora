"""
Собирает палитры образов (блок `:root[data-skin='…']` в src/index.css) из нескольких «зерновых» цветов и проверяет их теми же правилами контраста,
что src/accents.test.ts (светлая тема: поверхность белая; тёмная: --ac-surface-d). Цвет, который не проходит, сдвигается к чёрному или белому ровно
настолько, чтобы пройти. Печатает отчёт и пишет CSS; выход 1, если какое-то правило не выполнилось.

Запуск: python3 scripts/skin-art/skin_palette.py семена.json выход.css
Семена: {"id": {"label", "bgL", "s2L", "textL", "brandL", "accentL", "heroL", "lineC", "bgD", "surfD", "s2D", "textD", "brandD", "onD", "accentD", "heroFromD", "heroD"}}
"""
import sys, json

def h2r(h): h = h.lstrip('#'); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
def r2h(c): return '#%02x%02x%02x' % tuple(int(round(max(0, min(255, v)))) for v in c)
def lin(v):
    v /= 255
    return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4
def lum(c): return .2126 * lin(c[0]) + .7152 * lin(c[1]) + .0722 * lin(c[2])
def cr(a, b):
    la, lb = lum(a), lum(b)
    if la < lb: la, lb = lb, la
    return (la + .05) / (lb + .05)
def mix(a, b, t): return tuple(x * (1 - t) + y * t for x, y in zip(a, b))
def over(fg, a, bg): return tuple(f * a + b * (1 - a) for f, b in zip(fg, bg))
WHITE, BLACK = (255, 255, 255), (0, 0, 0)
def trip(c): return '%d %d %d' % tuple(int(round(max(0, min(255, v)))) for v in c)

def adj(fg, bgs, minr, toward):
    """Moves fg toward black ('dark') or white ('light') in small steps until it has minr contrast on every bg."""
    tgt = BLACK if toward == 'dark' else WHITE
    for i in range(0, 101):
        c = mix(fg, tgt, i / 100)
        if all(cr(c, b) >= minr for b in bgs): return c
    return tgt

LIGHT_T = dict(danger=(185, 28, 28), income=(4, 110, 80), expense=(190, 18, 60), warning=(146, 64, 14))
DARK_T = dict(on_danger=(8, 10, 24), danger=(248, 113, 113), income=(74, 222, 128), expense=(251, 113, 133), warning=(251, 191, 36))

def build(s):
    """s: dict of seeds -> palette dict of 'key' -> 'R G B'."""
    p = {}
    # ---------- light
    bg, s2 = h2r(s['bgL']), h2r(s['s2L'])
    bgs = [bg, WHITE, s2]
    for nm, c in (('danger', LIGHT_T['danger']), ('income', LIGHT_T['income']), ('expense', LIGHT_T['expense']), ('warning', LIGHT_T['warning'])):
        pass
    text = adj(h2r(s['textL']), bgs, 12, 'dark')
    muted = adj(mix(text, bg, .35), bgs, 5.6, 'dark')
    border = mix(bg, text, .13)
    bstrong = adj(mix(bg, text, .5), bgs, 3.3, 'dark')
    brand = adj(h2r(s['brandL']), bgs, 5.4, 'dark')
    bhover = adj(mix(brand, BLACK, .18), [WHITE], 5.4, 'dark')
    accent = adj(h2r(s['accentL']), [WHITE], 3.4, 'dark')
    hero = adj(h2r(s['heroL']), [WHITE], 5, 'dark')
    ob = lambda c, t: mix(c, WHITE, t)
    p.update({'bg-l': bg, 'surface-2-l': s2, 'text-l': text, 'muted-l': muted, 'border-l': border, 'border-strong-l': bstrong, 'brand-l': brand, 'brand-hover-l': bhover,
              'accent-l': accent, 'hero-l': hero, 'orb-1-l': ob(brand, .6), 'orb-2-l': ob(accent, .6), 'orb-3-l': ob(h2r(s['lineC']), .55), 'glass-shadow-l': mix(brand, BLACK, .4)})
    # ---------- dark
    dbg, dsf, ds2 = h2r(s['bgD']), h2r(s['surfD']), h2r(s['s2D'])
    dbgs = [dbg, dsf, ds2]
    dtext = adj(h2r(s['textD']), dbgs, 12, 'light')
    dmuted = adj(mix(dtext, dbg, .35), dbgs, 6, 'light')
    dborder = mix(dsf, dtext, .13)
    dbstrong = adj(mix(dsf, dtext, .45), dbgs, 3.3, 'light')
    dbrand = adj(h2r(s['brandD']), dbgs, 5.4, 'light')
    dbhover = mix(dbrand, WHITE, .2)
    donb = h2r(s['onD']) if 'onD' in s else dbg
    # on-brand must read on brand, hover (>=4.5) and accent (>=3): darken it if needed
    donb = adj(donb, [dbrand, dbhover], 4.6, 'dark')
    dacc = adj(h2r(s['accentD']), [], 0, 'light')
    for i in range(0, 101):  # accent-d: keep on-brand readable (>=3)
        c = mix(h2r(s['accentD']), WHITE, i / 100) if cr(donb, h2r(s['accentD'])) < 3 else h2r(s['accentD'])
        if cr(donb, c) >= 3: dacc = c; break
    hf = adj(h2r(s['heroFromD']), [WHITE], 5, 'dark')
    hd = adj(h2r(s['heroD']), [WHITE], 5, 'dark')
    p.update({'bg-d': dbg, 'surface-d': dsf, 'surface-2-d': ds2, 'text-d': dtext, 'muted-d': dmuted, 'border-d': dborder, 'border-strong-d': dbstrong, 'brand-d': dbrand,
              'brand-hover-d': dbhover, 'on-brand-d': donb, 'accent-d': dacc, 'hero-from-d': hf, 'hero-d': hd,
              'orb-1-d': mix(dbg, h2r(s['brandL']), .45), 'orb-2-d': mix(dbg, h2r(s['accentL']), .45), 'orb-3-d': mix(dbg, h2r(s['lineC']), .35)})
    # ---------- logo
    lf = adj(brand, [WHITE], 3.4, 'dark'); lt = adj(h2r(s['accentL']), [WHITE], 3.4, 'dark')
    lg = mix(WHITE, lf, .1)
    lg = adj(mix(lg, lt, .1), [lf, lt], 3.15, 'light') if cr(lg, lf) < 3.15 or cr(lg, lt) < 3.15 else lg
    p.update({'logo-from': lf, 'logo-to': lt, 'logo-glyph': lg})
    return p

def check(name, p):
    bad = []
    for mode, T in (('l', LIGHT_T), ('d', DARK_T)):
        g = lambda k: p[f'{k}-{mode}']
        surf = WHITE if mode == 'l' else g('surface')
        bg, s2 = g('bg'), g('surface-2')
        onb = WHITE if mode == 'l' else g('on-brand'); ond = WHITE if mode == 'l' else DARK_T['on_danger']
        brand, bh, acc = g('brand'), g('brand-hover'), g('accent')
        for sn, sc in (('bg', bg), ('surface', surf), ('surface-2', s2)):
            for fn, fc in (('text', g('text')), ('muted', g('muted')), ('brand', brand), ('danger', T['danger']), ('income', T['income']), ('expense', T['expense']), ('warning', T['warning'])):
                if cr(fc, sc) < 4.5: bad.append(f'{mode} {fn} on {sn} {cr(fc, sc):.2f}')
            if cr(g('border-strong'), sc) < 3: bad.append(f'{mode} border-strong on {sn} {cr(g("border-strong"), sc):.2f}')
        if cr(onb, brand) < 4.5: bad.append(f'{mode} on-brand/brand {cr(onb, brand):.2f}')
        if cr(onb, bh) < 4.5: bad.append(f'{mode} on-brand/brand-hover {cr(onb, bh):.2f}')
        if cr(onb, acc) < 3: bad.append(f'{mode} on-brand/accent {cr(onb, acc):.2f}')
        if cr(ond, T['danger']) < 4.5: bad.append('on-danger')
        if cr(surf, g('border-strong')) < 3: bad.append(f'{mode} surface/border-strong')
        for a in (.1, .15):
            if cr(brand, over(brand, a, surf)) < 4.5: bad.append(f'{mode} brand on chip {a} {cr(brand, over(brand, a, surf)):.2f}')
        hf = brand if mode == 'l' else g('hero-from'); h = g('hero')
        for n, c in (('hero-from', hf), ('hero', h)):
            if cr(WHITE, c) < 4.5: bad.append(f'{mode} white on {n} {cr(WHITE, c):.2f}')
    lf, lt, lg = p['logo-from'], p['logo-to'], p['logo-glyph']
    for n, t in (('from', lf), ('to', lt)):
        if cr(WHITE, t) < 3: bad.append(f'logo white/{n}')
        if cr(lg, t) < 3: bad.append(f'logo glyph/{n} {cr(lg, t):.2f}')
    return bad

ORDER_L = ['bg', 'surface-2', 'text', 'muted', 'border', 'border-strong', 'brand', 'brand-hover', 'accent', 'hero', 'orb-1', 'orb-2', 'orb-3', 'glass-shadow']
ORDER_D = ['bg', 'surface', 'surface-2', 'text', 'muted', 'border', 'border-strong', 'brand', 'brand-hover', 'on-brand', 'accent', 'hero-from', 'hero', 'orb-1', 'orb-2', 'orb-3']
def css(skin_id, p):
    out = f":root[data-skin='{skin_id}'] {{\n"
    for k in ORDER_L: out += f"  --ac-{k}-l: {trip(p[k + '-l'])};\n"
    for k in ORDER_D: out += f"  --ac-{k}-d: {trip(p[k + '-d'])};\n"
    for k in ('logo-from', 'logo-to', 'logo-glyph'): out += f"  --ac-{k}: {trip(p[k])};\n"
    return out + '}\n'

if __name__ == '__main__':
    seeds = json.load(open(sys.argv[1]))
    allbad = False; outcss = ''; bars = {}
    for sid, s in seeds.items():
        p = build(s); bad = check(sid, p)
        print(sid.ljust(10), 'OK' if not bad else bad)
        allbad |= bool(bad); outcss += f'/* {s["label"]} */\n' + css(sid, p)
        bars[sid] = {'light': r2h(p['bg-l']), 'dark': r2h(p['bg-d'])}
    open(sys.argv[2], 'w', encoding='utf-8').write(outcss)
    json.dump(bars, open(sys.argv[2] + '.bars.json', 'w'), ensure_ascii=False, indent=1)
    sys.exit(1 if allbad else 0)
