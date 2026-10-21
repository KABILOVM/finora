import { describe, expect, it } from 'vitest';
import { render, screen, user } from '@/components/testUtils';
import { computeIds } from '@/import/ids';
import { parseZenmoney } from '@/import/parse';
import { buildPlan } from '@/import/plan';
import type { ImportPlan, WalletLite } from '@/import/types';
import { OPS_FIRST, OPS_MORE, OpsPreview } from './OpsPreview';

const HEAD = 'date,categoryName,payee,comment,outcomeAccountName,outcome,outcomeCurrencyShortTitle,incomeAccountName,income,incomeCurrencyShortTitle';
const line = (date: string, cat: string, amount: string, account = 'Карта Алиф', note = '') => `${date},${cat},,${note},${account},${amount},TJS,,0,`;
const csv = (...rows: string[]) => `${HEAD}\n${rows.join('\n')}\n`;

async function planOf(text: string, extra: { wallets?: WalletLite[]; existingFirst?: boolean; choice?: string } = {}): Promise<ImportPlan> {
  const parsed = parseZenmoney(text);
  const ids = await computeIds('u', parsed);
  const key = [...ids.wallets.keys()][0]!;
  return buildPlan({
    parsed,
    ids,
    baseCurrency: 'TJS',
    wallets: extra.wallets ?? [],
    categories: [],
    existing: extra.existingFirst ? new Map([[ids.tx[0]!, false]]) : new Map(),
    walletChoices: extra.choice ? { [key]: extra.choice } : {},
  });
}

const titles = () => Array.from(screen.getByRole('list', { name: 'Операции из файла' }).querySelectorAll('li')).map((li) => li.textContent ?? '');

describe('операции из файла в предпросмотре', () => {
  it('сначала то, что добавится; свежие операции выше; кошелёк — выбранный, а не счёт из Дзен-мани', async () => {
    const main: WalletLite = { id: 'w-main', name: 'Основной', currency: 'TJS', archivedAt: null, deletedAt: null };
    const plan = await planOf(csv(line('2026-09-01', 'Еда', '10.00', 'Карта Алиф', 'старая'), line('2026-09-09', 'Еда', '20.00', 'Карта Алиф', 'новая'), line('2026-09-05', 'Еда', '30.00', 'Карта Алиф', 'средняя')), {
      wallets: [main],
      choice: 'w-main',
    });
    render(<OpsPreview plan={plan} />);
    const rows = titles();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('09.09.2026');
    expect(rows[1]).toContain('05.09.2026');
    expect(rows[2]).toContain('01.09.2026');
    expect(rows[0]).toContain('Еда · Основной');
    expect(rows.join('')).not.toContain('Карта Алиф');
  });

  it('фильтры по статусу со счётчиками: по умолчанию «Добавятся», «Уже есть» переключает список', async () => {
    const plan = await planOf(csv(line('2026-09-01', 'Еда', '10.00'), line('2026-09-02', 'Еда', '20.00'), line('2026-09-03', 'Еда', '30.00')), { existingFirst: true });
    render(<OpsPreview plan={plan} />);
    const added = screen.getByRole('button', { name: 'Добавятся 2' });
    const exists = screen.getByRole('button', { name: 'Уже есть 1' });
    expect(added.getAttribute('aria-pressed')).toBe('true');
    expect(titles()).toHaveLength(2);
    await user.click(exists);
    expect(exists.getAttribute('aria-pressed')).toBe('true');
    expect(titles()).toHaveLength(1);
    expect(titles()[0]).toContain('Уже есть');
    expect(titles()[0]).toContain('01.09.2026');
  });

  it('один статус на весь файл — чипов нет', async () => {
    const plan = await planOf(csv(line('2026-09-01', 'Еда', '10.00'), line('2026-09-02', 'Еда', '20.00')));
    render(<OpsPreview plan={plan} />);
    expect(screen.queryByRole('group', { name: 'Какие операции показать' })).toBeNull();
    expect(titles()).toHaveLength(2);
  });

  it('выбранного статуса в плане больше нет (все «уже есть» исчезли) — показывается первый из имеющихся', async () => {
    const withExisting = await planOf(csv(line('2026-09-01', 'Еда', '10.00'), line('2026-09-02', 'Еда', '20.00')), { existingFirst: true });
    const { rerender } = render(<OpsPreview plan={withExisting} />);
    await user.click(screen.getByRole('button', { name: 'Уже есть 1' }));
    expect(titles()[0]).toContain('Уже есть');
    const without = await planOf(csv(line('2026-09-01', 'Еда', '10.00'), line('2026-09-02', 'Еда', '20.00')));
    rerender(<OpsPreview plan={without} />);
    expect(titles()).toHaveLength(2);
    expect(titles()[0]).toContain('Добавится');
  });

  it(`по ${OPS_FIRST} штук и «Показать ещё ${OPS_MORE}»: остаток называется своим числом, кнопка пропадает, когда всё показано`, async () => {
    const total = OPS_FIRST + OPS_MORE + 5;
    const rows = Array.from({ length: total }, (_, i) => line(`2026-09-${String((i % 28) + 1).padStart(2, '0')}`, 'Еда', `${i + 1}.00`));
    const plan = await planOf(csv(...rows));
    render(<OpsPreview plan={plan} />);
    expect(titles()).toHaveLength(OPS_FIRST);
    expect(document.querySelector('[data-testid="ops-shown"]')?.textContent).toBe(`Показано ${OPS_FIRST} из ${total}.`);
    await user.click(screen.getByRole('button', { name: `Показать ещё ${OPS_MORE}` }));
    expect(titles()).toHaveLength(OPS_FIRST + OPS_MORE);
    await user.click(screen.getByRole('button', { name: 'Показать ещё 5' }));
    expect(titles()).toHaveLength(total);
    expect(screen.queryByRole('button', { name: /^Показать ещё/ })).toBeNull();
  });

  it('категория прошлого импорта удалена — в строке «Без категории», а не путь из файла', async () => {
    const plan = await planOf(csv(line('2026-09-01', 'Еда / Кафе', '10.00')));
    for (const c of plan.categories) c.target = { kind: 'missing', reason: 'Категория удалена' };
    render(<OpsPreview plan={plan} />);
    expect(titles()[0]).toContain('Без категории · Карта Алиф');
    expect(titles()[0]).not.toContain('Кафе');
  });

  it('нет операций — блока нет', async () => {
    const plan = await planOf(csv(line('2026-09-01', 'Еда', '10.00')));
    const { container } = render(<OpsPreview plan={{ ...plan, ops: [] }} />);
    expect(container.textContent).toBe('');
  });
});

