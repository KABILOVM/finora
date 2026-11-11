/**
 * Минимум об образах оформления, который нужен при запуске приложения: список образов и цвет строки состояния браузера у каждого.
 * Подписи, пояснения и образцы цветов для настроек лежат отдельно, в src/skins.ts: они нужны только на экране настроек и в основной файл не входят.
 */
export type SkinId =
  | 'classic'
  | 'legacy'
  | 'barca'
  | 'real'
  | 'argentina'
  | 'messi'
  | 'spain'
  | 'cr7'
  | 'football'
  | 'shinobi'
  | 'akatsuki'
  | 'spider'
  | 'comic'
  | 'tajik'
  | 'pamir'
  | 'kawaii'
  | 'aesthetic'
  | 'racing'
  | 'cyber'
  | 'pixel'
  | 'coquette'
  | 'gothic'
  | 'clay'
  | 'liquid'
  | 'chrome'
  | 'retro'
  | 'bauhaus'
  | 'sticker'
  | 'notebook'
  | 'dungeon'
  | 'graffiti'
  | 'cafe'
  | 'nowruz'
  | 'christmas'
  | 'halloween'
  | 'valentine'
  | 'bento'
  | 'ocean'
  | 'forest'
  | 'sakura'
  | 'aurora'
  | 'desert'
  | 'cosmos'
  | 'ramadan'
  | 'kurban'
  | 'independence'
  | 'march8'
  | 'birthday'
  | 'mancity'
  | 'liverpool'
  | 'manutd'
  | 'arsenal'
  | 'chelsea'
  | 'psg'
  | 'bayern'
  | 'juventus'
  | 'milan'
  | 'inter'
  | 'tjk'
  | 'istiklol'
  | 'brazil'
  | 'portugal'
  | 'france'
  | 'boxing'
  | 'basketball'
  | 'gym'
  | 'blackcard'
  | 'gold'
  | 'marble'
  | 'trading'
  | 'seasonal'
  | 'custom';

export const DEFAULT_SKIN: SkinId = 'classic';

/**
 * Цвет строки состояния браузера (meta theme-color) в светлой и тёмной теме: это фон страницы образа, --ac-bg-l и --ac-bg-d его блока
 * в src/index.css (сверяет src/accents.test.ts). У «Классики» цвета здесь нет: он берётся из выбранного акцента.
 */
