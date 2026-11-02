# Образ «Таджикистан»: материалы

Заготовки для будущего национального образа: атлас (икат), гулдузи, тюбетейка, памирская чорхона, флаг и герб. Макет образа есть на странице «Образы Finora». В сборку эти файлы **не попадают**, пока на них нет ссылок из `src/`.

## Своё (`svg/`)

Нарисовано для Finora. Цвета сняты с настоящих тканей из коллекции ниже: бордо (марена), ночной индиго, охра, слоновая кость, зелень. Названия мотивов взяты из описаний таджикской вышивки (солнце, косагул, цветок граната, ивовый лист, миндаль, мак, райхон, павлиний хвост, луна и звёзды).

| Файл | Что это |
| --- | --- |
| `atlas-band.svg` | Полоса атласа икат 80×44, повторяется по горизонтали. Размытые «рваные» края получаются из SVG-фильтра, как у настоящей икат-ткани |
| `atlas-tile.svg` | Плитка атласа 120×120: индиго, белые и охристые ромбы, зигзаги |
| `gulduzi-rosette.svg`, `gulduzi-rosette-line.svg` | Розетка гулдузи с лепестками, пунктирным «стежком» и сердцевиной: цветная и однолинейная (красится `color`) |
| `gulduzi-vine.svg` | Вьющийся узор с ивовыми листьями и цветами, 160×36, бесшовный по горизонтали |
| `gulduzi-tile-dim.svg` | Плитка из стёжки гулдузи 160×160, почти прозрачная: фон образа |
| `bodom.svg` | Миндаль (бодом) с пунктиром |
| `doppi-tile.svg` | Плитка тюбетейки: четыре калампира (перца) вокруг центра, белое на чёрном |
| `chorkhona.svg` | Чорхона: потолок памирского дома из вложенных повёрнутых квадратов с солнцем |
| `tumor`, `anor`, `gul`, `bodom`, `oftob`, `doppi`, `atlas`, `choynak`, `non`, `dutor`, `pamir`, `crown7`, `kulol` (`.svg`) | 13 значков 24×24, штрих `currentColor` толщиной 2, как у Lucide: тумор (оберег), анор, цветок, миндаль, солнце, тюбетейка, ткань, чойник, лепёшка, дутор, Памир, корона и семь звёзд, кувшин |
| `sprite.svg` | Все значки как `<symbol id="tj-…">` |
| `preview.html` | Посмотреть всё в браузере |

