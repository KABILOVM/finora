/** Как часто напоминать об установке. Версия в ключе: поменяем правила — старые отметки не мешают. */
export const INSTALL_PROMPT_KEY = 'finora.installPrompt.v1';
export const SNOOZE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface InstallMemory {
  /** Когда нажали «Не сейчас» (мс). */
  dismissedAt?: number;
  /** Приложение установлено — больше не предлагаем. */
  installed?: boolean;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): Store | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export function readMemory(store: Store | null = defaultStore()): InstallMemory {
  try {
    const raw = store?.getItem(INSTALL_PROMPT_KEY);
    if (!raw) return {};
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return {};
    const o = v as Record<string, unknown>;
    return {
      dismissedAt: typeof o.dismissedAt === 'number' && Number.isFinite(o.dismissedAt) ? o.dismissedAt : undefined,
      installed: o.installed === true ? true : undefined,
    };
  } catch {
    return {}; // хранилище недоступно или запись повреждена — как будто ничего не помним
  }
}

function patchMemory(patch: InstallMemory, store: Store | null = defaultStore()): void {
  try {
    store?.setItem(INSTALL_PROMPT_KEY, JSON.stringify({ ...readMemory(store), ...patch }));
  } catch {
    /* не страшно: тогда окно не покажется ещё раз в этой же сессии (см. shownThisSession) */
  }
}

export const rememberDismissed = (now: number, store?: Store | null): void => patchMemory({ dismissedAt: now }, store);
export const rememberInstalled = (store?: Store | null): void => patchMemory({ installed: true }, store);

/**
 * Можно ли показать окно сейчас.
 * Нет, если установили; закрыли меньше 7 дней назад (часы ушли назад — тоже считаем «недавно»);
 * уже показывали в этой сессии (работает и когда хранилища нет).
 */
export function shouldShowInstallPrompt(memory: InstallMemory, now: number, shownThisSession: boolean): boolean {
  if (shownThisSession) return false;
  if (memory.installed) return false;
  if (memory.dismissedAt !== undefined) {
    const passed = now - memory.dismissedAt;
    if (passed < SNOOZE_DAYS * DAY_MS) return false;
  }
  return true;
}