export const SKIN_BARS: Readonly<Record<Exclude<SkinId, 'classic' | 'legacy' | 'seasonal' | 'custom'>, { light: string; dark: string }>> = {
  barca: { light: '#eef2fb', dark: '#08122e' },
  real: { light: '#f7f5ef', dark: '#071028' },
  argentina: { light: '#eef6fc', dark: '#06141f' },
  messi: { light: '#f4f1e8', dark: '#0a141c' },
  spain: { light: '#fbf1e6', dark: '#1a0a0b' },
  cr7: { light: '#f6f3ec', dark: '#0a0a0a' },
  football: { light: '#e5f3ea', dark: '#07140c' },
  shinobi: { light: '#f6ecd8', dark: '#0e1326' },
  akatsuki: { light: '#f4efef', dark: '#0a0a0c' },
  spider: { light: '#eef1fb', dark: '#0a0d1c' },
  comic: { light: '#eef2ff', dark: '#0b0e24' },
  tajik: { light: '#f1e6cd', dark: '#1d1a22' },
  pamir: { light: '#e7f0f6', dark: '#06131d' },
  kawaii: { light: '#fff0f8', dark: '#1f1030' },
  aesthetic: { light: '#f7ebe6', dark: '#1a1015' },
  racing: { light: '#f1f2f5', dark: '#101114' },
  cyber: { light: '#f3eefc', dark: '#07060f' },
  pixel: { light: '#eef4d2', dark: '#0a240a' },
  coquette: { light: '#fdf0f3', dark: '#1d1218' },
  gothic: { light: '#f1ecee', dark: '#0e0b10' },
  clay: { light: '#f3e9ff', dark: '#1c1530' },
  liquid: { light: '#e8eeff', dark: '#0c1224' },
  chrome: { light: '#e9ecf4', dark: '#0d1020' },
  retro: { light: '#f7ead0', dark: '#231710' },
  bauhaus: { light: '#f2efe6', dark: '#121214' },
  sticker: { light: '#fff6d6', dark: '#221a2e' },
  notebook: { light: '#f6f7f2', dark: '#11151f' },
  dungeon: { light: '#f3e9d2', dark: '#1a1410' },
  graffiti: { light: '#ececf0', dark: '#1b1b1f' },
  cafe: { light: '#eff1f5', dark: '#1e1e2e' },
  nowruz: { light: '#f3faee', dark: '#0f1f16' },
  christmas: { light: '#f4f8fb', dark: '#0b1d33' },
  halloween: { light: '#f6efe6', dark: '#140a1f' },
  valentine: { light: '#fff1f4', dark: '#1f0d14' },
  bento: { light: '#eef1f6', dark: '#0f1520' },
  // нарисованные образы (scripts/skin-art/new-skins.json): значения печатает `python3 scripts/skin-art/gen_new_skins.py --ts`
  ocean: { light: '#eaf5fb', dark: '#04121f' },
  forest: { light: '#eef5ea', dark: '#0a160e' },
  sakura: { light: '#fdf1f4', dark: '#1c0f16' },
  aurora: { light: '#ecf7f5', dark: '#050d1c' },
  desert: { light: '#faf0e0', dark: '#1c120a' },
  cosmos: { light: '#f0eefc', dark: '#070512' },
  ramadan: { light: '#eef2fa', dark: '#070d1d' },
  kurban: { light: '#eef7f2', dark: '#06140f' },
  independence: { light: '#fbf2ef', dark: '#160a0a' },
  march8: { light: '#fdf0f6', dark: '#1a0e18' },
  birthday: { light: '#f6f0fd', dark: '#130b22' },
  mancity: { light: '#edf5fb', dark: '#06111c' },
  liverpool: { light: '#fbeeee', dark: '#170708' },
  manutd: { light: '#fbefec', dark: '#140807' },
  arsenal: { light: '#fcf0ee', dark: '#150909' },
  chelsea: { light: '#edf1fa', dark: '#050c1d' },
  psg: { light: '#eef2f7', dark: '#040b18' },
  bayern: { light: '#fbeef0', dark: '#18070b' },
  juventus: { light: '#f3f3f1', dark: '#0b0b0c' },
  milan: { light: '#faeeee', dark: '#130607' },
  inter: { light: '#edf1fb', dark: '#05091a' },
  tjk: { light: '#eef6ef', dark: '#07130b' },
  istiklol: { light: '#f9efef', dark: '#150a0a' },
  brazil: { light: '#f4f8e6', dark: '#08130a' },
  portugal: { light: '#f9eeee', dark: '#14080a' },
  france: { light: '#eef1fa', dark: '#070b1c' },
  boxing: { light: '#f6eeec', dark: '#0f0808' },
  basketball: { light: '#fbf1e5', dark: '#140c06' },
  gym: { light: '#f1f3ee', dark: '#0c0d0c' },
  blackcard: { light: '#f1f1f3', dark: '#070708' },
  gold: { light: '#faf5e8', dark: '#14100a' },
  marble: { light: '#f4f3ef', dark: '#0d1110' },
  trading: { light: '#eef4f0', dark: '#050a08' },
};

/** «Сезонные»: образ-переключатель. Сам не рисуется: на странице стоит праздничный образ, ближайший к сегодняшней дате (seasonFor). */
export const SEASONAL_SKIN: SkinId = 'seasonal';

/**
 * «Классика (прежняя)»: вид приложения до обновления дизайна (пятна фона, полупрозрачные карточки, прежние углы и карточка «Всего»).
 * Своей палитры у неё нет, как и у «Классики»: цвет выбирается акцентом. На странице это атрибут data-look="legacy", а не data-skin.
 */
export const LEGACY_SKIN: SkinId = 'legacy';

/** Образы без своей палитры: цвет задаёт выбранный акцент («Классика» и «Классика (прежняя)»). */
export const isBaseSkin = (id: SkinId): boolean => id === DEFAULT_SKIN || id === LEGACY_SKIN;

/**
 * «Свой образ»: собран человеком в конструкторе. В списке готовых образов его нет: палитра, черты, шрифт и фото лежат на устройстве
 * (src/customSkin.ts), а здесь только значение выбора.
 */
export const CUSTOM_SKIN: SkinId = 'custom';

export const isSkinId = (v: string | null): v is SkinId =>
  v === DEFAULT_SKIN || v === LEGACY_SKIN || v === SEASONAL_SKIN || v === CUSTOM_SKIN || (v !== null && Object.prototype.hasOwnProperty.call(SKIN_BARS, v));

export type SeasonId = 'valentine' | 'march8' | 'nowruz' | 'independence' | 'halloween' | 'christmas' | 'kurban' | 'ramadan';

