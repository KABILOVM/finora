# Общий футбольный набор: значки, разметка поля, флаги

Общее для образов «Барселона» и «Реал Мадрид» (и для будущих «Аргентина», «Месси», «Испания», «Роналду»). В сборку эти файлы **не попадают**, пока на них нет ссылок из `src/`.

## Своё (`svg/`)

Нарисовано для Finora: значки 24×24, штрих `currentColor` толщиной 2, как у Lucide.

| Файл | Что это |
| --- | --- |
| `ball`, `boot`, `whistle`, `trophy`, `stadium`, `goal`, `jersey`, `pitch` | мяч, бутса, свисток, кубок, чаша стадиона, ворота, футболка, поле сверху |
| `card`, `corner-flag`, `stopwatch`, `glove`, `medal`, `scarf`, `ticket`, `armband`, `tactics` | карточка, угловой флажок, секундомер, перчатка вратаря, медаль, шарф болельщика, билет, капитанская повязка, тактическая доска |
| `sprite.svg` | все значки как `<symbol id="football-…">` |
| `pitch-lines.svg` | разметка поля 400×260, белые линии: подложка под шапку |
| `pitch-corner-tr.svg` | центр поля в правом верхнем углу (круг, полукруг, центральная линия): украшение шапки |
| `preview.html` | посмотреть всё в браузере |

## Флаги (`flags/`)

| Файл | Что это | Лицензия |
| --- | --- | --- |
| `es.svg` | Испания 4×3, с гербом | MIT, [flag-icons](https://github.com/lipis/flag-icons) |
| `es-ct.svg` | Каталония (сенье́ра) 4×3 | MIT, flag-icons |
| `es-circle.svg`, `es-ct-circle.svg` | то же круглыми | MIT, [circle-flags](https://github.com/HatScripts/circle-flags) |

`es.svg` весит 80 КБ из-за герба; для мелких мест брать `es-circle.svg` (2 КБ).

## Чужие значки (`third-party/`)

46 значков с [Iconify](https://iconify.design), имя файла `набор-имя.svg`, штрих `currentColor`. Чтобы вернуть оригинал, открыть `https://api.iconify.design/<набор>/<имя>.svg`.

| Набор | Лицензия | Файлы |
| --- | --- | --- |
| Tabler (`tabler-`) | MIT | `ball-football`, `soccer-field`, `building-stadium`, `trophy`, `crown`, `shirt`, `flag`, `stopwatch`, `ticket`, `medal`, `award`, `shield`, `shield-half`, `shoe`, `play-football` |
| Lucide (`lucide-`) | ISC | `whistle`, `goal`, `trophy`, `crown`, `shirt`, `flag-triangle-right`, `timer`, `medal`, `ticket` |
| Iconoir (`iconoir-`) | MIT | `soccer-ball`, `scarf`, `trophy`, `crown` |
| Phosphor (`ph-`) | MIT | `soccer-ball`, `boot`, `trophy`, `crown`, `flag-banner`, `t-shirt` |
| Material Design Icons (`mdi-`) | Apache 2.0 | `shoe-cleat`, `stadium-variant`, `soccer-field`, `whistle`, `soccer` |
| MingCute (`mingcute-`) | Apache 2.0 | `scarf-line`, `whistle-line` |
| Game Icons (`game-icons-`) | **CC BY 3.0, нужно указать авторов** | `soccer-kick`, `goal-keeper`, `soccer-ball`, `trophy-cup`, `laurel-crown` |

Для Game Icons у каждого значка свой автор (список на [game-icons.net](https://game-icons.net)): если эти пять значков попадут в приложение, имена авторов надо будет вывести в «О приложении». Остальные наборы этого не требуют, достаточно сохранить текст лицензии.

## Логотипы клубов

Лежат рядом с образами: `../barca/logo/`, `../real-madrid/logo/`. Источник: [FCLOGO/fclogo.top](https://github.com/FCLOGO/fclogo.top) (текст MIT-лицензии репозитория: `LICENSE-FCLOGO-MIT.txt`; лицензия относится к коду сайта, а сами логотипы остаются товарными знаками клубов). В том же репозитории есть ещё около 1800 SVG (сборные, федерации, клубы других стран): для «Аргентины», «Испании» и «Роналду» можно взять оттуда.

## Права

Значки в `svg/` нарисованы заново и свободны. Чужие значки и флаги идут по лицензиям из таблиц выше, ограничений на личное использование нет.
