import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseMenuAction, findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { LocationProbe, opsDeps, pinToday, showApp, storeOf, table, unpinToday, type OpsDeps } from '@/features/transactions/__fixtures__/opsKit';
import DebtDetailPage from './DebtDetailPage';

beforeEach(pinToday);
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

const DEBT_ID = '0d6c0d3e-5a3b-4f43-9c59-7b4b0d3a1111';
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const text = (el: Element | null) => norm(el?.textContent);
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const tid = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const box = (name: RegExp) => screen.getByRole('checkbox', { name }) as HTMLInputElement;
/** Строка кандидата (label с галочкой) по подписи галочки. */
const row = (name: RegExp) => box(name).closest('label')!;
const CONFIRM = 'Объединить разных людей?';
/** Кнопка внутри окна подтверждения (в листе объединения есть кнопка с похожим текстом). */
const inAlert = (title: string, name: string): HTMLElement => {
  const dlg = screen.getByRole('alertdialog', { name: title });
  const hit = Array.from(dlg.querySelectorAll('button')).find((b) => text(b) === name);
  if (!hit) throw new Error(`В окне «${title}» нет кнопки «${name}»`);
  return hit;
};

type Setup = (s: Store, ids: { cash: string }) => Promise<unknown>;

/** «Наличные» с 1 000 с.; долг «Алишер» 500 с. («мне должны», выдан 1 октября деньгами с «Наличных»). */
async function show(setup?: Setup) {
  const td = opsDeps([table()], {
    setup: async (s) => {
      const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
      await s.transactions.create({ kind: 'income', walletId: cash, amountMinor: 100_000, occurredOn: '2026-09-30' });
      const d = await s.debts.create(
        { direction: 'lent', counterparty: 'Алишер', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01', note: 'на ремонт' },
        { id: DEBT_ID },
      );
      await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 50_000, occurredOn: '2026-10-01', debtId: d.id });
      await setup?.(s, { cash });
    },
  });
  await showApp(
    <>
      <Routes>
        <Route path="/debts/:id" element={<DebtDetailPage />} />
        <Route path="*" element={<p>Другая страница</p>} />
      </Routes>
      <LocationProbe />
    </>,
    td,
    `/debts/${DEBT_ID}`,
  );
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  return td;
}

const openMerge = async () => {
  await chooseMenuAction('Объединить…');
  return findByRole('dialog', { name: 'Объединить долги' });
};
const gone = (role: string, name: string) => waitFor(() => expect(screen.queryByRole(role, { name })).toBeNull());
const liveDebts = async (td: OpsDeps) => (await storeOf(td).db.debts.toArray()).filter((d) => d.deletedAt === null);

/**
 * Кроме «Алишер»: открытый «АЛИШЕР» 300 с. от 03.10.2026, закрытый «алишер» 200 с. от 20.09.2026
 * и открытый «Бобур» 100 с. от 05.03.2026 (все «мне должны», в сомони).
 */
const people: Setup = async (s) => {
  await s.debts.create({ direction: 'lent', counterparty: 'АЛИШЕР', principalMinor: 30_000, currency: 'TJS', openedOn: '2026-10-03' });
  const closed = await s.debts.create({ direction: 'lent', counterparty: 'алишер', principalMinor: 20_000, currency: 'TJS', openedOn: '2026-09-20' });
  await s.debts.close(closed.id);
  await s.debts.create({ direction: 'lent', counterparty: 'Бобур', principalMinor: 10_000, currency: 'TJS', openedOn: '2026-03-05', note: 'за телефон' });
};