/** Праздники с постоянной датой: образ, месяц (1–12) и день. «Новый год» отсчитывается от 25 декабря, День независимости — 9 сентября. */
const FIXED_HOLIDAYS: readonly (readonly [SeasonId, number, number])[] = [
  ['valentine', 2, 14],
  ['march8', 3, 8],
  ['nowruz', 3, 21],
  ['independence', 9, 9],
  ['halloween', 10, 31],
  ['christmas', 12, 25],
];

/**
 * Праздники по лунному календарю: первый день (год, месяц, день). Даты расчётные и могут на день отличаться от объявленных; для
 * оформления этого достаточно. Рамазан длится месяц, поэтому для него «праздник» — все 30 дней. Вне таблицы (до 2025 и после 2035)
 * эти два праздника «Сезонные» просто не показывают.
 */
const KURBAN_DAYS: readonly (readonly [number, number, number])[] = [
  [2025, 6, 6], [2026, 5, 27], [2027, 5, 16], [2028, 5, 5], [2029, 4, 24], [2030, 4, 13], [2031, 4, 2], [2032, 3, 22], [2033, 3, 11], [2034, 3, 1], [2035, 2, 18],
];
const RAMADAN_STARTS: readonly (readonly [number, number, number])[] = [
  [2025, 3, 1], [2026, 2, 18], [2027, 2, 8], [2028, 1, 28], [2029, 1, 16], [2030, 1, 6], [2030, 12, 26], [2031, 12, 15], [2032, 12, 4], [2033, 11, 23], [2034, 11, 12], [2035, 11, 1],
];
const RAMADAN_DAYS = 30;

/** Номер дня от начала отсчёта, без влияния часового пояса и перехода на летнее время. */
const dayNumber = (y: number, m: number, d: number): number => Date.UTC(y, m - 1, d) / 864e5;

/**
 * Праздничный образ для даты: тот праздник, до которого (или после которого) ближе всего дней. Внутри Рамазана расстояние до него — ноль,
 * но однодневный праздник в этот день главнее (8 марта в Рамазан остаётся 8 марта): при равном расстоянии выигрывает тот, кто выше в списке.
 */
export function seasonFor(now: Date): SeasonId {
  const year = now.getFullYear();
  const today = dayNumber(year, now.getMonth() + 1, now.getDate());
  let best: SeasonId = 'christmas';
  let gap = Infinity;
  const consider = (id: SeasonId, from: number, to: number = from) => {
    const d = today < from ? from - today : today > to ? today - to : 0;
    if (d < gap) [best, gap] = [id, d];
  };
  // постоянные даты — в прошлом, этом и следующем году: в январе ближайший праздник — прошлогодний Новый год
  for (const [id, m, d] of FIXED_HOLIDAYS) for (const y of [year - 1, year, year + 1]) consider(id, dayNumber(y, m, d));
  for (const [y, m, d] of KURBAN_DAYS) consider('kurban', dayNumber(y, m, d));
  for (const [y, m, d] of RAMADAN_STARTS) consider('ramadan', dayNumber(y, m, d), dayNumber(y, m, d) + RAMADAN_DAYS - 1);
  return best;
}

/** Образ, который нужно поставить на страницу: сам выбранный, а у «Сезонных» — праздничный по дате. */
export const resolveSkin = (id: SkinId, now: Date = new Date()): SkinId => (id === SEASONAL_SKIN ? seasonFor(now) : id);

/** Цвета строки состояния для образа; null — «Классика», «Сезонные» (у них цвета берутся у праздничного образа на странице) или неизвестное значение. */
export const skinBar = (id: string | null): { light: string; dark: string } | null =>
  isSkinId(id) && id !== DEFAULT_SKIN && id !== LEGACY_SKIN && id !== SEASONAL_SKIN && id !== CUSTOM_SKIN ? SKIN_BARS[id] : null;

/** Образы, у которых есть свой набор значков (src/skinIcons.ts, грузится лениво): все, кроме «Классики» и «Сезонных» (у тех значки праздничного образа). */
export const SKIN_ICON_PACKS = Object.keys(SKIN_BARS) as readonly SkinId[];

/* ───────────────────────── Черты образа ─────────────────────────
 * Образ — это не только палитра. У каждого шесть «черт», и каждая меняет своё: форму углов, материал карточек, вид нижнего меню,
 * вид карточки «Всего», характер движения и живой фон. На странице это атрибуты <html> (data-shape, data-material, data-nav, data-hero,
 * data-motion, data-scene), а что каждое значение значит — описано один раз в src/styles/look.css. Поэтому два образа с одной палитрой,
 * но разными чертами выглядят как два разных приложения, а новый образ собирается из готовых черт без своего CSS.
 */

