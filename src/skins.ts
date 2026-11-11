/**
 * Образы оформления: «Классика» (новый вид с выбираемым акцентом), «Классика (прежняя)» (вид до обновления дизайна, тоже с акцентом) и готовые образы
 * с палитрой, шрифтом заголовков, узором, украшением и своими чертами (форма углов, материал карточек, меню, карточка «Всего», движение, живой фон: src/skinCore.ts).
 *
 * Образ — это атрибут data-skin на <html>. Его блок в src/index.css (`:root[data-skin='…']`) задаёт те же переменные --ac-*, что и
 * акцент, поэтому светлая и тёмная тема, контрасты и тест src/accents.test.ts работают для образа так же, как для акцента.
 * Шрифты, узоры и рисунки образа лежат в src/assets/skins; шрифты скачиваются только у тех, кто образ выбрал (см. @font-face в index.css).
 * У образов по мотивам фильмов, аниме и клубов на карточке «Всего» стоят настоящие картинки из материалов (src/assets/skins/art, их собирает
 * scripts/skin-art/build.py): гербы, арты, фото. Это файлы без явной лицензии, из публичной сборки они отдаются всем, кто откроет адрес картинки.
 *
 * Здесь только данные, без обращения к странице: так их можно читать из тестов и из настроек.
 */
import { DEFAULT_SKIN, SKIN_BARS, type SkinId } from './skinCore';

export type { SkinId };

export type SkinGroupId = 'classic' | 'football' | 'story' | 'national' | 'style' | 'holiday';

/** Разделы списка образов в настройках, в порядке показа. */
export const SKIN_GROUPS: readonly { id: SkinGroupId; label: string }[] = [
  { id: 'classic', label: 'Классика' },
  { id: 'football', label: 'Футбол' },
  { id: 'story', label: 'Кино и аниме' },
  { id: 'national', label: 'Национальные' },
  { id: 'style', label: 'Стили' },
  { id: 'holiday', label: 'Праздники' },
];

export interface SkinOption {
  id: SkinId;
  /** Название в настройках. */
  label: string;
  /** Одна строка под названием. */
  hint: string;
  group: SkinGroupId;
  /**
   * Цвет строки состояния браузера (meta theme-color) в светлой и тёмной теме: это фон страницы образа, --ac-bg-l и --ac-bg-d его
   * блока в index.css (сверяет src/accents.test.ts). У «Классики» цвет берётся из выбранного акцента, поэтому здесь его нет.
   */
  bar: { light: string; dark: string } | null;
  /** Образ без своей палитры: цвет задаёт выбранный акцент («Классика» и «Классика (прежняя)»). Блока в index.css у него нет. */
  base?: true;
  /** Образ-переключатель («Сезонные»): сам не рисуется, на странице стоит другой образ по дате. Своих цветов, шрифта и картинки у него нет, только значок в настройках. */
  resolves?: true;
}