describe('возможные дубли в предпросмотре', () => {
  const wallet: WalletLite = { id: 'w-main', name: 'Основной', currency: 'TJS', archivedAt: null, deletedAt: null };
  const stored = { deleted: false, kind: 'expense' as const, walletId: 'w-main', toWalletId: null, amountMinor: 1000, toAmountMinor: null, occurredOn: '2026-09-01', note: 'кофе' };

  async function dupPlan(forceAdd?: ReadonlySet<string>) {
    const parsed = parseZenmoney(csv(line('2026-09-01', 'Еда', '10.00', 'Карта Алиф', 'кофе')));
    const ids = await computeIds('u', parsed);
    const key = [...ids.wallets.keys()][0]!;
    const input = { parsed, ids, baseCurrency: 'TJS', wallets: [wallet], categories: [], existing: new Map([['чужой', stored]]), walletChoices: { [key]: 'w-main' } };
    return { plan: buildPlan(forceAdd ? { ...input, forceAdd } : input), id: ids.tx[0]! };
  }

  it('совпавшая по содержимому операция — «Возможный дубль» с кнопкой «Добавить всё равно»', async () => {
    const { plan, id } = await dupPlan();
    const calls: [string, boolean][] = [];
    render(<OpsPreview plan={plan} forced={new Set()} onForce={(i, on) => calls.push([i, on])} />);
    expect(titles()[0]).toContain('Возможный дубль');
    await user.click(screen.getByRole('button', { name: /^Добавить всё равно/ }));
    expect(calls).toEqual([[id, true]]);
  });

  it('добавляемая всё равно помечена «Как дубль» и отменяется кнопкой «Не добавлять»', async () => {
    const first = await dupPlan();
    const { plan, id } = await dupPlan(new Set([first.id]));
    const calls: [string, boolean][] = [];
    render(<OpsPreview plan={plan} forced={new Set([first.id])} onForce={(i, on) => calls.push([i, on])} />);
    expect(plan.counts.add).toBe(1);
    expect(titles()[0]).toContain('Как дубль');
    await user.click(screen.getByRole('button', { name: /^Не добавлять/ }));
    expect(calls).toEqual([[id, false]]);
  });

  it('без обработчика (старый вызов) кнопок нет, подпись «Возможный дубль» остаётся', async () => {
    const { plan } = await dupPlan();
    render(<OpsPreview plan={plan} />);
    expect(titles()[0]).toContain('Возможный дубль');
    expect(screen.queryByRole('button', { name: /Добавить всё равно/ })).toBeNull();
  });
});