/** Форма углов: soft — обычные мягкие, round — крупные «таблетки», sharp — почти прямые, square — прямые (пиксели), cut — срезанный угол. */
export type SkinShape = 'soft' | 'round' | 'sharp' | 'square' | 'cut';
/** Материал карточек: сплошная, стекло, контур, плакат (жёсткая тень), неон, глина, бумага, металл, бархат с золотой нитью. */
export type SkinMaterial = 'solid' | 'glass' | 'outline' | 'pop' | 'neon' | 'clay' | 'paper' | 'metal' | 'lux';
/** Нижнее меню телефона: dock — парящая панель, bar — полоса от края до края, island — узкий «остров», tabs — плоские вкладки с чертой. */
export type SkinNav = 'dock' | 'bar' | 'island' | 'tabs';
/** Карточка «Всего»: card — тёмная «банковская», gradient — прежний градиент, board — табло, ticket — билет, terminal — терминал, banner — рисунок во всю карточку. */
export type SkinHero = 'card' | 'gradient' | 'board' | 'ticket' | 'terminal' | 'banner';
/** Движение: smooth — плавно, bouncy — пружинит, snappy — резко и быстро, steps — ступеньками, calm — медленно. */
export type SkinMotion = 'smooth' | 'bouncy' | 'snappy' | 'steps' | 'calm';
/** Живой фон (src/scene): что летает и светится позади содержимого. none — ничего. */
export type SkinScene =
  | 'none'
  | 'aurora'
  | 'snow'
  | 'rain'
  | 'petals'
  | 'leaves'
  | 'stars'
  | 'bubbles'
  | 'confetti'
  | 'embers'
  | 'grid'
  | 'hearts'
  | 'dust'
  | 'fireflies'
  | 'lights'
  | 'speed'
  | 'ticker'
  | 'sand'
  | 'pixels';

export interface SkinTraits {
  shape: SkinShape;
  material: SkinMaterial;
  nav: SkinNav;
  hero: SkinHero;
  motion: SkinMotion;
  scene: SkinScene;
}

export const SHAPES: readonly SkinShape[] = ['soft', 'round', 'sharp', 'square', 'cut'];
export const MATERIALS: readonly SkinMaterial[] = ['solid', 'glass', 'outline', 'pop', 'neon', 'clay', 'paper', 'metal', 'lux'];
export const NAVS: readonly SkinNav[] = ['dock', 'bar', 'island', 'tabs'];
export const HEROES: readonly SkinHero[] = ['card', 'gradient', 'board', 'ticket', 'terminal', 'banner'];
export const MOTIONS: readonly SkinMotion[] = ['smooth', 'bouncy', 'snappy', 'steps', 'calm'];
export const SCENES: readonly SkinScene[] = [
  'none',
  'aurora',
  'snow',
  'rain',
  'petals',
  'leaves',
  'stars',
  'bubbles',
  'confetti',
  'embers',
  'grid',
  'hearts',
  'dust',
  'fireflies',
  'lights',
  'speed',
  'ticker',
  'sand',
  'pixels',
];

/** Черты «Классики»: от них отсчитываются остальные образы. */
export const DEFAULT_TRAITS: SkinTraits = { shape: 'soft', material: 'solid', nav: 'dock', hero: 'card', motion: 'smooth', scene: 'aurora' };

/**
 * Черты образов одной строкой «форма материал меню карточка движение фон» (так таблица почти ничего не весит в основном файле).
 * Порядок слов — как в SkinTraits. «Сезонных» здесь нет: на странице стоит праздничный образ.
 */
