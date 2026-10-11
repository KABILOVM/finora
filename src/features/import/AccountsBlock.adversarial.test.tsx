import { describe, expect, it } from 'vitest';
import { render } from '@/components/testUtils';
import { computeIds } from '@/import/ids';
import { parseZenmoney } from '@/import/parse';
import { buildPlan } from '@/import/plan';
import { AccountsBlock } from './AccountsBlock';

const HEAD = 'date,categoryName,payee,comment,outcomeAccountName,outcome,outcomeCurrencyShortTitle,incomeAccountName,income,incomeCurrencyShortTitle';
const TEXT = `${HEAD}\n2026-09-02,Еда,Корвон,Хлеб,Карта Алиф,12.00,TJS,,0,\n`;

/** Счёт заблокирован: кошелёк, созданный прошлым импортом, лежит в архиве. Человек закрыл карту и убрал кошелёк в архив. */
async function blockedPlan(choice?: 'new') {
  const parsed = parseZenmoney(TEXT);
  const ids = await computeIds('u', parsed);
  const key = [...ids.wallets.keys()][0]!;
  const archived = { id: ids.wallets.get(key)!, name: 'Карта Алиф', currency: 'TJS', archivedAt: '2026-01-01T00:00:00.000Z', deletedAt: null };
  return buildPlan({
    parsed,
    ids,
    baseCurrency: 'TJS',
    wallets: [archived],
    categories: [],
    existing: new Map(),
    walletChoices: choice ? { [key]: choice } : {},
  });
}

describe('сопоставление счетов: заблокированный счёт', () => {
  it('выбор «Создать новый кошелёк» ничего не меняет — значит, предлагать его нельзя', async () => {
    // выбор «создать новый» поверх заблокированного счёта остаётся заблокированным (id нового кошелька уже занят архивным)
    const afterChoice = await blockedPlan('new');
    expect(afterChoice.wallets[0]!.target.kind).toBe('blocked');

    // а экран всё равно предлагает такой пункт: человек выбирает его, список возвращается к «Выберите кошелёк», ничего не происходит
    const plan = await blockedPlan();
    render(<AccountsBlock wallets={plan.wallets} onChoose={() => undefined} />);
    const options = [...document.querySelectorAll('option')].map((o) => o.textContent ?? '');
    expect(options.filter((t) => /Создать новый кошелёк/.test(t))).toEqual([]);
  });

  it('когда новый кошелёк правда создастся, пункт есть; когда кошелёк прошлого импорта уже существует — нет', async () => {
    const parsed = parseZenmoney(TEXT);
    const ids = await computeIds('u', parsed);
    const key = [...ids.wallets.keys()][0]!;
    const base = { parsed, ids, baseCurrency: 'TJS', categories: [], existing: new Map() };

    const fresh = buildPlan({ ...base, wallets: [] });
    const first = render(<AccountsBlock wallets={fresh.wallets} onChoose={() => undefined} />);
    expect([...document.querySelectorAll('option')].map((o) => o.textContent)).toContain('Создать новый кошелёк «Карта Алиф»');
    first.unmount();

    const own = { id: ids.wallets.get(key)!, name: 'Карта Алиф', currency: 'TJS', archivedAt: null, deletedAt: null };
    const saved = buildPlan({ ...base, wallets: [own] });
    render(<AccountsBlock wallets={saved.wallets} onChoose={() => undefined} />);
    expect([...document.querySelectorAll('option')].map((o) => o.textContent ?? '').filter((t) => /Создать новый кошелёк/.test(t))).toEqual([]);
  });
});
