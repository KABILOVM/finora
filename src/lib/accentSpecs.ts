/**
 * Акценты, палитры которых выпущены генератором (src/lib/palette.ts): оттенок в градусах OKLCH и яркость красок (0 — серый,
 * 1 — самые сочные). Их блоки в index.css лежат между отметками «generated accents» и пересобираются командой `npm run gen:accents`;
 * src/accents.test.ts сверяет файл с генератором. `bar` — цвет строки состояния браузера (фон светлой и тёмной темы): записан готовым значением, чтобы основному файлу не нужен был генератор; тест сверяет его с генератором и index.css. Новый акцент: добавить строку сюда и в ACCENTS (src/theme.ts), запустить команду, значения bar подсказывает тест.
 */
export const GENERATED_ACCENTS = [
  { id: 'purple', label: 'Пурпурный', hue: 305, vivid: 1, bar: { light: '#f1ecf9', dark: '#0e0816' } },
  { id: 'orchid', label: 'Орхидея', hue: 322, vivid: 0.95, bar: { light: '#f5ebf6', dark: '#110713' } },
  { id: 'magenta', label: 'Маджента', hue: 340, vivid: 1, bar: { light: '#f8eaf3', dark: '#130610' } },
  { id: 'crimson', label: 'Малиновый', hue: 12, vivid: 0.95, bar: { light: '#faeaec', dark: '#160609' } },
  { id: 'coral', label: 'Коралловый', hue: 22, vivid: 0.85, bar: { light: '#faebea', dark: '#150707' } },
  { id: 'peach', label: 'Персиковый', hue: 55, vivid: 0.85, bar: { light: '#f8ece5', dark: '#140803' } },
  { id: 'amber', label: 'Янтарный', hue: 72, vivid: 0.9, bar: { light: '#f6ede3', dark: '#130901' } },
  { id: 'mustard', label: 'Горчичный', hue: 95, vivid: 0.85, bar: { light: '#f2efe3', dark: '#0f0b01' } },
  { id: 'olive', label: 'Оливковый', hue: 112, vivid: 0.6, bar: { light: '#eff0e6', dark: '#0c0c03' } },
  { id: 'lime', label: 'Салатовый', hue: 130, vivid: 0.9, bar: { light: '#ebf1e6', dark: '#080d03' } },
  { id: 'emerald', label: 'Изумрудный', hue: 162, vivid: 0.95, bar: { light: '#e5f3eb', dark: '#020f07' } },
  { id: 'mint', label: 'Мятный', hue: 178, vivid: 0.85, bar: { light: '#e4f3ef', dark: '#010f0b' } },
  { id: 'cyan', label: 'Голубой', hue: 220, vivid: 0.95, bar: { light: '#e3f2f7', dark: '#000e13' } },
  { id: 'sky', label: 'Небесный', hue: 240, vivid: 0.95, bar: { light: '#e5f1fa', dark: '#010d16' } },
  { id: 'lavender', label: 'Лавандовый', hue: 298, vivid: 0.55, bar: { light: '#f0edf6', dark: '#0c0a13' } },
  { id: 'slate', label: 'Сланцевый', hue: 255, vivid: 0.25, bar: { light: '#ebeff5', dark: '#070c11' } },
  { id: 'graphite', label: 'Графитовый', hue: 270, vivid: 0.04, bar: { light: '#edeff3', dark: '#090b10' } },
  { id: 'brown', label: 'Коричневый', hue: 55, vivid: 0.5, bar: { light: '#f5ede8', dark: '#120905' } },
  { id: 'sand', label: 'Песочный', hue: 85, vivid: 0.35, bar: { light: '#f2eee8', dark: '#0f0b04' } },
] as const satisfies readonly { id: string; label: string; hue: number; vivid: number; bar: { light: string; dark: string } }[];

export type GeneratedAccentSpec = (typeof GENERATED_ACCENTS)[number];