describe('«Объединить»: какие долги отмечены заранее и предупреждение о другом имени', () => {
  it('открытый долг того же человека отмечен, закрытый — нет (но в списке есть), чужое имя не отмечено', async () => {
    await show(people);
    await openMerge();
    expect(box(/^АЛИШЕР от 03\.10\.2026/).checked).toBe(true);
    const closed = box(/^алишер от 20\.09\.2026/);
    expect(closed.checked).toBe(false);
    expect(text(row(/^алишер от 20\.09\.2026/))).toContain('закрыт');
    expect(box(/^Бобур от 05\.03\.2026/).checked).toBe(false);
    expect(button(/^Объединить: 2 долга$/)).toBeTruthy();
  });

  it('у долга с другим именем — «Другое имя: в списке останется «Алишер»…», у одноимённых — нет', async () => {
    await show(people);
    await openMerge();
    expect(text(row(/^Бобур от 05\.03\.2026/))).toContain('Другое имя: в списке останется «Алишер», своё имя долг сохранит внутри');
    expect(text(row(/^АЛИШЕР от 03\.10\.2026/))).not.toContain('Другое имя');
    expect(text(row(/^алишер от 20\.09\.2026/))).not.toContain('Другое имя');
    expect(text(row(/^АЛИШЕР от 03\.10\.2026/))).toContain('тот же человек');
  });

  it('отметили долг с другим именем — видно, какое имя не будет видно в списке; сняли отметку — предупреждение ушло', async () => {
    await show(people);
    await openMerge();
    expect(tid('merge-names')).toBeNull(); // отмечены только одноимённые
    await user.click(box(/^Бобур от 05\.03\.2026/));
    const status = tid('merge-names')!;
    expect(status.getAttribute('role')).toBe('status');
    expect(text(status)).toBe('Имя «Бобур»: в списке останется только «Алишер», а внутри объединённого долга это имя сохранится.');
    await user.click(box(/^Бобур от 05\.03\.2026/));
    expect(tid('merge-names')).toBeNull();
  });

  it('два других имени — «Имена «Бобур», «Вали»…» сохранятся внутри; два долга одного чужого имени — имя один раз', async () => {
    await show(async (s) => {
      await people(s, { cash: '' });
      await s.debts.create({ direction: 'lent', counterparty: 'Вали', principalMinor: 5_000, currency: 'TJS', openedOn: '2026-09-01' });
      await s.debts.create({ direction: 'lent', counterparty: 'Бобур', principalMinor: 7_000, currency: 'TJS', openedOn: '2026-04-10' });
    });
    await openMerge();
    await user.click(box(/^Бобур от 05\.03\.2026/));
    await user.click(box(/^Бобур от 10\.04\.2026/));
    expect(text(tid('merge-names'))).toMatch(/^Имя «Бобур»: в списке останется только «Алишер»/);
    await user.click(box(/^Вали от 01\.09\.2026/));
    // имена — в порядке списка, без повторов
    const order = Array.from(document.querySelectorAll('ul[aria-label="Долги для объединения"] input[type="checkbox"]'))
      .map((el) => (el.getAttribute('aria-label') ?? '').replace(/ от .*$/, ''))
      .filter((n) => n === 'Бобур' || n === 'Вали');
    const names = [...new Set(order)].map((n) => `«${n}»`).join(', ');
    expect(names.split(', ').sort()).toEqual(['«Бобур»', '«Вали»']);
    expect(text(tid('merge-names'))).toBe(`Имена ${names}: в списке останется только «Алишер», а внутри объединённого долга эти имена сохранятся.`);
  });
});

