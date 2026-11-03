#!/usr/bin/env python3
"""
Собирает наборы значков образов: для каждого образа свой набор готовых значков из Iconify (with icons Anime, Brutal, Kawaii, Luxe, Pixelarticons,
Streamline Cyber, Phosphor и другие). Скрипт по каждому значку приложения (дом, кошелёк, автобус, коктейли…) подбирает значок набора, скачивает
его SVG и пишет src/skinIconPacks/<набор>.ts и meta.ts. Эти файлы создаются скриптом, вручную не правятся.

Запуск из корня репозитория: python3 scripts/skin-art/icon_packs.py [набор ...]   (нужен доступ к api.iconify.design)
Новый набор: добавить строку в PACKS, запустить скрипт, добавить загрузчик в src/skinIconPacks/registry.ts и образ — в SKIN_PACK (src/skinCore.ts).
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'src' / 'skinIconPacks'

# Значок приложения -> подходящие имена в наборах (по убыванию точности; имена как в Lucide, у with icons они такие же).
# Служебные значки (плюс, галочка, корзина, глаз, настройки, облако…) не заменяются: они должны оставаться узнаваемыми.
APP: dict[str, list[str]] = {
    # основные
    'home': ['house', 'home'], 'list': ['receipt', 'list'], 'wallet': ['wallet'], 'calendar': ['calendar'], 'mail': ['mail'], 'sun': ['sun'], 'moon': ['moon'],
    'pie': ['chart-pie', 'pie-chart'], 'banknote': ['banknote'], 'target': ['target'], 'chart': ['chart-bar', 'bar-chart'], 'fire': ['flame'], 'shield': ['shield'],
    'cart': ['shopping-cart', 'cart'], 'food': ['utensils', 'fork-knife'], 'cup': ['coffee'], 'donut': ['donut'], 'wine': ['wine'], 'bus': ['bus'], 'car': ['car'],
    'fuel': ['fuel', 'gas-pump'], 'scooter': ['bike', 'scooter'], 'sofa': ['sofa'], 'bulb': ['lightbulb', 'light-bulb'], 'washing': ['washing-machine'],
    'key': ['key'], 'bolt': ['zap', 'lightning'], 'water': ['droplet', 'drop'], 'wifi': ['wifi'], 'phone': ['smartphone', 'phone'], 'laptop': ['laptop'],
    'heart': ['heart'], 'pills': ['pill'], 'hospital': ['hospital'], 'bag': ['shopping-bag', 'bag'], 'shirt': ['shirt', 't-shirt'], 'scissors': ['scissors'],
    'paw': ['paw-print', 'paw'], 'game': ['gamepad-2', 'gamepad', 'game-controller'], 'music': ['music'], 'tv': ['tv'], 'video': ['clapperboard', 'film', 'video'],
    'ball': ['goal', 'soccer-ball', 'volleyball'], 'gym': ['dumbbell'], 'book': ['book'], 'diploma': ['graduation-cap'], 'gift': ['gift'], 'party': ['party-popper'],
    'star': ['star'], 'invest': ['trending-up'], 'money': ['coins'], 'salary': ['hand-coins', 'banknote'], 'cash': ['banknote', 'money'], 'card': ['credit-card'],
    'safe': ['vault', 'landmark'], 'briefcase': ['briefcase'], 'tool': ['wrench'], 'box': ['package', 'box'], 'tag': ['tag'], 'repeat': ['repeat'], 'debt': ['handshake'],
    'stars': ['sparkles'], 'plane': ['plane', 'airplane'], 'sale': ['badge-percent', 'percent'], 'user': ['user'], 'question': ['circle-help', 'help-circle'],
    # дополнительные
    'family': ['users', 'users-round'], 'wife': ['user-round', 'user'], 'husband': ['user-round', 'user'], 'kids': ['baby', 'smile'], 'baby': ['baby'], 'toys': ['blocks', 'puzzle'],
    'school': ['school', 'graduation-cap'], 'friends': ['users-round', 'users'], 'couple': ['heart-handshake', 'heart'], 'wedding': ['church', 'gem'], 'charity': ['hand-heart', 'heart-handshake'],
    'heating': ['radiator', 'thermometer'], 'conditioner': ['air-vent', 'wind'], 'cleaning': ['spray-can', 'broom', 'brush-cleaning'], 'fridge': ['refrigerator', 'cooking-pot'],
    'socket': ['plug', 'plug-zap'], 'bath': ['bath'], 'bed': ['bed'], 'window': ['app-window', 'door-open'], 'garage': ['warehouse', 'car-front'], 'paint': ['paint-roller', 'paintbrush'],
    'build': ['hammer', 'construction'], 'toolbox': ['toolbox', 'hammer'], 'apartment': ['building-2', 'building'], 'smarthome': ['house-wifi', 'house'],
    'takeaway': ['cup-soda', 'coffee'], 'lunch': ['utensils-crossed', 'soup', 'utensils'], 'tea': ['coffee', 'cup-soda'], 'bakery': ['croissant', 'bread', 'baguette'],
    'cocktail': ['martini', 'wine', 'cocktail'], 'cooking': ['cooking-pot', 'chef-hat'], 'bike': ['bike', 'bicycle'], 'tram': ['tram-front', 'train-front', 'train'],
    'kickscooter': ['scooter', 'bike'], 'carservice': ['car-front', 'wrench'], 'tires': ['circle-dot', 'disc'], 'evcharge': ['plug-zap', 'battery-charging'],
    'road': ['route', 'milestone'], 'trip': ['luggage', 'briefcase'], 'passport': ['book-user', 'id-card', 'contact'], 'place': ['map-pin'], 'delivery': ['truck', 'package'],
    'doctor': ['stethoscope'], 'vaccine': ['syringe'], 'medkit': ['briefcase-medical', 'first-aid-kit'], 'vitamins': ['pill', 'apple'], 'yoga': ['flower', 'person-standing'],
    'run': ['footprints', 'person-standing'], 'swim': ['waves'], 'mask': ['drama', 'venetian-mask', 'face-mask'], 'perfume': ['spray-can', 'flask-conical'],
    'cosmetic': ['palette', 'brush'], 'vanity': ['sparkles', 'flower-2'], 'dress': ['shirt', 'sparkles'], 'hanger': ['shirt'], 'glasses': ['glasses'], 'watch': ['watch'],
    'shop': ['store'], 'price': ['tag', 'tags'], 'coupon': ['ticket-percent', 'ticket'], 'camera': ['camera'], 'headphones': ['headphones'], 'art': ['palette', 'brush'],
    'basketball': ['basketball'], 'tennis': ['circle-dot', 'tennis-ball'], 'volleyball': ['volleyball'], 'bowling': ['circle-dot', 'bowling-ball'], 'skate': ['skateboard', 'snowflake'],
    'hiking': ['mountain', 'footprints'], 'golf': ['flag', 'golf'], 'telescope': ['telescope'], 'nature': ['trees', 'tree-pine'], 'picnic': ['sandwich', 'apple'],
    'tickets': ['ticket'], 'cinema': ['clapperboard', 'film'], 'park': ['tree-pine', 'trees'], 'trophy': ['trophy'], 'medal': ['medal', 'award'], 'moneybag': ['piggy-bank', 'coins'],
    'cardtransfer': ['arrow-left-right', 'credit-card'], 'euro': ['euro'], 'dollar': ['dollar-sign'], 'ruble': ['russian-ruble', 'ruble'], 'university': ['landmark', 'school'],
    'notebook': ['notebook', 'book-open'], 'library': ['library', 'book-open'], 'taxes': ['receipt', 'file-text'], 'bills': ['file-text', 'receipt'], 'document': ['file', 'file-text'],
    'print': ['printer'], 'post': ['mail', 'mailbox'], 'law': ['scale', 'gavel'], 'business': ['briefcase-business', 'briefcase'], 'slides': ['presentation', 'monitor'],
    'religion': ['moon-star', 'moon'], 'bell': ['bell'], 'world': ['globe', 'earth'], 'time': ['clock'], 'alarm': ['alarm-clock'], 'deal': ['handshake'], 'magic': ['wand-sparkles', 'wand', 'sparkles'],
}

# Особые имена для наборов, в которых значки названы иначе, чем у Lucide (пробуются раньше общих кандидатов).
OVERRIDES: dict[str, dict[str, list[str]]] = {
    'pixelarticons': {
        'pie': ['analytics'], 'chart': ['chart-bar-big'], 'fire': ['fire'], 'donut': ['cake'], 'pills': ['potion'], 'paw': ['dog'], 'diploma': ['teach', 'university'],
        'tool': ['tools'], 'tag': ['label'], 'debt': ['invoice'], 'question': ['circle-question'], 'baby': ['human'], 'kids': ['human'], 'school': ['university', 'backpack'],
        'charity': ['heart'], 'paint': ['brush'], 'build': ['tools'], 'toolbox': ['tool-case'], 'smarthome': ['smart-home'], 'lunch': ['mug'], 'bakery': ['cake'],
        'takeaway': ['mug'], 'cleaning': ['spray-can'], 'cocktail': ['bottle-wine'], 'tea': ['tea'], 'family': ['users'], 'trip': ['suitcase'], 'passport': ['membercard', 'contact'],
        'cinema': ['clapperboard'], 'ruble': ['rubel'], 'law': ['scale'], 'post': ['mailbox'], 'document': ['file'], 'world': ['earth', 'globe'], 'time': ['clock'], 'alarm': ['alarm-clock'],
        'magic': ['wand'], 'game': ['gamepad'], 'headphones': ['headphone'], 'art': ['brush'], 'cosmetic': ['colors-swatch'], 'vanity': ['sparkle'], 'dress': ['shirt'],
        'glasses': ['sunglasses'], 'delivery': ['truck'], 'carservice': ['tools'], 'evcharge': ['plug'], 'road': ['road-sign'], 'window': ['window-frame'], 'garage': ['warehouse'],
        'apartment': ['building'], 'socket': ['plug'], 'conditioner': ['wind'], 'heating': ['thermometer'], 'hiking': ['tent'], 'nature': ['leaf', 'tree'], 'park': ['tree'],
        'swim': ['waves'], 'medal': ['crown'], 'trophy': ['trophy'], 'bag': ['handbag', 'shopping-bag'], 'sale': ['percent'], 'stars': ['sparkles'],
        'moneybag': ['coins'], 'invest': ['trending-up'], 'salary': ['money', 'banknote'], 'cash': ['banknote'], 'university': ['university'],
    },
    'sl-cyber': {
        'home': ['home-scene'], 'list': ['receipt-envelope', 'document-bookmark-2'], 'mail': ['email-2'], 'moon': ['night-mode'], 'pie': ['business-chart-4'], 'banknote': ['bank-note-1'],
        'target': ['business-target'], 'chart': ['business-chart-4'], 'fire': ['campfire'], 'shield': ['shield-3'], 'cart': ['shopping-cart-3'], 'food': ['fork-knife'],
        'cup': ['hot-beverage', 'coffee-cup-hot-2'], 'donut': ['icecream-cone'], 'wine': ['wine-bottle-glass'], 'bus': ['bus-2'], 'car': ['car-4'], 'fuel': ['gas-station'],
        'scooter': ['bicycle-1'], 'bulb': ['business-idea-light-bulb'], 'key': ['key-2'], 'wifi': ['laptop-wifi-2'], 'phone': ['phone-3'], 'laptop': ['laptop-2'],
        'heart': ['badge-favorite-heart-2'], 'pills': ['medicine-capsule-2'], 'hospital': ['ambulance', 'medical-cross'], 'bag': ['shopping-bag'], 'shirt': ['dress'],
        'scissors': ['scissor-2'], 'paw': ['dog-1'], 'game': ['controller-wireless'], 'music': ['music-note-1'], 'tv': ['video-player-1'], 'video': ['movie-film-1'],
        'ball': ['football'], 'gym': ['weight-training'], 'gift': ['present-box'], 'party': ['confetti-popper'], 'star': ['badge-star-2'], 'invest': ['business-chart-4'],
        'money': ['coin-stack'], 'salary': ['cash-hand-1'], 'cash': ['bank-notes'], 'safe': ['safe-1'], 'briefcase': ['business-suitcase-2'], 'box': ['package-wooden'],
        'tag': ['tag-2'], 'repeat': ['synchronize-loop'], 'debt': ['business-handshake-deal'], 'sale': ['store-sale'], 'user': ['person'], 'plane': ['airplane'],
        'family': ['account-group'], 'kids': ['baby-face'], 'baby': ['baby-face'], 'school': ['book-pencil'], 'friends': ['group'], 'couple': ['in-love'], 'wedding': ['wedding-certificate'],
        'charity': ['cash-bag-give'], 'cleaning': ['spray-paint-3'], 'bed': ['night-mode'], 'paint': ['paint-bucket-1'], 'build': ['hammer'], 'toolbox': ['wrench-screwdriver'],
        'apartment': ['building-13'], 'smarthome': ['home-scene'], 'takeaway': ['hot-beverage'], 'lunch': ['spaghetti-fork'], 'tea': ['coffee-cup-hot-2'], 'bakery': ['croissant'],
        'cocktail': ['glass-1'], 'cooking': ['rolling-pin'], 'bike': ['bicycle-1'], 'tram': ['train-2'], 'carservice': ['wrench'], 'trip': ['travel-bag-2'], 'passport': ['id-card'],
        'place': ['location-pin-1'], 'delivery': ['delivery-truck-5'], 'doctor': ['doctor'], 'vaccine': ['syringe-2'], 'medkit': ['medical-box'], 'vitamins': ['medicine-capsule-2'],
        'swim': ['swimming-pool-2'], 'mask': ['masks'], 'glasses': ['glasses-4'], 'watch': ['watch-1'], 'shop': ['store-location'], 'price': ['tag-double'], 'camera': ['camera-4'],
        'headphones': ['headphone'], 'art': ['paint-palette'], 'basketball': ['basketball'], 'nature': ['park'], 'tickets': ['ferris-wheel-1'], 'cinema': ['clapboard-play-open'],
        'trophy': ['trophy-4'], 'moneybag': ['money-bag-1'], 'cardtransfer': ['credit-card-payment-machine'], 'notebook': ['book-pencil'], 'library': ['book-encyclopedia'],
        'taxes': ['receipt-envelope'], 'bills': ['receipt-envelope'], 'document': ['document-bookmark-2'], 'print': ['printer-3'], 'post': ['mailbox-2'], 'law': ['scale-horizontal'],
        'business': ['business-laptop'], 'slides': ['presentation-2'], 'bell': ['alarm'], 'world': ['globe-1'], 'time': ['clock-1'], 'alarm': ['alarm'], 'deal': ['business-handshake-deal'],
        'magic': ['business-magic-rabbit'], 'lock': ['lock-close-1'], 'sofa': ['lamp-3'], 'hanger': ['dress'], 'dress': ['dress'],
    },
    'game-icons': {
        'home': ['castle'], 'list': ['scroll-unfurled'], 'wallet': ['wallet'], 'mail': ['envelope'], 'chart': ['chart'], 'cart': ['wheelbarrow'], 'food': ['roast-chicken'],
        'cup': ['beer-stein'], 'car': ['caravan'], 'pills': ['health-potion'], 'hospital': ['apothecary'], 'gift': ['open-treasure-chest'], 'invest': ['growth'], 'banknote': ['money-stack'],
        'salary': ['receive-money'], 'cash': ['money-stack'], 'card': ['two-coins'], 'tool': ['anvil'], 'star': ['flat-star'], 'safe': ['locked-chest'], 'box': ['chest'], 'repeat': ['cycle'], 'debt': ['take-my-money'],
        'sale': ['price-tag'], 'user': ['person'], 'family': ['family-tree'], 'wife': ['person'], 'husband': ['person'], 'friends': ['three-friends'], 'charity': ['pay-money'],
        'apartment': ['stone-tower'], 'lunch': ['bread'], 'place': ['compass'], 'cardtransfer': ['pay-money'], 'taxes': ['scroll-quill'], 'bills': ['tied-scroll'], 'print': ['quill-ink'],
        'gym': ['weight-lifting-up'], 'wedding': ['diamond-ring'], 'diploma': ['diploma'], 'moneybag': ['piggy-bank'], 'university': ['graduate-cap'], 'bell': ['bell'], 'target': ['bullseye'],
        'game': ['dice-twenty-faces-twenty'], 'stars': ['sparkles'], 'bowling': ['bowling-pin'], 'deal': ['crossed-swords'], 'document': ['tied-scroll'], 'euro': ['coins'], 'dollar': ['coins'],
        'ruble': ['coins'], 'bag': ['swap-bag', 'shopping-bag'], 'bus': ['bus'], 'bulb': ['lantern'], 'kids': ['baby-face'], 'dress': ['robe'], 'shirt': ['shirt'], 'perfume': ['potion-ball'], 'vanity': ['sparkles'],
    },
    'pp-pencil': {
        'wallet': ['money-note'], 'mail': ['letter'], 'banknote': ['money-note'], 'target': ['pinpoint'], 'food': ['knive-fork'], 'wine': ['coctail'], 'bus': ['taxi'],
        'scooter': ['motorcycle'], 'bolt': ['electricity'], 'laptop': ['monitor'], 'game': ['controller'], 'tv': ['television'], 'party': ['hands-clapping'], 'invest': ['arrow-up-right'],
        'salary': ['money-note'], 'safe': ['lock-closed'], 'tag': ['label'], 'stars': ['stars'], 'user': ['person'], 'family': ['people'], 'wife': ['person'], 'husband': ['person'],
        'friends': ['persons'], 'kids': ['face-smiling'], 'baby': ['face-smiling'], 'wedding': ['heart'], 'takeaway': ['soft-drink'], 'cocktail': ['coctail'], 'evcharge': ['electricity'],
        'place': ['pin'], 'doctor': ['person'], 'shop': ['building'], 'price': ['label'], 'medal': ['trophy'], 'dollar': ['dollar'], 'university': ['bank'], 'notebook': ['book'],
        'library': ['book'], 'taxes': ['clipboard'], 'bills': ['file'], 'post': ['letter'], 'law': ['sword-shield'], 'alarm': ['alarm'], 'magic': ['stars'], 'debt': ['handshake'],
        'sale': ['label'], 'lunch': ['knive-fork'], 'tea': ['cup'], 'cooking': ['knive-fork'], 'charity': ['hand-open'], 'cart': ['cart'], 'moneybag': ['coins'], 'ruble': ['peso'],
        'sun': ['sun'], 'fire': ['fire'], 'heating': ['fire'], 'conditioner': ['cloud'], 'window': ['square'], 'garage': ['building'], 'bell': ['bell'], 'chart': ['bulletin-notice'], 'cup': ['cup'],
    },
    'ph-fill': {
        'mail': ['envelope'], 'banknote': ['money'], 'sofa': ['couch'], 'tv': ['television'], 'gym': ['barbell'], 'party': ['confetti'], 'invest': ['trend-up'], 'question': ['question'],
        'bath': ['bathtub'], 'lunch': ['bowl-food'], 'road': ['road-horizon'], 'perfume': ['flask'], 'glasses': ['eyeglasses'], 'telescope': ['binoculars'], 'euro': ['currency-eur'],
        'dollar': ['currency-dollar'], 'ruble': ['currency-rub'], 'university': ['bank'], 'alarm': ['alarm'], 'donut': ['cookie', 'chart-donut'], 'yoga': ['person-simple-tai-chi'],
        'run': ['person-simple-run'], 'pie': ['chart-pie'], 'chart': ['chart-bar'], 'trip': ['suitcase-rolling'], 'bag': ['shopping-bag'], 'fire': ['fire'], 'shield': ['shield'],
    },
}

# набор -> (префикс Iconify, суффикс имён, краткая подпись, лицензия, нужна ссылка на авторов)
PACKS = {
    'wi-anime': ('withicons-anime', '', 'with icons Anime (Evergrow)', 'MIT'),
    'wi-brutal': ('withicons-brutal', '', 'with icons Brutal (Evergrow)', 'MIT'),
    'wi-kawaii': ('withicons-kawaii', '', 'with icons Kawaii (Evergrow)', 'MIT'),
    'wi-luxe': ('withicons-luxe', '', 'with icons Luxe (Evergrow)', 'MIT'),
    'wi-coquette': ('withicons-coquette', '', 'with icons Coquette (Evergrow)', 'MIT'),
    'wi-gothic': ('withicons-gothic', '', 'with icons Gothic (Evergrow)', 'MIT'),
    'wi-clay': ('withicons-clay', '', 'with icons Clay (Evergrow)', 'MIT'),
    'wi-liquid': ('withicons-liquid', '', 'with icons Liquid (Evergrow)', 'MIT'),
    'wi-chrome': ('withicons-chrome', '', 'with icons Chrome (Evergrow)', 'MIT'),
    'wi-retro': ('withicons-retro', '', 'with icons Retro (Evergrow)', 'MIT'),
    'wi-bauhaus': ('withicons-bauhaus', '', 'with icons Bauhaus (Evergrow)', 'MIT'),
    'wi-sticker': ('withicons-sticker', '', 'with icons Sticker (Evergrow)', 'MIT'),
    'pp-pencil': ('pepicons-pencil', '', 'Pepicons Pencil (CyCraft)', 'CC BY 4.0'),
    'game-icons': ('game-icons', '', 'Game-icons.net (Lorc, Delapouite и другие авторы)', 'CC BY 3.0'),
    'pixelarticons': ('pixelarticons', '', 'Pixelarticons (Gerrit Halfmann)', 'MIT'),
    'sl-cyber': ('streamline-cyber', '', 'Streamline Cyber (Streamline)', 'CC BY 4.0'),
    'ph-fill': ('ph', '-fill', 'Phosphor Fill (Phosphor Icons)', 'MIT'),
}

# Наборы с тяжёлыми значками (десятки КБ на значок) сжимаются svgo до одного знака после запятой: на размере значка в приложении разницы не видно, а файл втрое легче.
OPTIMIZE = {'wi-anime': 1, 'wi-brutal': 1, 'wi-luxe': 1, 'wi-kawaii': 1, 'wi-coquette': 1, 'wi-gothic': 1, 'wi-clay': 1, 'wi-liquid': 1, 'wi-chrome': 1, 'wi-retro': 1, 'wi-bauhaus': 1, 'wi-sticker': 1}


def curl(url: str) -> str:
    return subprocess.run(['curl', '-sS', '-m', '60', url], capture_output=True, text=True).stdout


def all_names(prefix: str) -> set[str]:
    d = json.loads(curl(f'https://api.iconify.design/collection?prefix={prefix}'))
    names = set(d.get('uncategorized') or [])
    for lst in (d.get('categories') or {}).values():
        names |= set(lst)
    return names


def tokens(name: str, suffix: str) -> list[str]:
    base = name[: -len(suffix)] if suffix and name.endswith(suffix) else name
    return [t for t in re.split(r'[-_]', base) if t and not t.isdigit()]


def resolve(prefix: str, suffix: str, names: set[str], over: dict[str, list[str]] | None = None) -> dict[str, str]:
    """Значок приложения -> имя в наборе: точное совпадение, иначе все слова кандидата (с учётом множественного числа)."""
    out: dict[str, str] = {}
    by_tokens = {n: tokens(n, suffix) for n in names if (not suffix or n.endswith(suffix))}
    for app, cands in APP.items():
        pick = None
        for c in (over or {}).get(app, []) + cands:
            if c + suffix in names:
                pick = c + suffix
                break
        if pick is None:
            for c in cands:
                words = c.split('-')
                ok = [n for n, toks in by_tokens.items() if all(any(k == w or k == w + 's' or k + 's' == w for k in toks) for w in words)]
                if ok:
                    pick = min(ok, key=lambda n: len(by_tokens[n]))
                    break
        if pick:
            out[app] = pick
    return out


def clean_body(body: str, uid: str) -> str:
    body = re.sub(r'\sclass="[^"]*"', '', body)  # служебные классы набора (width и height не трогаем: они нужны у rect)
    for i in set(re.findall(r'\bid="([^"]+)"', body)):  # id внутри рисунка делаем уникальными: значки стоят на одной странице
        nid = f'{uid}-{i}'
        body = body.replace(f'id="{i}"', f'id="{nid}"').replace(f'url(#{i})', f'url(#{nid})').replace(f'href="#{i}"', f'href="#{nid}"')
    body = re.sub(r'(fill|stroke)="(?:#000000|#000|black)"', r'\1="currentColor"', body)
    return re.sub(r'>\s+<', '><', body).strip()


def optimize(icons: dict[str, str], precision: int) -> dict[str, str]:
    """Сжимает значки через svgo (ставится во временную папку; нужны node и доступ к npm)."""
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(['npm', 'i', '--prefix', tmp, '--silent', '--no-audit', '--no-fund', 'svgo@3'], check=True, capture_output=True)
        src, dst = Path(tmp, 'in.json'), Path(tmp, 'out.json')
        src.write_text(json.dumps(icons), encoding='utf-8')
        env = {**__import__('os').environ, 'NODE_PATH': str(Path(tmp, 'node_modules'))}
        subprocess.run(['node', str(ROOT / 'scripts' / 'skin-art' / 'optimize-svg.cjs'), str(src), str(dst), str(precision)], check=True, env=env)
        return json.loads(dst.read_text(encoding='utf-8'))


def build(pack_id: str) -> dict:
    prefix, suffix, title, lic = PACKS[pack_id]
    names = all_names(prefix)
    mapping = resolve(prefix, suffix, names, OVERRIDES.get(pack_id))
    got = list(dict.fromkeys(mapping.values()))
    d = json.loads(curl(f'https://api.iconify.design/{prefix}.json?icons=' + ','.join(got)))
    W, H = d.get('width', 24), d.get('height', 24)
    icons: dict[str, str] = {}
    for app, n in mapping.items():
        ic = d.get('icons', {}).get(n)
        if not ic:
            continue
        w, h = ic.get('width', W), ic.get('height', H)
        icons[app] = f'<svg viewBox="0 0 {w} {h}">{clean_body(ic["body"], f"{pack_id}-{app}")}</svg>'
    if pack_id in OPTIMIZE:
        icons = optimize(icons, OPTIMIZE[pack_id])
    return {'id': pack_id, 'prefix': prefix, 'title': title, 'license': lic, 'icons': icons, 'missing': [a for a in APP if a not in icons]}


def app_names() -> tuple[set[str], dict[str, str]]:
    """Основные значки (src/components/iconData.ts, раздел DUO) и дополнительные с их разделами (iconExtraData.ts: имя -> раздел)."""
    t = (ROOT / 'src' / 'components' / 'iconData.ts').read_text(encoding='utf-8')
    duo = t[t.index('export const DUO'):t.index('export const LINE')]
    base = set(re.findall(r'^  "([a-z0-9]+)":', duo, re.M))
    extra = dict(re.findall(r'"name":"([a-z0-9]+)","label":"[^"]*","section":"([a-z]+)"', (ROOT / 'src' / 'components' / 'iconExtraData.ts').read_text(encoding='utf-8')))
    return base, extra


def write_icons(path: Path, head: str, icons: dict[str, str]) -> int:
    body = ',\n'.join(f'  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}' for k, v in icons.items())
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"// Создан scripts/skin-art/icon_packs.py. Вручную не править.\n// {head}\nexport const ICONS: Readonly<Record<string, string>> = {{\n{body},\n}};\n", encoding='utf-8')
    return path.stat().st_size


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    wanted = sys.argv[1:] or list(PACKS)
    base_names, extra_sections = app_names()
    unknown = [a for a in APP if a not in base_names and a not in extra_sections]
    if unknown:
        sys.exit(f'В APP есть имена, которых нет в приложении: {unknown}')
    meta = []
    for pid in wanted:
        r = build(pid)
        head = f"Набор: {r['title']}, лицензия {r['license']} (Iconify: {r['prefix']})."
        groups: dict[str, dict[str, str]] = {}
        for name, svg in r['icons'].items():
            groups.setdefault('base' if name in base_names else extra_sections[name], {})[name] = svg
        folder = OUT / pid
        for old_file in folder.glob('*.ts'):  # убираем файлы разделов, которых в новом наборе нет
            if old_file.stem not in groups:
                old_file.unlink()
        sizes = {g: write_icons(folder / f'{g}.ts', f'{head} Группа: {g}.', icons) for g, icons in groups.items()}
        print(f"{pid:15s} значков {len(r['icons']):3d}  всего {sum(sizes.values()) / 1024:6.1f} КБ  основные {sizes.get('base', 0) / 1024:6.1f} КБ  самый большой раздел {max(v for g, v in sizes.items() if g != 'base') / 1024:5.1f} КБ")
        print(f"{'':15s} не нашлось: {' '.join(r['missing'][:60])}")
        meta.append({'id': pid, 'prefix': r['prefix'], 'title': r['title'], 'license': r['license'], 'count': len(r['icons']), 'groups': sorted(groups)})
    old = {}
    mp = OUT / 'meta.json'
    if mp.exists():
        old = {m['id']: m for m in json.loads(mp.read_text()) if m['id'] in PACKS}
    old.update({m['id']: m for m in meta})
    mp.write_text(json.dumps(list(old.values()), ensure_ascii=False, indent=1), encoding='utf-8')


if __name__ == '__main__':
    main()