export const SKINS: readonly SkinOption[] = [
  { id: 'classic', label: 'Классика', hint: 'Спокойный новый вид, цвет выбираете сами', group: 'classic', bar: null, base: true },
  { id: 'legacy', label: 'Классика (прежняя)', hint: 'Вид до обновления: пятна фона и стекло', group: 'classic', bar: null, base: true },
  { id: 'barca', label: 'Барселона', hint: 'Сине-гранатовые полосы и золото', group: 'football', bar: SKIN_BARS.barca },
  { id: 'real', label: 'Реал Мадрид', hint: 'Белое, королевский синий и золото', group: 'football', bar: SKIN_BARS.real },
  { id: 'argentina', label: 'Аргентина', hint: 'Небесные полосы и золотое солнце', group: 'football', bar: SKIN_BARS.argentina },
  { id: 'messi', label: 'Месси', hint: 'Десятка, небесный и золото', group: 'football', bar: SKIN_BARS.messi },
  { id: 'spain', label: 'Испания', hint: 'Красное и жёлтое', group: 'football', bar: SKIN_BARS.spain },
  { id: 'cr7', label: 'Роналду', hint: 'Семёрка, чёрное, золото и гранат', group: 'football', bar: SKIN_BARS.cr7 },
  { id: 'football', label: 'Футбол', hint: 'Газон в полоску, янтарь и мяч', group: 'football', bar: SKIN_BARS.football },
  { id: 'shinobi', label: 'Шиноби', hint: 'Пергамент, оранжевый и тёмно-синий', group: 'story', bar: SKIN_BARS.shinobi },
  { id: 'akatsuki', label: 'Акацуки', hint: 'Чёрная ночь и красный дождь', group: 'story', bar: SKIN_BARS.akatsuki },
  { id: 'spider', label: 'Паутина', hint: 'Красное, синее и паутина', group: 'story', bar: SKIN_BARS.spider },
  { id: 'comic', label: 'Герой', hint: 'Комикс: красное, синее и точки', group: 'story', bar: SKIN_BARS.comic },
  { id: 'tajik', label: 'Таджикистан', hint: 'Глина, атлас, гулдузи и индиго', group: 'national', bar: SKIN_BARS.tajik },
  { id: 'pamir', label: 'Памир', hint: 'Лёд, снег и гранат', group: 'national', bar: SKIN_BARS.pamir },
  { id: 'kawaii', label: 'Кавай', hint: 'Розовый, сиреневый и точки', group: 'style', bar: SKIN_BARS.kawaii },
  { id: 'aesthetic', label: 'Эстетика', hint: 'Роза, золото и тишина', group: 'style', bar: SKIN_BARS.aesthetic },
  { id: 'racing', label: 'Гонки', hint: 'Карбон и красная полоса', group: 'style', bar: SKIN_BARS.racing },
  { id: 'cyber', label: 'Киберпанк', hint: 'Неон, сетка и ночь', group: 'style', bar: SKIN_BARS.cyber },
  { id: 'pixel', label: 'Пиксель', hint: 'Оттенки зелёного, как на старой приставке', group: 'style', bar: SKIN_BARS.pixel },
  { id: 'coquette', label: 'Кокетка', hint: 'Бантики, жемчуг и нежно-розовый', group: 'style', bar: SKIN_BARS.coquette },
  { id: 'gothic', label: 'Готика', hint: 'Бордо, серебро и витраж', group: 'style', bar: SKIN_BARS.gothic },
  { id: 'clay', label: 'Глина', hint: 'Мягкие объёмные фигурки и пастель', group: 'style', bar: SKIN_BARS.clay },
  { id: 'liquid', label: 'Жидкое стекло', hint: 'Прозрачные шары и синие блики', group: 'style', bar: SKIN_BARS.liquid },
  { id: 'chrome', label: 'Y2K-хром', hint: 'Серебро, блеск и пузыри нулевых', group: 'style', bar: SKIN_BARS.chrome },
  { id: 'retro', label: 'Ретро 70–80-х', hint: 'Закат, пластинка и тёплые полосы', group: 'style', bar: SKIN_BARS.retro },
  { id: 'bauhaus', label: 'Баухаус', hint: 'Красный, синий, жёлтый и геометрия', group: 'style', bar: SKIN_BARS.bauhaus },
  { id: 'sticker', label: 'Скрапбук', hint: 'Бумага, наклейки и скотч', group: 'style', bar: SKIN_BARS.sticker },
  { id: 'notebook', label: 'Школьная тетрадь', hint: 'Клетка, синяя ручка и красные поля', group: 'style', bar: SKIN_BARS.notebook },
  { id: 'dungeon', label: 'Подземелье', hint: 'Тёмное дерево, золото и сундук', group: 'style', bar: SKIN_BARS.dungeon },
  { id: 'graffiti', label: 'Граффити', hint: 'Кирпич, баллончик и яркие кляксы', group: 'style', bar: SKIN_BARS.graffiti },
  { id: 'cafe', label: 'Кофейня', hint: 'Мокко, сирень и тихий вечер', group: 'style', bar: SKIN_BARS.cafe },
  { id: 'nowruz', label: 'Навруз', hint: 'Тюльпаны, солнце и росток', group: 'style', bar: SKIN_BARS.nowruz },
  { id: 'bento', label: 'Бенто', hint: 'Плитки разного размера, коралл и мята', group: 'style', bar: SKIN_BARS.bento },
  { id: 'seasonal', label: 'Сезонные', hint: 'Сам выбирает праздник по дате', group: 'holiday', bar: null, resolves: true },
  { id: 'christmas', label: 'Новый год', hint: 'Ёлка, снежинки и подарки', group: 'holiday', bar: SKIN_BARS.christmas },
  { id: 'halloween', label: 'Хэллоуин', hint: 'Тыква, луна и летучие мыши', group: 'holiday', bar: SKIN_BARS.halloween },
  { id: 'valentine', label: '14 февраля', hint: 'Сердце со стрелой и письмо', group: 'holiday', bar: SKIN_BARS.valentine },
];

export { DEFAULT_SKIN };

export const skinById = (id: string | null): SkinOption | undefined => SKINS.find((s) => s.id === id);
