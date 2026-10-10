import type { CurrencyCode, LocalRow, Settings, UUID } from '@/domain/types';
import { ValidationError } from './errors';
import { cleanPatch, getLiveWallet, sameFields, touch, writeTx, type RepoContext } from './repoContext';
import { parseSettingsData, type SettingsData } from './validate';

export interface SettingsPatch {
  baseCurrency?: CurrencyCode;
  weekStartsOn?: 0 | 1;
  defaultWalletId?: UUID | null;
}

export interface SettingsRepo {
  /** Единственная строка настроек пользователя (id = userId). null — ещё не создана (до первой загрузки/затравки). */
  get(): Promise<LocalRow<Settings> | null>;
  update(patch: SettingsPatch): Promise<LocalRow<Settings>>;
  /**
   * Создаёт настройки, если их ещё нет (иначе возвращает существующие, ничего не меняя).
   * Только для затравки: вызывать ДО первой загрузки с сервера нельзя — свежая локальная строка
   * «новее» серверной и затёрла бы настоящие настройки пользователя.
   */
  ensure(initial?: SettingsPatch): Promise<LocalRow<Settings>>;
}

const KEYS = ['baseCurrency', 'weekStartsOn', 'defaultWalletId'] as const;
const DATA_KEYS: readonly (keyof SettingsData)[] = ['baseCurrency', 'locale', 'weekStartsOn', 'defaultWalletId'];
const DEFAULTS: SettingsData = { baseCurrency: 'TJS', locale: 'ru', weekStartsOn: 1, defaultWalletId: null };

function dataOf(s: Settings): SettingsData {
  return { baseCurrency: s.baseCurrency, locale: s.locale, weekStartsOn: s.weekStartsOn, defaultWalletId: s.defaultWalletId };
}

export function createSettingsRepo(ctx: RepoContext): SettingsRepo {
  const { db } = ctx;

  /** Кошелёк по умолчанию: живой и не в архиве. */
  async function checkDefaultWallet(id: UUID | null): Promise<void> {
    if (id === null) return;
    const w = await getLiveWallet(ctx, id, 'Кошелёк по умолчанию');
    if (w.archivedAt !== null) throw new ValidationError(`Кошелёк «${w.name}» в архиве — его нельзя выбрать по умолчанию`);
  }

  return {
    async get() {
      const row = await db.settings.get(ctx.userId);
      return row && row.deletedAt === null ? row : null;
    },

    async update(patch) {
      const clean = cleanPatch(patch, KEYS, 'Настройки');
      return writeTx(ctx, [db.settings, db.wallets], async () => {
        const cur = await db.settings.get(ctx.userId);
        if (!cur || cur.deletedAt !== null) throw new ValidationError('Настройки ещё не созданы: дождитесь первой загрузки данных');
        const next = parseSettingsData({ ...dataOf(cur), ...clean });
        if (sameFields(dataOf(cur), next, DATA_KEYS)) return cur;
        if (next.defaultWalletId !== cur.defaultWalletId) await checkDefaultWallet(next.defaultWalletId);
        const row: LocalRow<Settings> = { ...cur, ...next, ...touch(ctx).fields };
        await db.settings.put(row);
        return row;
      });
    },

    async ensure(initial = {}) {
      const clean = cleanPatch(initial, KEYS, 'Настройки');
      return writeTx(ctx, [db.settings, db.wallets], async () => {
        const cur = await db.settings.get(ctx.userId);
        if (cur) return cur;
        const data = parseSettingsData({ ...DEFAULTS, ...clean });
        await checkDefaultWallet(data.defaultWalletId);
        const { stamp, fields } = touch(ctx);
        const row: LocalRow<Settings> = {
          id: ctx.userId,
          createdAt: stamp,
          deletedAt: null,
          ...data,
          ...fields,
          serverSeq: null,
        };
        await db.settings.add(row);
        return row;
      });
    },
  };
}
