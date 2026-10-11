import { describe, expect, it } from 'vitest';
import {
  canAdvance,
  decide,
  doneProgress,
  findSameName,
  freeSuggestions,
  initialProgress,
  isPristine,
  nextStep,
  parseProgress,
  prevStep,
  serializeProgress,
  stepNumber,
  type DataSnapshot,
  type WalletSnap,
} from './onboardingLogic';

const SEED = 'seed-cash';
const seedWallet = (over: Partial<WalletSnap> = {}): WalletSnap => ({
  id: SEED,
  name: 'Наличные',
  kind: 'cash',
  currency: 'TJS',
  openingBalanceMinor: 0,
  createdAt: '2026-10-11T10:00:00.000Z',
  clientUpdatedAt: '2026-10-11T10:00:00.000Z',
  deletedAt: null,
  archivedAt: null,
  ...over,
});
const snap = (over: Partial<DataSnapshot> = {}): DataSnapshot => ({
  settingsReady: true,
  wallets: [seedWallet()],
  hasTransactions: false,
  hasPlans: false,
  ...over,
});

describe('шаги', () => {
  it('нумерация: стартовый без номера, дальше 1..5', () => {
    expect(stepNumber('start')).toBeNull();
    expect(['currency', 'wallets', 'categories', 'extras', 'finish'].map((s) => stepNumber(s as never))).toEqual([1, 2, 3, 4, 5]);
  });
  it('вперёд и назад не выходят за края', () => {
    expect(nextStep('start')).toBe('currency');
    expect(nextStep('finish')).toBe('finish');
    expect(prevStep('currency')).toBe('start');
    expect(prevStep('start')).toBe('start');
  });
  it('«Дальше» на кошельках нужен хотя бы один кошелёк', () => {
    expect(canAdvance('wallets', 0)).toBe(false);
    expect(canAdvance('wallets', 1)).toBe(true);
    expect(canAdvance('currency', 0)).toBe(true);
  });
});

describe('хранение прогресса', () => {
  it('круг: записали — прочитали то же', () => {
    const p = { ...initialProgress(), step: 'wallets' as const, path: 'scratch' as const, wants: { reminders: true, lock: false, install: true } };
    expect(parseProgress(serializeProgress(p))).toEqual(p);
  });
  it.each([null, '', '{', 'null', '[]', '{"v":2}', '"x"'])('мусор %j — это «ничего не сохранено»', (raw) => {
    expect(parseProgress(raw)).toBeNull();
  });
  it('неизвестный шаг и путь заменяются безопасными', () => {
    expect(parseProgress('{"v":1,"step":"boom","path":"x"}')).toMatchObject({ step: 'start', path: null, done: false });
  });
});

describe('когда показывать', () => {
  it('пока данных нет — ждём, не мигаем', () => {
    expect(decide(null, undefined, SEED)).toBe('wait');
    expect(decide(null, snap({ settingsReady: false }), SEED)).toBe('wait');
    expect(decide(null, snap(), null)).toBe('wait');
  });
  it('новый человек (только нетронутый стартовый кошелёк) — показать', () => {
    expect(decide(null, snap(), SEED)).toBe('show');
    expect(decide(null, snap({ wallets: [] }), SEED)).toBe('show');
  });
  it('старый аккаунт: есть свой кошелёк — не показывать и запомнить', () => {
    expect(decide(null, snap({ wallets: [seedWallet(), seedWallet({ id: 'w2', name: 'Карта' })] }), SEED)).toBe('complete');
  });
  it('стартовый кошелёк, который правили, считается данными человека', () => {
    expect(decide(null, snap({ wallets: [seedWallet({ clientUpdatedAt: '2026-10-12T10:00:00.000Z' })] }), SEED)).toBe('complete');
    expect(decide(null, snap({ wallets: [seedWallet({ openingBalanceMinor: 500 })] }), SEED)).toBe('complete');
    expect(decide(null, snap({ wallets: [seedWallet({ archivedAt: '2026-10-12T10:00:00.000Z' })] }), SEED)).toBe('complete');
  });
  it('кошельки пришли из облака (другое устройство) — не показывать', () => {
    expect(decide(null, snap({ wallets: [seedWallet({ id: 'cloud-1', name: 'Карта' })] }), SEED)).toBe('complete');
  });
  it('есть операции или планы — не показывать', () => {
    expect(decide(null, snap({ hasTransactions: true }), SEED)).toBe('complete');
    expect(decide(initialProgress(), snap({ hasPlans: true }), SEED)).toBe('complete');
  });
  it('завершённый или пропущенный мастер больше не показывается, даже пока данных нет', () => {
    expect(decide(doneProgress(true), snap(), SEED)).toBe('hide');
    expect(decide(doneProgress(false), undefined, null)).toBe('hide');
  });
  it('мастер начат: продолжаем с того же шага, даже когда кошельки уже заведены', () => {
    const p = { ...initialProgress(), step: 'categories' as const, path: 'scratch' as const };
    expect(decide(p, snap({ wallets: [seedWallet({ openingBalanceMinor: 100 }), seedWallet({ id: 'w2', name: 'Карта' })] }), SEED)).toBe('show');
  });
  it('свернул на перенос: пока данных нет — показываем, когда копия загружена — мастер завершён', () => {
    const p = { ...initialProgress(), path: 'import' as const };
    expect(decide(p, snap(), SEED)).toBe('show');
    expect(decide(p, snap({ wallets: [seedWallet(), seedWallet({ id: 'z', name: 'Zen' })] }), SEED)).toBe('complete');
    expect(decide(p, snap({ hasTransactions: true }), SEED)).toBe('complete');
  });
  it('isPristine: без кошельков тоже чисто', () => {
    expect(isPristine(snap({ wallets: [] }), SEED)).toBe(true);
  });
});

describe('кошельки без дублей', () => {
  it('подсказки исчезают, когда такой кошелёк уже есть (без учёта регистра и пробелов)', () => {
    expect(freeSuggestions([]).map((s) => s.name)).toEqual(['Наличные', 'Карта', 'Накопления']);
    expect(freeSuggestions(['наличные ', 'КАРТА']).map((s) => s.name)).toEqual(['Накопления']);
  });
  it('findSameName находит тот же кошелёк и не считает сам себя', () => {
    const list = [{ id: 'a', name: 'Карта' }, { id: 'b', name: 'Наличные' }];
    expect(findSameName(list, ' карта')?.id).toBe('a');
    expect(findSameName(list, 'Карта', 'a')).toBeUndefined();
    expect(findSameName(list, 'Сейф')).toBeUndefined();
  });
});
