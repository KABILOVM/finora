import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually } from '@/app/testkit';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import type { Store } from '@/db';
import { allTxs, clickSave, openAddSheet, opsDeps, pinToday, showApp, tapAmount, unpinToday } from './__fixtures__/opsKit';
import EditTransactionSheet from './EditTransactionSheet';

beforeEach(pinToday); // сегодня — 15.10.2026
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
});

/** Операции с метками в заметках: «Самарканд» ×3 (две операции с «#самарканд» другим регистром), «работа» ×1. Без совпадающих «похожих» заметок у слова «ужин». */
async function seedTags(s: Store): Promise<void> {
  const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
  const food = (await s.db.categories.toArray()).find((c) => c.name === 'Еда' && c.kind === 'expense')!.id;
  const add = (note: string) => s.transactions.create({ kind: 'expense', walletId: cash, categoryId: food, amountMinor: 1000, note, occurredOn: '2026-10-10' });
  await add('гостиница #Самарканд');
  await add('такси #самарканд');
  await add('обед #Самарканд');
  await add('проездной #работа');
}

const tagged = () => opsDeps([], { setup: seedTags });
const openNote = () => user.click(screen.getByRole('button', { name: 'Заметка' }));
const noteField = () => screen.getByRole('textbox', { name: /^Заметка/ }) as HTMLInputElement;
const strip = () => screen.queryByRole('group', { name: 'Метки' });
const chips = () => Array.from(strip()?.querySelectorAll('button') ?? []);
const chipLabels = () => chips().map((b) => (b.textContent ?? '').trim());
const chip = (label: string) => chips().find((b) => (b.textContent ?? '').trim() === label) as HTMLElement;

/** Ждёт, пока метки прочитаются из базы и полоса появится. */
const stripShown = () => waitFor(() => expect(strip()).not.toBeNull());

