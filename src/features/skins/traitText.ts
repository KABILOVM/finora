import type { SkinHero, SkinMaterial, SkinMotion, SkinNav, SkinScene, SkinShape, SkinTraits } from '@/skinCore';

/** Черты образа словами: для окна предпросмотра и конструктора. Порядок ключей — как показываем. */
export const SHAPE_TEXT: Readonly<Record<SkinShape, string>> = {
  soft: 'Мягкие углы',
  round: 'Круглые формы',
  sharp: 'Острые углы',
  square: 'Прямые углы',
  cut: 'Срезанный угол',
};
export const MATERIAL_TEXT: Readonly<Record<SkinMaterial, string>> = {
  solid: 'Плотные карточки',
  glass: 'Стекло',
  outline: 'Контур',
  pop: 'Плакат',
  neon: 'Неон',
  clay: 'Глина',
  paper: 'Бумага',
  metal: 'Металл',
  lux: 'Бархат',
};
export const NAV_TEXT: Readonly<Record<SkinNav, string>> = {
  dock: 'Парящее меню',
  bar: 'Меню-полоса',
  island: 'Меню-остров',
  tabs: 'Вкладки',
};
export const HERO_TEXT: Readonly<Record<SkinHero, string>> = {
  card: 'Банковская карта',
  gradient: 'Градиент',
  board: 'Табло',
  ticket: 'Билет',
  terminal: 'Терминал',
  banner: 'Афиша',
};
export const MOTION_TEXT: Readonly<Record<SkinMotion, string>> = {
  smooth: 'Плавно',
  bouncy: 'Пружинит',
  snappy: 'Резко',
  steps: 'Рывками',
  calm: 'Спокойно',
};
export const SCENE_TEXT: Readonly<Record<SkinScene, string>> = {
  none: 'Без живого фона',
  aurora: 'Мягкое свечение',
  snow: 'Снег',
  rain: 'Дождь',
  petals: 'Лепестки',
  leaves: 'Листья',
  stars: 'Звёзды',
  bubbles: 'Пузыри',
  confetti: 'Конфетти',
  embers: 'Искры',
  grid: 'Неоновая сетка',
  hearts: 'Сердечки',
  dust: 'Золотая пыль',
  fireflies: 'Огоньки',
  lights: 'Прожекторы',
  speed: 'Линии скорости',
  ticker: 'Биржевые свечи',
  sand: 'Песок',
  pixels: 'Пиксели',
};

/** Шесть строк «что меняет образ»: подпись черты и её значение словами. */
export function traitRows(t: SkinTraits): readonly { key: string; label: string; value: string }[] {
  return [
    { key: 'shape', label: 'Форма', value: SHAPE_TEXT[t.shape] },
    { key: 'material', label: 'Карточки', value: MATERIAL_TEXT[t.material] },
    { key: 'nav', label: 'Меню', value: NAV_TEXT[t.nav] },
    { key: 'hero', label: 'Карточка «Всего»', value: HERO_TEXT[t.hero] },
    { key: 'motion', label: 'Движение', value: MOTION_TEXT[t.motion] },
    { key: 'scene', label: 'Живой фон', value: SCENE_TEXT[t.scene] },
  ];
}