const TRAITS: Readonly<Record<Exclude<SkinId, 'seasonal' | 'custom'>, string>> = {
  classic: 'soft solid dock card smooth aurora',
  legacy: 'soft glass dock gradient smooth none',
  barca: 'soft solid bar board smooth lights',
  real: 'soft lux dock board calm dust',
  argentina: 'round solid bar board smooth confetti',
  messi: 'soft glass island board smooth dust',
  spain: 'soft pop bar board snappy confetti',
  cr7: 'sharp lux tabs board snappy dust',
  football: 'soft solid bar board smooth lights',
  shinobi: 'soft paper dock banner smooth leaves',
  akatsuki: 'sharp neon tabs banner calm rain',
  spider: 'soft pop island banner snappy dust',
  comic: 'sharp pop tabs banner bouncy confetti',
  tajik: 'soft paper dock banner calm dust',
  pamir: 'soft glass island banner calm snow',
  kawaii: 'round clay island card bouncy hearts',
  aesthetic: 'soft glass dock card calm petals',
  racing: 'cut neon tabs board snappy speed',
  cyber: 'cut neon tabs terminal snappy grid',
  pixel: 'square outline tabs terminal steps pixels',
  coquette: 'round paper island card bouncy petals',
  gothic: 'sharp lux tabs banner calm fireflies',
  clay: 'round clay island card bouncy bubbles',
  liquid: 'round glass island card smooth bubbles',
  chrome: 'round metal dock card snappy stars',
  retro: 'soft pop bar ticket smooth dust',
  bauhaus: 'sharp outline tabs card snappy confetti',
  sticker: 'soft paper dock ticket bouncy confetti',
  notebook: 'sharp paper tabs ticket smooth none',
  dungeon: 'sharp lux bar banner calm embers',
  graffiti: 'sharp pop bar banner bouncy confetti',
  cafe: 'soft paper dock card calm fireflies',
  nowruz: 'round solid dock banner smooth petals',
  christmas: 'soft glass dock banner smooth snow',
  halloween: 'sharp neon tabs banner calm embers',
  valentine: 'round glass island card bouncy hearts',
  bento: 'round solid island card smooth aurora',
  ocean: 'round glass island banner smooth bubbles',
  forest: 'soft paper dock banner calm fireflies',
  sakura: 'round glass dock banner smooth petals',
  aurora: 'soft glass island banner calm stars',
  desert: 'soft paper bar banner calm sand',
  cosmos: 'round neon island banner calm stars',
  ramadan: 'soft lux dock banner calm stars',
  kurban: 'soft paper dock banner calm dust',
  independence: 'soft solid bar banner smooth confetti',
  march8: 'round paper island banner bouncy petals',
  birthday: 'round clay island banner bouncy confetti',
  mancity: 'round solid bar board smooth lights',
  liverpool: 'soft solid bar board smooth lights',
  manutd: 'sharp pop bar board snappy lights',
  arsenal: 'soft solid dock board smooth lights',
  chelsea: 'soft lux bar board calm lights',
  psg: 'round glass island board smooth dust',
  bayern: 'soft solid bar board snappy confetti',
  juventus: 'sharp outline tabs board snappy lights',
  milan: 'sharp pop tabs board snappy lights',
  inter: 'cut neon tabs board snappy lights',
  tjk: 'soft solid bar board smooth confetti',
  istiklol: 'soft solid dock board smooth lights',
  brazil: 'round solid bar board bouncy confetti',
  portugal: 'soft lux bar board calm dust',
  france: 'soft glass dock board smooth lights',
  boxing: 'sharp pop tabs board snappy embers',
  basketball: 'round solid bar board bouncy lights',
  gym: 'cut metal tabs board snappy speed',
  blackcard: 'soft metal dock card calm dust',
  gold: 'soft lux dock card calm dust',
  marble: 'sharp paper dock card calm none',
  trading: 'sharp neon tabs terminal snappy ticker',
};

/** Разбирает строку черт; незнакомое или пропущенное слово заменяется чертой «Классики» (чужая строка из хранилища ничего не ломает). */
export function parseTraits(line: string | null | undefined): SkinTraits {
  const [shape, material, nav, hero, motion, scene] = (line ?? '').split(' ');
  const pick = <T extends string>(all: readonly T[], v: string | undefined, d: T): T => (all as readonly string[]).includes(v ?? '') ? (v as T) : d;
  return {
    shape: pick(SHAPES, shape, DEFAULT_TRAITS.shape),
    material: pick(MATERIALS, material, DEFAULT_TRAITS.material),
    nav: pick(NAVS, nav, DEFAULT_TRAITS.nav),
    hero: pick(HEROES, hero, DEFAULT_TRAITS.hero),
    motion: pick(MOTIONS, motion, DEFAULT_TRAITS.motion),
    scene: pick(SCENES, scene, DEFAULT_TRAITS.scene),
  };
}

export const traitsLine = (t: SkinTraits): string => `${t.shape} ${t.material} ${t.nav} ${t.hero} ${t.motion} ${t.scene}`;

/** Черты образа, который стоит на странице (у «Сезонных» — праздничного). У своего образа черты хранятся вместе с ним: здесь — черты «Классики». */
export const skinTraits = (id: SkinId, now: Date = new Date()): SkinTraits => {
  const shown = resolveSkin(id, now);
  return parseTraits(shown === SEASONAL_SKIN || shown === CUSTOM_SKIN ? null : TRAITS[shown]);
};
