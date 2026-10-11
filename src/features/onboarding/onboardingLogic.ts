import { sameName } from '@/features/wallets/walletUi';
import type { CurrencyCode, WalletKind } from '@/domain/types';

/**
 * Чистая логика пошаговой настройки: какие бывают шаги, что хранится о прогрессе и КОГДА мастер показывать.
 * Здесь нет ни React, ни базы — всё проверяется обычными тестами.
 */

export const STEPS = ['start', 'currency', 'wallets', 'categories', 'extras', 'finish'] as const;
export type StepId = (typeof STEPS)[number];

/** Шаги «с нуля», у которых есть номер («Шаг 2 из 5»). Стартовый экран без номера. */
export const NUMBERED_STEPS = ['currency', 'wallets', 'categories', 'extras', 'finish'] as const;
export const TOTAL_STEPS = NUMBERED_STEPS.length;

export type OnboardingPath = 'scratch' | 'import';

export interface Wants {
  reminders: boolean;
  lock: boolean;
  install: boolean;
}

export interface Progress {
  v: 1;
  step: StepId;
  /** Куда человек свернул на стартовом экране; null — ещё не выбирал. */
  path: OnboardingPath | null;
  /** Мастер закончен (пройден, пропущен или перенос состоялся): больше не показывается. */
  done: boolean;
  skipped: boolean;
  wants: Wants;
}

export const initialProgress = (): Progress => ({
  v: 1,
  step: 'start',
  path: null,
  done: false,
  skipped: false,
  wants: { reminders: false, lock: false, install: false },
});

export const doneProgress = (skipped: boolean): Progress => ({ ...initialProgress(), step: 'finish', done: true, skipped });

const isStep = (v: unknown): v is StepId => typeof v === 'string' && (STEPS as readonly string[]).includes(v);

/** Читает сохранённый прогресс. Испорченное содержимое — как «ничего не сохранено» (null), а не ошибка. */
export function parseProgress(raw: string | null): Progress | null {
  if (raw === null) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown> | null;
    if (!o || typeof o !== 'object' || o.v !== 1) return null;
    const w = (o.wants && typeof o.wants === 'object' ? o.wants : {}) as Record<string, unknown>;
    return {
      v: 1,
      step: isStep(o.step) ? o.step : 'start',
      path: o.path === 'scratch' || o.path === 'import' ? o.path : null,
      done: o.done === true,
      skipped: o.skipped === true,
      wants: { reminders: w.reminders === true, lock: w.lock === true, install: w.install === true },
    };
  } catch {
    return null;
  }
}

export const serializeProgress = (p: Progress): string => JSON.stringify(p);

/** Номер шага для индикатора; у стартового экрана номера нет. */
export function stepNumber(step: StepId): number | null {
  const i = (NUMBERED_STEPS as readonly string[]).indexOf(step);
  return i < 0 ? null : i + 1;
}

export function nextStep(step: StepId): StepId {
  const i = STEPS.indexOf(step);
  return STEPS[Math.min(i + 1, STEPS.length - 1)] ?? 'finish';
}

export function prevStep(step: StepId): StepId {
  const i = STEPS.indexOf(step);
  return STEPS[Math.max(i - 1, 0)] ?? 'start';
}

/** Можно ли нажать «Дальше»: на шаге кошельков нужен хотя бы один. */
export function canAdvance(step: StepId, liveWalletCount: number): boolean {
  return step === 'wallets' ? liveWalletCount >= 1 : true;
}

/* ------------------------------ когда показывать ------------------------------ */

export interface WalletSnap {
  id: string;
  name: string;
  kind: WalletKind;
  currency: CurrencyCode;
  openingBalanceMinor: number;
  createdAt: string;
  clientUpdatedAt: string;
  deletedAt: string | null;
  archivedAt: string | null;
}

export interface DataSnapshot {
  /** Строка настроек уже есть (первая загрузка и затравка прошли). */
  settingsReady: boolean;
  /** ВСЕ строки кошельков, в том числе архивные и удалённые. */
  wallets: readonly WalletSnap[];
  /** Была хоть одна операция (даже удалённая). */
  hasTransactions: boolean;
  /** Есть бюджеты, долги или регулярные платежи. */
  hasPlans: boolean;
}

/** Стартовый «Наличные», который создала сама затравка и которого никто не трогал. */
export function isUntouchedSeedWallet(w: WalletSnap, seedWalletId: string): boolean {
  return (
    w.id === seedWalletId &&
    w.deletedAt === null &&
    w.archivedAt === null &&
    w.name === 'Наличные' &&
    w.kind === 'cash' &&
    w.openingBalanceMinor === 0 &&
    w.createdAt === w.clientUpdatedAt
  );
}

/** Данные «как у только что зарегистрировавшегося»: нет операций и планов, из кошельков — только нетронутый стартовый. */
export function isPristine(snap: DataSnapshot, seedWalletId: string): boolean {
  return !snap.hasTransactions && !snap.hasPlans && snap.wallets.every((w) => isUntouchedSeedWallet(w, seedWalletId));
}

/**
 * wait     — данных ещё нет, решать рано (не мигаем мастером до первой загрузки);
 * show     — показать мастер;
 * hide     — не показывать;
 * complete — показывать не надо и запомнить это (старый аккаунт, перенос уже случился).
 */
export type Decision = 'wait' | 'show' | 'hide' | 'complete';

export function decide(progress: Progress | null, snap: DataSnapshot | null | undefined, seedWalletId: string | null): Decision {
  if (progress?.done) return 'hide';
  if (!snap || !snap.settingsReady || seedWalletId === null) return 'wait';
  // Уже есть операции: человек пользуется приложением (или перенос из файла состоялся).
  if (snap.hasTransactions || snap.hasPlans) return 'complete';
  const pristine = isPristine(snap, seedWalletId);
  if (progress === null) return pristine ? 'show' : 'complete';
  // Свернул на перенос и данные уже появились (копия загружена) — перенос состоялся.
  if (progress.path === 'import' && !pristine) return 'complete';
  // Мастер уже начат: продолжаем с того же шага, даже если кошельки уже заведены.
  return 'show';
}

/* ------------------------------ кошельки без дублей ------------------------------ */

export const WALLET_SUGGESTIONS: readonly { name: string; kind: WalletKind }[] = [
  { name: 'Наличные', kind: 'cash' },
  { name: 'Карта', kind: 'card' },
  { name: 'Накопления', kind: 'savings' },
];

/** Подсказки, которых ещё нет среди кошельков. */
export function freeSuggestions(existingNames: readonly string[]): typeof WALLET_SUGGESTIONS {
  return WALLET_SUGGESTIONS.filter((s) => !existingNames.some((n) => sameName(n, s.name)));
}

/** Кошелёк с таким названием уже есть: второй такой же не создаём (повторное «Дальше» или двойной тап). */
export function findSameName<T extends { name: string; id: string }>(wallets: readonly T[], name: string, exceptId?: string): T | undefined {
  return wallets.find((w) => w.id !== exceptId && sameName(w.name, name));
}
