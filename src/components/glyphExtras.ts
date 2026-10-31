import { EXTRA_ICONS } from './iconExtraData';
import { createLazyGroups } from './lazyGroups';

/**
 * Дополнительные значки категорий и кошельков (семья, коммунальные услуги, еда, транспорт, здоровье, покупки, отдых, работа…): тот же набор Solar и то же
 * значение «i:имя», что у основных значков (iconData.ts), но разметка лежит отдельными файлами по разделам (iconExtra/icons-<раздел>.ts, их создаёт
 * scripts/gen-icons-extra.cjs) и грузится лениво, только когда значок показан на экране. Так основной файл приложения не растёт.
 */
const BY_NAME = new Map(EXTRA_ICONS.map((i) => [i.name, i]));

/** Дополнительный значок по имени («wife»); undefined — такого нет (в том числе для основных значков). */
export const extraIconByName = (name: string) => BY_NAME.get(name);

/** Загрузчики по разделам. Новый раздел с новыми значками в gen-icons-extra.cjs — новая строка здесь (тест следит, чтобы они совпадали). */
export const EXTRA_LOADERS: ReadonlyMap<string, () => Promise<{ ICONS: Readonly<Record<string, string>> }>> = new Map([
  ['family', () => import('./iconExtra/icons-family')],
  ['home', () => import('./iconExtra/icons-home')],
  ['food', () => import('./iconExtra/icons-food')],
  ['transport', () => import('./iconExtra/icons-transport')],
  ['health', () => import('./iconExtra/icons-health')],
  ['shop', () => import('./iconExtra/icons-shop')],
  ['fun', () => import('./iconExtra/icons-fun')],
  ['work', () => import('./iconExtra/icons-work')],
  ['misc', () => import('./iconExtra/icons-misc')],
]);

const store = createLazyGroups(EXTRA_LOADERS, (m) => m.ICONS, 'Не удалось загрузить значки:');

/** Загружает разделы значков (один раз каждый). Никогда не отклоняется. */
export const loadExtraIcons = store.load;

/** Разметка значка; null, пока файл его раздела грузится (или такого значка нет). */
export function useExtraIconMarkup(name: string): string | null {
  const section = BY_NAME.get(name)?.section ?? '';
  return store.useGroup(section)?.[name] ?? null;
}
