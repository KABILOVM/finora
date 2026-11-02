/**
 * Банки для быстрого выбора при создании кошелька. Значок — настоящий значок приложения банка (public/tj/<service>.png, каталог сервисов
 * services.ts / tjData.ts); цвет — цвет кошелька (поле color), приблизительно фирменный.
 * В кошельке банк хранится в поле icon как «b:<id>», поэтому схема данных не меняется и прежние кошельки показываются так же.
 */
export interface Bank {
  id: string;
  name: string;
  /** Цвет кошелька (поле color). */
  color: string;
  /** Сервис каталога значков (services.ts), чей значок приложения показывается для банка. */
  service: string;
}

export const BANKS: readonly Bank[] = [
  { id: 'alif', name: 'Алиф', color: '#0a7a56', service: 'alifbank' },
  { id: 'dc', name: 'Душанбе Сити', color: '#1d4ed8', service: 'dcbank' },
  { id: 'humo', name: 'Хумо', color: '#ea580c', service: 'humo' },
];

export const bankById = (id: string): Bank | undefined => BANKS.find((b) => b.id === id);

/** Значение поля icon для банка. */
export const bankIcon = (id: string): string => `b:${id}`;
