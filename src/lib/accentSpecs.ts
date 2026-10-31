/**
 * Акценты, палитры которых выпущены генератором (src/lib/palette.ts): оттенок в градусах OKLCH и яркость красок (0 — серый,
 * 1 — самые сочные). Их блоки в index.css лежат между отметками «generated accents» и пересобираются командой `npm run gen:accents`;
 * src/accents.test.ts сверяет файл с генератором. Новый акцент: добавить строку сюда и в ACCENTS (src/theme.ts), запустить команду.
 */
export const GENERATED_ACCENTS = [
  { id: 'purple', label: 'Пурпурный', hue: 305, vivid: 1 },
  { id: 'orchid', label: 'Орхидея', hue: 322, vivid: 0.95 },
  { id: 'magenta', label: 'Маджента', hue: 340, vivid: 1 },
  { id: 'crimson', label: 'Малиновый', hue: 12, vivid: 0.95 },
  { id: 'coral', label: 'Коралловый', hue: 22, vivid: 0.85 },
  { id: 'peach', label: 'Персиковый', hue: 55, vivid: 0.85 },
  { id: 'amber', label: 'Янтарный', hue: 72, vivid: 0.9 },
  { id: 'mustard', label: 'Горчичный', hue: 95, vivid: 0.85 },
  { id: 'olive', label: 'Оливковый', hue: 112, vivid: 0.6 },
  { id: 'lime', label: 'Салатовый', hue: 130, vivid: 0.9 },
  { id: 'emerald', label: 'Изумрудный', hue: 162, vivid: 0.95 },
  { id: 'mint', label: 'Мятный', hue: 178, vivid: 0.85 },
  { id: 'cyan', label: 'Голубой', hue: 220, vivid: 0.95 },
  { id: 'sky', label: 'Небесный', hue: 240, vivid: 0.95 },
  { id: 'lavender', label: 'Лавандовый', hue: 298, vivid: 0.55 },
  { id: 'slate', label: 'Сланцевый', hue: 255, vivid: 0.25 },
  { id: 'graphite', label: 'Графитовый', hue: 270, vivid: 0.04 },
  { id: 'brown', label: 'Коричневый', hue: 55, vivid: 0.5 },
  { id: 'sand', label: 'Песочный', hue: 85, vivid: 0.35 },
] as const satisfies readonly { id: string; label: string; hue: number; vivid: number }[];

export type GeneratedAccentSpec = (typeof GENERATED_ACCENTS)[number];
