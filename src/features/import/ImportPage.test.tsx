import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventually, makeTestDeps, renderAppRoot, type TestDeps } from '@/app/testkit';
import { fire, findByRole, render, screen, user, waitFor } from '@/components/testUtils';
import { fixtureText } from '@/import/__fixtures__/load';
import type { ImportReport } from '@/import/runImport';
import { createRateService } from '@/rates/service';
import { createMemoryRateStorage } from '@/rates/storage';
import { DoneStep } from './DoneStep';
import ImportPage from './ImportPage';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: vi.fn() }),
}));

beforeEach(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('Сеть в тестах запрещена')));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openImport(strict = false) {
  const td = makeTestDeps();
  renderAppRoot(<ImportPage />, { deps: td.deps, path: '/import', strict });
  await findByRole('heading', { name: 'Импорт из Zenmoney', level: 1 });
  await findByRole('button', { name: 'Выбрать файл' });
  return td;
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('Нет поля выбора файла');
  return input;
}

function chooseFile(text: string, name = 'zen.csv') {
  const input = fileInput();
  const file = new File([text], name, { type: 'text/csv' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fire(input, new Event('change', { bubbles: true }));
}

const text = (id: string) => document.querySelector(`[data-testid="${id}"]`)?.textContent;
// в StrictMode хранилище открывается дважды (первое закрывается): нужно последнее
const store = (td: TestDeps) => td.stores[td.stores.length - 1]!;

describe('Импорт из Zenmoney: экран', () => {
  it('первый шаг: как выгрузить, оговорка про формат, приватность, ссылка на копию', async () => {
    await openImport();
    expect(screen.getByText('Как выгрузить из Zenmoney')).toBeTruthy();
    expect(screen.getByText(/Выгрузите операции в CSV на сайте или в приложении Zenmoney/)).toBeTruthy();
    expect(screen.getByText(/Формат мы проверяли на образце/)).toBeTruthy();
    expect(screen.getByText(/никуда не отправляется/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Настройки → Резервная копия' }).getAttribute('href')).toBe('/settings');
    expect(fileInput().getAttribute('aria-label')).toBe('Файл Zenmoney');
    expect(fileInput().getAttribute('accept')).toContain('.csv');
  });

  it('чужой файл: отказ словами, экран остаётся на первом шаге', async () => {
    await openImport();
    chooseFile(fixtureText('not-zenmoney.csv'));
    const alert = await findByRole('alert');
    expect(alert.textContent).toContain('Не похоже на файл Zenmoney. Нашли столбцы: Имя, Телефон, Почта');
    expect(screen.queryByRole('region', { name: 'Итоги разбора файла' })).toBeNull();
  });

  it('предпросмотр → курс → подтверждение → итог; повторная загрузка ничего не добавляет (StrictMode)', async () => {
    const td = await openImport(true);
    chooseFile(fixtureText('basic.csv'), 'basic.csv');
    await findByRole('region', { name: 'Итоги разбора файла' });
    expect(text('count-add')).toBe('8');
    expect(text('count-review')).toBe('4');
    expect(text('count-skipped')).toBe('2');

    // без курса доллара его операции не добавятся: поле пустое и просит ввод
    const rate = screen.getByRole('textbox', { name: /^Курс для пересчёта в TJS \(USD\)/ });
    expect((rate as HTMLInputElement).value).toBe('');
    expect(screen.getByText('Укажите курс — без него 2 операции в USD не добавятся')).toBeTruthy();
    await user.type(rate, '10,9');
    await waitFor(() => expect(text('count-add')).toBe('10'));

    await user.click(screen.getByRole('button', { name: 'Импортировать 10 операций' }));
    const dlg = await findByRole('alertdialog');
    expect(dlg.textContent).toContain('Будет добавлено: 10 операций. Новых кошельков: 2, новых категорий: 1.');
    await user.click(screen.getByRole('button', { name: 'Импортировать' }));

    await findByRole('heading', { name: 'Импорт завершён', level: 2 });
    expect(text('report-added')).toBe('10');
    expect(text('report-failed')).toBe('0');
    expect(screen.getByRole('list', { name: 'Остатки по файлу' }).textContent).toMatch(/Карта Алиф.*3\s114,50\sс\./);
    await eventually(async () => {
      expect(await store(td).db.transactions.filter((t) => t.deletedAt === null).count()).toBe(10);
    });

    // «Загрузить ещё файл» → тот же файл: все операции уже есть
    await user.click(screen.getByRole('button', { name: 'Загрузить ещё файл' }));
    await findByRole('button', { name: 'Выбрать файл' });
    chooseFile(fixtureText('basic.csv'), 'basic.csv');
    await findByRole('region', { name: 'Итоги разбора файла' });
    expect(text('count-add')).toBe('0');
    expect(text('count-exists')).toBe('10');
    expect((screen.getByRole('button', { name: 'Нечего импортировать' }) as HTMLButtonElement).disabled).toBe(true);
    expect(await store(td).db.transactions.count()).toBe(10);
    expect((await store(td).db.wallets.toArray()).filter((w) => w.name === 'Карта Алиф')).toHaveLength(1);
  });

  it('ручной выбор кошелька меняет план сразу', async () => {
    await openImport();
    chooseFile(fixtureText('semicolon-ru.csv'));
    await findByRole('region', { name: 'Итоги разбора файла' });
    expect(text('count-add')).toBe('4');
    const select = screen.getByRole('combobox', { name: 'Кошелёк для счёта «Карта Алиф»' }) as HTMLSelectElement;
    const cash = Array.from(select.options).find((o) => o.textContent === 'Наличные');
    expect(cash).toBeDefined();
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, cash!.value);
    fire(select, new Event('change', { bubbles: true }));
    await waitFor(() => expect(text('count-add')).toBe('3'));
    expect(text('count-review')).toBe('1');
    expect(screen.getByText(/сопоставлены с одним кошельком/)).toBeTruthy();
  });
});

describe('Импорт из Zenmoney: курс по умолчанию', () => {
  it('текущий курс из сервиса курсов подставляется в поле, и операции в валюте сразу готовы к добавлению', async () => {
    const td = makeTestDeps();
    const service = createRateService({ providers: [], storage: createMemoryRateStorage() });
    service.setManualRate('USD', 'TJS', 10.9);
    td.deps.createRates = () => service;
    renderAppRoot(<ImportPage />, { deps: td.deps, path: '/import' });
    await findByRole('button', { name: 'Выбрать файл' });
    chooseFile(fixtureText('basic.csv'), 'basic.csv');
    await findByRole('region', { name: 'Итоги разбора файла' });
    const rate = screen.getByRole('textbox', { name: /^Курс для пересчёта в TJS \(USD\)/ }) as HTMLInputElement;
    expect(rate.value).toBe('10,9');
    await waitFor(() => expect(text('count-add')).toBe('10'));
    // человек может поменять курс — план пересчитывается
    await user.clear(rate);
    await waitFor(() => expect(text('count-add')).toBe('8'));
    await user.type(rate, 'abc');
    expect(screen.getByText('Курс — число больше нуля, например 10,9')).toBeTruthy();
    expect(text('count-add')).toBe('8');
  });
});

describe('Итог импорта: ошибки записи', () => {
  const report = (failedCount: number): ImportReport => ({
    stopped: false,
    fatal: null,
    total: 100,
    added: 100 - failedCount,
    failedCount,
    failed: Array.from({ length: Math.min(failedCount, 200) }, (_, i) => ({ line: i + 2, label: `2025-01-01 · ${i + 1} с.`, reason: `причина ${i + 1}` })),
    alreadyThere: 0,
    review: 0,
    skipped: 0,
    waitRate: 0,
    blocked: 0,
    createdWallets: 0,
    createdCategories: 0,
    reconcile: [],
    elapsedMs: 1,
  });

  it('показывает первые 20 ошибок и «и ещё N»', () => {
    render(
      <MemoryRouter>
        <DoneStep report={report(25)} onAgain={() => undefined} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Не импортировано: 25', level: 2 })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Строки, которые не удалось записать' }).querySelectorAll('li')).toHaveLength(20);
    expect(screen.getByText('и ещё 5 строк')).toBeTruthy();
    expect(screen.getByText('причина 20')).toBeTruthy();
    expect(screen.queryByText('причина 21')).toBeNull();
    expect(text('report-failed')).toBe('25');
  });

  it('без ошибок раздела нет; остановка и сбой названы своими словами', () => {
    const { rerender } = render(
      <MemoryRouter>
        <DoneStep report={report(0)} onAgain={() => undefined} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('heading', { name: /Не импортировано/, level: 2 })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Импорт завершён', level: 2 })).toBeTruthy();
    rerender(
      <MemoryRouter>
        <DoneStep report={{ ...report(0), stopped: true, added: 40 }} onAgain={() => undefined} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Импорт остановлен', level: 2 })).toBeTruthy();
    expect(screen.getByText(/Добавлено 40 из 100/)).toBeTruthy();
    rerender(
      <MemoryRouter>
        <DoneStep report={{ ...report(0), stopped: true, fatal: 'Нет места' }} onAgain={() => undefined} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Импорт прерван', level: 2 })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Нет места');
  });
});
