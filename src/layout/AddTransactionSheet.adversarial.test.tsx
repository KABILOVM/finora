import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventually } from '@/app/testkit';
import { screen, user, waitFor } from '@/components/testUtils';
import { createRateService } from '@/rates/service';
import { createMemoryRateStorage } from '@/rates/storage';
import {
  clickSave,
  liveTxs,
  openAddSheet,
  opsDeps,
  pickDate,
  pickWallet,
  storeOf,
  table,
  tapAmount,
  withUsd,
} from '@/features/transactions/__fixtures__/opsKit';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  try {
    localStorage.clear();
  } catch {
    /* нет хранилища — ничего не очищаем */
  }
});

describe('шит «Новая операция»: полночь', () => {
  it('человек выбрал «Вчера» в 23:59 и сохранил в 00:01 — операция должна лечь на ту дату, что он видел', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 9, 10, 23, 59, 30)); // 10 октября, 23:59:30
    const td = opsDeps([table()]);
    const { onClose } = await openAddSheet(td);
    await pickDate('Вчера'); // на экране «Вчера» = 9 октября
    await tapAmount('5');
    vi.setSystemTime(new Date(2026, 9, 11, 0, 1, 0)); // уже 11 октября
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await liveTxs(td))[0]?.occurredOn).toBe('2026-10-09');
  });
});

describe('шит «Новая операция»: ручной курс из одной операции', () => {
  it('курс, набранный для одной операции, не должен навсегда перекрывать свежий курс Нацбанка', async () => {
    // курсов нет совсем — человек набирает курс руками (с опечаткой: 109 вместо 10,9)
    const storage = createMemoryRateStorage();
    const now = () => new Date('2026-10-10T12:00:00.000Z');
    const appRates = createRateService({ providers: [], storage, now });
    const td = opsDeps([], { setup: withUsd });
    td.deps.createRates = () => appRates;
    const first = await openAddSheet(td);
    await pickWallet('Доллары · USD');
    await tapAmount('1');
    await user.type(screen.getByRole('textbox', { name: /^Курс/ }), '109');
    await clickSave();
    await waitFor(() => expect(first.onClose).toHaveBeenCalled());
    expect((await liveTxs(td))[0]).toMatchObject({ fxRate: 109, fxSource: 'manual' });

    // потом появился интернет и Нацбанк отдал нормальный курс (тот же сервис, то же хранилище)
    const nbt = { id: 'nbt', fetchLatest: async () => ({ ...table(), source: 'nbt' }) };
    const online = createRateService({ providers: [nbt], storage, now });
    expect((await online.refresh()).ok).toBe(true);
    // свежий курс Нацбанка 10,9 должен победить разовый ручной курс 109 (или человека обязаны спросить)
    expect(online.getRate('USD', 'TJS')?.rate).toBe(10.9);
  });
});

describe('шит «Новая операция»: двойное нажатие', () => {
  it('«Сохранить», «Сохранить и добавить ещё» и снова «Сохранить» в один момент создают одну операцию', async () => {
    const td = opsDeps([table()]);
    await openAddSheet(td);
    await tapAmount('7');
    const a = screen.getByRole('button', { name: 'Сохранить' });
    const b = screen.getByRole('button', { name: 'Сохранить и добавить ещё' });
    await Promise.all([user.click(a), user.click(b), user.click(a)]);
    await eventually(async () => {
      expect((await storeOf(td).db.transactions.count())).toBeGreaterThan(0);
    });
    await new Promise((r) => setTimeout(r, 300));
    expect((await liveTxs(td)).length).toBe(1);
  });
});

describe('шит «Новая операция»: мусор в заметке', () => {
  async function typeNote(text: string) {
    const note = screen.getByRole('textbox', { name: /^Заметка/ }) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(note, text);
    const { fire } = await import('@/components/testUtils');
    fire(note, new Event('input', { bubbles: true }));
  }

  it('нулевой символ в заметке (вставка) — понятная ошибка у заметки, операция не создаётся, шит не падает', async () => {
    const td = opsDeps([table()]);
    const { onClose } = await openAddSheet(td);
    await tapAmount('4');
    await typeNote('хлеб\u0000молоко');
    await clickSave();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expect((await liveTxs(td)).length).toBe(0);
  });

  it('заметка из одних пробелов и переводов строк сохраняется пустой, а не мусором', async () => {
    const td = opsDeps([table()]);
    const { onClose } = await openAddSheet(td);
    await tapAmount('4');
    await typeNote('      ');
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await liveTxs(td))[0]?.note).toBe('');
  });

  it('заметка ровно 500 символов сохраняется, 501 — нет, и текст ошибки называет число', async () => {
    const td = opsDeps([table()]);
    const { onClose } = await openAddSheet(td);
    await tapAmount('4');
    await typeNote('я'.repeat(501));
    await clickSave();
    await waitFor(() => expect(screen.getByText(/не длиннее 500/)).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    await typeNote('я'.repeat(500));
    await clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await liveTxs(td))[0]?.note.length).toBe(500);
  });
});