describe('метки в панели заметки: новая операция', () => {
  it('меток в заметках нет — полосы нет, остаётся «Готово»', async () => {
    await openAddSheet(opsDeps([]));
    await openNote();
    await new Promise((r) => setTimeout(r, 50));
    expect(strip()).toBeNull();
    expect(screen.getByRole('button', { name: 'Готово' })).toBeInTheDocument();
  });

  it('есть метки — чипы вместо «Готово»: чаще встречающиеся первыми, ни один не нажат', async () => {
    await openAddSheet(tagged());
    await openNote();
    await stripShown();
    expect(chipLabels()).toEqual(['#Самарканд', '#работа']);
    expect(chips().map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false']);
    expect(screen.queryByRole('button', { name: 'Готово' })).toBeNull(); // чипы заняли его место
  });

  it('нажатие добавляет метку в заметку, повторное — убирает; можно отметить несколько; панель остаётся открытой', async () => {
    await openAddSheet(tagged());
    await openNote();
    await stripShown();

    await user.click(chip('#Самарканд'));
    expect(noteField().value).toBe('#Самарканд');
    // заметка «#Самарканд» совпадает с прошлыми («гостиница #Самарканд»), но «Похожие записи» чипы не вытесняют: метки главнее
    expect(screen.queryByRole('group', { name: 'Похожие записи' })).toBeNull();
    expect(chip('#Самарканд').getAttribute('aria-pressed')).toBe('true');

    await user.click(chip('#работа'));
    expect(noteField().value).toBe('#Самарканд #работа');

    await user.click(chip('#Самарканд'));
    expect(noteField().value).toBe('#работа');
    expect(chip('#Самарканд').getAttribute('aria-pressed')).toBe('false');
    expect(strip()).not.toBeNull(); // панель не закрылась
  });

  it('метка дописывается к тексту заметки', async () => {
    await openAddSheet(tagged());
    await openNote();
    await stripShown();
    await user.type(noteField(), 'ужин');
    await user.click(chip('#работа'));
    expect(noteField().value).toBe('ужин #работа');
  });

  it('набрали «#са» — остаются подсказки на это начало; нажатие дописывает метку, дальше чипы снова переключатели', async () => {
    await openAddSheet(tagged());
    await openNote();
    await stripShown();
    await user.type(noteField(), 'ужин #са');
    await waitFor(() => expect(chipLabels()).toEqual(['#Самарканд']));
    expect(chips()[0]!.getAttribute('aria-pressed')).toBeNull(); // это подсказка, а не переключатель

    await user.click(chip('#Самарканд'));
    expect(noteField().value).toBe('ужин #Самарканд');
    await waitFor(() => expect(chipLabels()).toEqual(['#Самарканд', '#работа']));
    expect(chip('#Самарканд').getAttribute('aria-pressed')).toBe('true');
  });

  it('«Похожие записи» и метки: набираем слово — подсказки по тексту; ставим «#» — вместо них метки; после метки можно отметить вторую', async () => {
    await openAddSheet(opsDeps([], { setup: async (s) => {
      await seedTags(s);
      const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
      await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 2000, note: 'Кофе с собой', occurredOn: '2026-10-09' });
    } }));
    await openNote();
    await stripShown();
    const similar = () => screen.queryByRole('group', { name: 'Похожие записи' });

    await user.type(noteField(), 'ко');
    await waitFor(() => expect(similar()).not.toBeNull()); // «Кофе с собой» — подсказка по тексту
    expect(strip()).toBeNull();

    await user.type(noteField(), 'фе #');
    await waitFor(() => expect(strip()).not.toBeNull()); // в конце «#» — метки главнее
    expect(similar()).toBeNull();

    await user.type(noteField(), 'са');
    await waitFor(() => expect(chipLabels()).toEqual(['#Самарканд']));
    await user.click(chip('#Самарканд'));
    // чипы остались: можно отметить вторую метку
    expect(noteField().value).toBe('кофе #Самарканд');
    expect(strip()).not.toBeNull();
    await user.click(chip('#работа'));
    expect(noteField().value).toBe('кофе #Самарканд #работа');
  });

  it('набрано «#», начала нет ни у одной метки — полосы нет, «Готово» на месте', async () => {
    await openAddSheet(tagged());
    await openNote();
    await stripShown();
    await user.type(noteField(), 'ужин #яя');
    await waitFor(() => expect(strip()).toBeNull());
    expect(screen.getByRole('button', { name: 'Готово' })).toBeInTheDocument();
  });

  it('операция сохраняется с выбранной меткой в заметке', async () => {
    const { td } = await openAddSheet(tagged());
    await openNote();
    await stripShown();
    await user.click(chip('#работа'));
    await tapAmount('45');
    await clickSave();
    await eventually(async () => {
      const mine = (await allTxs(td)).filter((t) => t.amountMinor === 4500);
      expect(mine).toHaveLength(1);
      expect(mine[0]?.note).toBe('#работа');
    });
  });
});

describe('метки в панели заметки: правка операции', () => {
  async function openEdit(note: string) {
    let id = '';
    const td = opsDeps([], {
      setup: async (s) => {
        await seedTags(s);
        const cash = (await s.db.wallets.toArray()).find((w) => w.name === 'Наличные')!.id;
        id = (await s.transactions.create({ kind: 'expense', walletId: cash, amountMinor: 2500, note, occurredOn: '2026-10-12' })).id;
      },
    });
    function Edit() {
      return <EditTransactionSheet id={id} onClose={vi.fn()} />;
    }
    await showApp(<Edit />, td, '/edit/x');
    await findByRole('dialog', { name: 'Правка операции' });
    return { td, id: () => id };
  }

  it('в правке те же чипы; метка, что уже в заметке, нажата; снимается и добавляется, операция сохраняется', async () => {
    const { td, id } = await openEdit('кофе #работа');
    await openNote();
    await stripShown();
    expect(chip('#работа').getAttribute('aria-pressed')).toBe('true');
    expect(chip('#Самарканд').getAttribute('aria-pressed')).toBe('false');

    await user.click(chip('#работа')); // убрали
    await user.click(chip('#Самарканд')); // добавили
    expect(noteField().value).toBe('кофе #Самарканд');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await eventually(async () => expect((await allTxs(td)).find((t) => t.id === id())?.note).toBe('кофе #Самарканд'));
  });
});