### Флаги (`svg/flags/`)
`flag-tj-4x3.svg` ([flag-icons](https://github.com/lipis/flag-icons), MIT) и `circle-flag-tj.svg` ([circle-flags](https://github.com/HatScripts/circle-flags), MIT). Скачаны через Iconify.

### Чужие значки (`svg/third-party/`)
18 значков из набора iconoven (MIT), скачаны через Iconify: хлопок, колос, самовар, верблюд, овца, коза, ослик, лошадь, виноград, лепёшка, чайник, минарет, купол мечети, тюльпан, гора, пяльцы, игла с ниткой, шарф.

## Герб (`emblem/`)
`emblem-1024.png`: государственный герб Республики Таджикистан, 1024×1022, с прозрачным фоном. Взят с сайта государственного агентства [meteo.tj](https://meteo.tj/en/national-emblem) (оригинал 2000×1997). Это растровая картинка: корона с семью звёздами, восходящее солнце над горами, раскрытая книга, венок из хлопка и пшеницы с лентами цветов флага. Векторной версии я не нашёл, а в разных зеркалах Википедии статус файла указан противоречиво, поэтому своего вектора герба нет. Для значков есть упрощённая `svg/crown7.svg`.

## Ткани из музея (`textiles/`)

Открытая коллекция [Cleveland Museum of Art](https://www.clevelandart.org/open-access), лицензия **CC0**: ссылку на музей указывать не обязательно, но её стоит оставить. Фотографии сжаты до 1200 px (WebP).

| Файл | Название | Происхождение | Музей |
| --- | --- | --- | --- |
| `1916-1235-wedding-veil.webp` | Wedding Veil | Tajikistan, Tajik tribe, 19th century, 1800s | [1916.1235](https://clevelandart.org/art/1916.1235) |
| `1916-1311-curtain-or-bedcover.webp` | Curtain or bedcover | Tajikistan, Ura Tube, early 1800s | [1916.1311](https://clevelandart.org/art/1916.1311) |
| `1916-1277-embroidered-cover.webp` | Embroidered Cover | Uzbekistan, Bukhara, 19th century | [1916.1277](https://clevelandart.org/art/1916.1277) |
| `1916-1412-man-s-surcoat-khalat.webp` | Man's surcoat (khalat) | Uzbekistan, Shahr-i Sabz, late 1800s | [1916.1412](https://clevelandart.org/art/1916.1412) |
| `1916-1468-woman-s-cloak-chyrpy.webp` | Woman's cloak (chyrpy) | Uzbekistan, Bukhara, 1800s | [1916.1468](https://clevelandart.org/art/1916.1468) |
| `1918-19-panel-probably-from-a-curtain.webp` | Panel, Probably from a Curtain | Uzbekistan, Bukhara, 19th century | [1918.19](https://clevelandart.org/art/1918.19) |
| `1918-20-part-of-a-curtain-two-widths.webp` | Part of a Curtain (Two Widths) | Uzbekistan, Bukhara, 19th century | [1918.20](https://clevelandart.org/art/1918.20) |
| `1918-22-suzani-curtain-or-bed-cover.webp` | Suzani: Curtain or Bed Cover | Uzbekistan, Bukhara, c. 1800 | [1918.22](https://clevelandart.org/art/1918.22) |
| `1940-598-suzani-divan-cover.webp` | Suzani: Divan Cover | Uzbekistan, Bukhara, 1700s | [1940.598](https://clevelandart.org/art/1940.598) |
| `1940-602-wall-hanging.webp` | Wall Hanging | Uzbekistan, Bukhara or Shahr-i Sabz, 19th century, 1850–1899 | [1940.602](https://clevelandart.org/art/1940.602) |
| `1987-145-celestial-musician.webp` | Celestial Musician | Central Asia, 1300s | [1987.145](https://clevelandart.org/art/1987.145) |
| `2006-150-wall-hanging-pardah.webp` | Wall Hanging (pardah) | Uzbekistan, Bukhara, 1800–1850 | [2006.150](https://clevelandart.org/art/2006.150) |
| `2006-151-wall-hanging-pardah.webp` | Wall hanging (pardah) | Uzbekistan, Bukhara, 1800–1850 | [2006.151](https://clevelandart.org/art/2006.151) |
| `2006-152-wall-hanging-pardah.webp` | Wall hanging (pardah) | Uzbekistan, Bukhara, 1850–75 | [2006.152](https://clevelandart.org/art/2006.152) |
| `2006-153-length-of-silk-velvet-ikat.webp` | Length of silk velvet ikat | Uzbekistan, Bukhara, 1875–1900 | [2006.153](https://clevelandart.org/art/2006.153) |
| `2009-267-woman-s-robe-munisak.webp` | Woman’s Robe (munisak) | Uzbekistan, Bukhara, 1850–75 | [2009.267](https://clevelandart.org/art/2009.267) |
| `2016-50-woman-s-robe-with-crimson-flora.webp` | Woman's robe with crimson flora | Uzbekistan, Karakapak Republic, Khorezm, late 1800s | [2016.50](https://clevelandart.org/art/2016.50) |
| `2016-89-suzani-with-floral-sprays.webp` | Suzani with floral sprays | Central Asia, South West Uzbekistan, Shakhrisyabz, 1800–1850 | [2016.89](https://clevelandart.org/art/2016.89) |

Таджикские: свадебная фата таджикского племени (XIX век) и покрывало из Ура-Тюбе. Остальное — Бухара, Шахрисабз и Хорезм, откуда ткани и узоры общие для Средней Азии.

## Фотографии (`images/`)

9 снимков с [wallpapers.com](https://wallpapers.com) (полноразмерная версия, уменьшена до 1400 px, WebP). На сайте написано: бесплатно, «для личного использования». Памир: озеро Булункуль, перевал Акбайтал, горы и пустыня; Бухара: мавзолей Исмаила Самани, минарет Калян, ткань икат; Самарканд: Регистан и Шахи-Зинда.

## Палитра образа

| Цвет | Код |
| --- | --- |
| Глина (фон) | `#efe3c9` |
| Слоновая кость (карточки) | `#fbf4e2` |
| Бордо | `#a82337` |
| Индиго | `#1f2f66` |
| Охра | `#d9a22b` |
| Зелень | `#2f7d4e` |
| Тёмный бордо (обводки) | `#5b1f32` |
| Цвета флага | красный `#CC0000`, зелёный `#006600` (из памяти, сверить с флагом) |

Контраст на `#fbf4e2`: основной текст `#2b1a16` около 15:1, приглушённый `#6b5246` около 6,5:1, бордо `#a82337` около 6,5:1, зелёный доход `#1f7a4a` около 4,9:1. Белый на индиго `#1f2f66` около 13:1.

Шрифты: Podkova (заголовки, «народная» засечка), Fira Sans Extra Condensed (суммы), Nunito (текст). У всех есть все таджикские буквы. Тоже с полным набором: Advent Pro, Play, Arsenal, Cormorant, PT Serif, Fira Sans, Spectral, Vollkorn, Marmelad, Forum, Lora, Viaoda Libre.

## Права

- Свои узоры и значки (`svg/`, кроме `flags/` и `third-party/`) нарисованы заново по общему орнаментальному наследию, они не копии чужих рисунков.
- Ткани из музея под CC0, флаги и значки iconoven под MIT.
- Герб это государственный символ, взят с сайта государственного агентства. Фотографии с wallpapers.com для личного использования.

## Как пользоваться

- Полоса: `background: url('./svg/atlas-band.svg') repeat-x; background-size: auto 31px;`.
- Фон: `background: #efe3c9 url('./svg/gulduzi-tile-dim.svg'); background-size: 160px;`.
- Значки красятся обычным `color`. Для вставки на страницу удобен `sprite.svg`: после встраивания `<svg width="24" height="24"><use href="#tj-tumor" /></svg>`.
- Фильтр икат в `atlas-*.svg` работает, когда файл используется как картинка или фон. Если вставлять SVG прямо в страницу, id фильтра `ik` может повториться: давать ему уникальное имя.
- CSP приложения (`img-src 'self' data: blob:`) пропускает эти файлы, если они лежат в сборке. Внешние адреса запрещены.