describe('«Объединить» с другим именем — только после подтверждения', () => {
  it('«Объединить» открывает «Объединить разных людей?» и до подтверждения ничего не меняется; «Отмена» возвращает к выбору', async () => {
    const td = await show(people);
    await openMerge();
    await user.click(box(/^Бобур от 05\.03\.2026/));
    const before = JSON.stringify(await storeOf(td).db.debts.toArray());
    await user.click(button(/^Объединить: 3 долга$/));
    const dlg = await findByRole('alertdialog', { name: CONFIRM });
    expect(text(dlg)).toContain('Долг «Бобур» войдёт в состав «Алишер»: в списке останется только это имя, а внутри объединённого долга имя сохранится. Сразу после объединения его можно отменить.');
    expect(JSON.stringify(await storeOf(td).db.debts.toArray())).toBe(before);

    await user.click(inAlert(CONFIRM, 'Отмена'));
    await gone('alertdialog', CONFIRM);
    expect(screen.getByRole('dialog', { name: 'Объединить долги' })).toBeTruthy(); // лист выбора остался открытым
    expect(box(/^Бобур от 05\.03\.2026/).checked).toBe(true); // выбор не сброшен
    expect(JSON.stringify(await storeOf(td).db.debts.toArray())).toBe(before);
    expect((await liveDebts(td)).map((d) => d.counterparty).sort()).toEqual(['Алишер', 'АЛИШЕР', 'Бобур', 'алишер'].sort());
  });

  it('два долга одного другого человека («Бобур» и « бобур »): имя названо один раз, но «Долги … войдут»', async () => {
    await show(async (s) => {
      await s.debts.create({ direction: 'lent', counterparty: 'Бобур', principalMinor: 10_000, currency: 'TJS', openedOn: '2026-03-05' });
      await s.debts.create({ direction: 'lent', counterparty: ' бобур ', principalMinor: 5_000, currency: 'TJS', openedOn: '2026-04-05' });
    });
    await openMerge();
    await user.click(box(/^Бобур от 05\.03\.2026/));
    await user.click(box(/бобур от 05\.04\.2026/));
    expect(text(tid('merge-names'))).toBe('Имя «Бобур»: в списке останется только «Алишер», а внутри объединённого долга это имя сохранится.');
    await user.click(button(/^Объединить: 3 долга$/));
    const dlg = await findByRole('alertdialog', { name: CONFIRM });
    expect(text(dlg)).toContain('Долги «Бобур» войдут в состав «Алишер»');
  });

  it('Escape закрывает только окно подтверждения: лист выбора остаётся, ничего не объединено', async () => {
    const td = await show(people);
    await openMerge();
    await user.click(box(/^Бобур от 05\.03\.2026/));
    await user.click(button(/^Объединить: 3 долга$/));
    await findByRole('alertdialog', { name: CONFIRM });
    await user.keyboard('{Escape}');
    await gone('alertdialog', CONFIRM);
    expect(screen.getByRole('dialog', { name: 'Объединить долги' })).toBeTruthy();
    expect((await liveDebts(td)).map((d) => d.counterparty)).toContain('Бобур');
  });

  it('подтвердили — долги объединены: «Бобур» входит в состав «Алишер», но остаётся при своём имени, суммах и заметке', async () => {
    const td = await show(people);
    await openMerge();
    await user.click(box(/^Бобур от 05\.03\.2026/));
    await user.click(button(/^Объединить: 3 долга$/));
    await findByRole('alertdialog', { name: CONFIRM });
    await user.click(inAlert(CONFIRM, 'Объединить'));
    await gone('alertdialog', CONFIRM);
    await gone('dialog', 'Объединить долги');
    expect(await waitFor(() => screen.getByText('Долги объединены: 3'))).toBeTruthy();
    const s = storeOf(td);
    // ничего не склеено: главный долг прежний, а Бобур остался со своим именем, суммой, датой и заметкой
    expect(await s.db.debts.get(DEBT_ID)).toMatchObject({ counterparty: 'Алишер', principalMinor: 50_000, openedOn: '2026-10-01', note: 'на ремонт', mergedIntoId: null });
    const bobur = (await liveDebts(td)).find((d) => d.counterparty === 'Бобур')!;
    expect(bobur).toMatchObject({ principalMinor: 10_000, openedOn: '2026-03-05', note: 'за телефон', mergedIntoId: DEBT_ID });
    // закрытый не выбирали: сам по себе
    expect((await liveDebts(td)).find((d) => d.counterparty === 'алишер')).toMatchObject({ mergedIntoId: null });
    expect((await liveDebts(td)).map((d) => d.counterparty).sort()).toEqual(['Алишер', 'АЛИШЕР', 'Бобур', 'алишер'].sort());
    // страница стала страницей объединённого долга: итог и три составляющих
    expect(await waitFor(() => screen.getByRole('heading', { name: /Из чего состоит · 3/ }))).toBeTruthy();
  });

  it('только тот же человек — объединяется сразу, без окна подтверждения', async () => {
    const td = await show(people);
    await openMerge();
    expect(tid('merge-names')).toBeNull();
    await user.click(button(/^Объединить: 2 долга$/));
    await gone('dialog', 'Объединить долги'); // одного нажатия хватило: окна подтверждения не было
    expect(screen.queryByRole('alertdialog', { name: CONFIRM })).toBeNull();
    expect(await storeOf(td).db.debts.get(DEBT_ID)).toMatchObject({ principalMinor: 50_000, note: 'на ремонт', mergedIntoId: null });
    const live = await liveDebts(td);
    expect(live.map((d) => d.counterparty).sort()).toEqual(['Алишер', 'АЛИШЕР', 'Бобур', 'алишер'].sort());
    expect(live.find((d) => d.counterparty === 'АЛИШЕР')).toMatchObject({ principalMinor: 30_000, mergedIntoId: DEBT_ID });
  });

  it('закрытый одноимённый можно отметить вручную — подтверждение не нужно (имя то же)', async () => {
    const td = await show(people);
    await openMerge();
    await user.click(box(/^алишер от 20\.09\.2026/));
    expect(tid('merge-names')).toBeNull();
    await user.click(button(/^Объединить: 3 долга$/));
    await gone('dialog', 'Объединить долги');
    expect(screen.queryByRole('alertdialog', { name: CONFIRM })).toBeNull();
    expect((await storeOf(td).db.debts.get(DEBT_ID))!).toMatchObject({ principalMinor: 50_000, note: 'на ремонт', closedAt: null });
    const closedOne = (await liveDebts(td)).find((d) => d.counterparty === 'алишер')!;
    expect(closedOne).toMatchObject({ principalMinor: 20_000, mergedIntoId: DEBT_ID });
    expect(closedOne.closedAt).not.toBeNull(); // закрытый остаётся закрытым внутри объединения
  });
});
