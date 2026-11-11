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
  | 'seasonal';

export const DEFAULT_SKIN: SkinId = 'classic';

/**
 * Цвет строки состояния браузера (meta theme-color) в светлой и тёмной теме: это фон страницы образа, --ac-bg-l и --ac-bg-d его блока
 * в src/index.css (сверяет src/accents.test.ts). У «Классики» цвета здесь нет: он берётся из выбранного акцента.
 */
export const SKIN_BARS: Readonly<Record<Exclude<SkinId, 'classic' | 'legacy' | 'seasonal'>, { light: string; dark: string }>> = {
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

export const isSkinId = (v: string | null): v is SkinId =>
  v === DEFAULT_SKIN || v === LEGACY_SKIN || v === SEASONAL_SKIN || (v !== null && Object.prototype.hasOwnProperty.call(SKIN_BARS, v));

export type SeasonId = 'valentine' | 'halloween' | 'christmas';

/** Праздники и их день в году (в невисокосном): 14 февраля, 31 октября, 25 декабря. */
const HOLIDAYS: readonly (readonly [SeasonId, number])[] = [
  ['valentine', 45],
  ['halloween', 304],
  ['christmas', 359],
];

/** Праздничный образ для даты: тот праздник, до которого (или после которого) ближе всего дней, считая по кругу года. */
export function seasonFor(now: Date): SeasonId {
  const day = (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(now.getFullYear(), 0, 0)) / 864e5; // номер дня в году без влияния часового пояса и перехода на летнее время
  let best: SeasonId = 'christmas';
  let gap = 999;
  for (const [id, at] of HOLIDAYS) {
    const d = Math.abs(day - at);
    if (Math.min(d, 365 - d) < gap) [best, gap] = [id, Math.min(d, 365 - d)];
  }
  return best;
}

/** Образ, который нужно поставить на страницу: сам выбранный, а у «Сезонных» — праздничный по дате. */
export const resolveSkin = (id: SkinId, now: Date = new Date()): SkinId => (id === SEASONAL_SKIN ? seasonFor(now) : id);

/** Цвета строки состояния для образа; null — «Классика», «Сезонные» (у них цвета берутся у праздничного образа на странице) или неизвестное значение. */
export const skinBar = (id: string | null): { light: string; dark: string } | null =>
  isSkinId(id) && id !== DEFAULT_SKIN && id !== LEGACY_SKIN && id !== SEASONAL_SKIN ? SKIN_BARS[id] : null;

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
const TRAITS: Readonly<Record<Exclude<SkinId, 'seasonal'>, string>> = {
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

/** Черты образа, который стоит на странице (у «Сезонных» — праздничного). */
export const skinTraits = (id: SkinId, now: Date = new Date()): SkinTraits => {
  const shown = resolveSkin(id, now);
  return parseTraits(shown === SEASONAL_SKIN ? null : TRAITS[shown]);
};
