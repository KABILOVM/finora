import { describe, expect, it } from 'vitest';
import { pruneFilters } from '@/components/filters/filterState';
import type { WalletKind } from '@/domain/types';
import { filterWallets, walletFilterFields } from './walletFilters';

const w = (kind: WalletKind, currency: string, name = `${kind}-${currency}`) => ({ kind, currency, name });

const wallets = [w('cash', 'TJS'), w('card', 'USD'), w('card', 'TJS'), w('savings', 'TJS', 'Отпуск')];

describe('фильтры кошельков', () => {
  it('поля: виды в привычном порядке, валюты — основная первой, остальные по алфавиту', () => {
    const fields = walletFilterFields([...wallets, w('bank', 'EUR')], 'TJS');
    expect(fields.map((f) => f.key)).toEqual(['kind', 'currency']);
    expect(fields[0]?.options.map((o) => o.label)).toEqual(['Наличные', 'Карта', 'Счёт в банке', 'Накопления']);
    expect(fields[1]?.options.map((o) => o.value)).toEqual(['TJS', 'EUR', 'USD']);
  });

  it('поле, где выбирать не из чего, не показывается', () => {
    expect(walletFilterFields([w('cash', 'TJS'), w('cash', 'TJS', 'Ещё')], 'TJS')).toEqual([]);
    expect(walletFilterFields([w('cash', 'TJS'), w('card', 'TJS')], 'TJS').map((f) => f.key)).toEqual(['kind']);
    expect(walletFilterFields([w('card', 'TJS'), w('card', 'USD')], 'TJS').map((f) => f.key)).toEqual(['currency']);
    expect(walletFilterFields([], 'TJS')).toEqual([]);
  });

  it('filterWallets: по виду, по валюте, вместе; пустой выбор — все по порядку', () => {
    const names = (v: Record<string, string>) => filterWallets(wallets, v).map((x) => x.name);
    expect(names({})).toEqual(['cash-TJS', 'card-USD', 'card-TJS', 'Отпуск']);
    expect(names({ kind: 'card' })).toEqual(['card-USD', 'card-TJS']);
    expect(names({ currency: 'TJS' })).toEqual(['cash-TJS', 'card-TJS', 'Отпуск']);
    expect(names({ kind: 'card', currency: 'USD' })).toEqual(['card-USD']);
    expect(names({ kind: 'savings', currency: 'USD' })).toEqual([]);
  });

  it('вид, которого больше нет среди активных, сбрасывается в «любой»', () => {
    const fields = walletFilterFields([w('cash', 'TJS'), w('card', 'USD')], 'TJS');
    expect(pruneFilters(fields, { kind: 'savings', currency: 'USD' })).toEqual({ kind: '', currency: 'USD' });
  });
});
