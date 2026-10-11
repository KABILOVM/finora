import { useSyncExternalStore } from 'react';

/**
 * Память автопроведения в пределах открытого приложения (в базу НЕ пишется — данные правил не меняются):
 *  - почему правило не провелось само (его экран показывает пометкой «Не удалось провести: …»);
 *  - о каких курсах уже сказали человеку (чтобы тост «нет курса» не повторялся при каждом возвращении на вкладку);
 *  - просьба «проведи сейчас» от экранов (после сохранения правила).
 */

export interface AutoPostFailure {
  /** error — ошибка проверки (кошелёк в архиве, категория удалена, долг удалён…); no-rate — нет свежего курса. */
  kind: 'error' | 'no-rate';
  /** Причина по-русски, без начала «Не удалось провести:» — его добавляет экран. */
  message: string;
}

type Failures = ReadonlyMap<string, AutoPostFailure>;

const EMPTY: Failures = new Map();
let snapshot: { userId: string | null; failures: Failures } = { userId: null, failures: EMPTY };
const listeners = new Set<() => void>();

function sameFailures(a: Failures, b: Failures): boolean {
  if (a.size !== b.size) return false;
  for (const [id, f] of a) {
    const g = b.get(id);
    if (!g || g.kind !== f.kind || g.message !== f.message) return false;
  }
  return true;
}

/**
 * Итог прохода: failures — свежие причины; eligible — все правила, которые участвуют в автопроведении; examined — те из них,
 * что разобраны до конца (при обрыве по лимиту часть правил ждёт следующего прохода — их прежние пометки не трогаем).
 * Правило, которое перестало участвовать (архив, «Проводить само» выключено), теряет пометку.
 */
export function publishFailures(
  userId: string,
  failures: Failures,
  eligible: ReadonlySet<string>,
  examined: ReadonlySet<string>,
): void {
  const prev = snapshot.userId === userId ? snapshot.failures : EMPTY;
  const next = new Map<string, AutoPostFailure>();
  for (const [id, f] of prev) if (eligible.has(id) && !examined.has(id)) next.set(id, f);
  for (const [id, f] of failures) next.set(id, f);
  if (snapshot.userId === userId && sameFailures(prev, next)) return;
  snapshot = { userId, failures: next.size === 0 ? EMPTY : next };
  for (const l of [...listeners]) l();
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const getSnapshot = () => snapshot;

/** Пометки «не провелось само» для правил этого пользователя (id правила → причина). Обновляется после каждого прохода. */
export function useAutoPostFailures(userId: string): Failures {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return snap.userId === userId ? snap.failures : EMPTY;
}

export function currentFailures(userId: string): Failures {
  return snapshot.userId === userId ? snapshot.failures : EMPTY;
}

// ───────────────────────── «нет курса»: сказать один раз ─────────────────────────

const noticed = new Map<string, Set<string>>();

/**
 * Из пар без курса (сейчас) оставляет те, о которых человеку ещё не говорили, и запоминает их как «сказано».
 * Пары, которых в списке уже нет (курс появился или платежей не осталось), забываются: о новой беде скажем заново.
 */
export function takeNewMissingRates(userId: string, current: readonly string[]): string[] {
  const set = noticed.get(userId) ?? new Set<string>();
  noticed.set(userId, set);
  for (const p of [...set]) if (!current.includes(p)) set.delete(p);
  const fresh = current.filter((p) => !set.has(p));
  for (const p of fresh) set.add(p);
  return fresh;
}

// ───────────────────────── «проведи сейчас» ─────────────────────────

const requests = new Set<() => void>();

/** Попросить автопроведение пройтись сейчас (например, после сохранения правила). Без запущенного приложения ничего не делает. */
export function requestAutoPostRun(): void {
  for (const l of [...requests]) l();
}

export function onAutoPostRequest(listener: () => void): () => void {
  requests.add(listener);
  return () => void requests.delete(listener);
}

/** Для тестов: забыть всё. */
export function resetAutoPostState(): void {
  snapshot = { userId: null, failures: EMPTY };
  noticed.clear();
  for (const l of [...listeners]) l();
}
