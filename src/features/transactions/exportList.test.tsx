import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByRole, screen, user, waitFor } from '@/components/testUtils';
import { readFileText } from '@/features/settings/download';
import { opsDeps, pinToday, seedHistory, showApp, unpinToday, table } from './__fixtures__/opsKit';
import TransactionsPage from './TransactionsPage';

let blobs: Blob[];
let downloads: { name: string; href: string }[];

beforeEach(() => {
  pinToday(); // сегодня — 15.10.2026
  blobs = [];
  downloads = [];
  URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
    blobs.push(b as Blob);
    return `blob:test-${blobs.length}`;
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, href: this.href });
  });
});
afterEach(() => {
  unpinToday();
  vi.restoreAllMocks();
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
});

async function openList(path = '/transactions', empty = false) {
  const td = opsDeps([table()], {
    setup: async (s) => {
      if (!empty) await seedHistory(s);
    },
  });
  await showApp(<TransactionsPage />, td, path);
  await findByRole('heading', { name: 'Операции', level: 1 });
  await waitFor(() => expect(screen.queryByText('Загрузка…')).toBeNull());
  return td;
}

const exportButton = () => screen.queryByRole('button', { name: 'Выгрузить список в CSV' });

/** Строки данных файла (без заголовка и пустой строки в конце). */
async function csvLines(): Promise<string[]> {
  await waitFor(() => expect(downloads).toHaveLength(1));
  // BOM в начале файла проверяют тесты базы; при чтении Blob декодер его срезает, поэтому здесь просто отбрасываем заголовок
  const text = await readFileText(blobs[0] as Blob);
  return text.split('\r\n').slice(1).filter(Boolean);
}

describe('выгрузка списка операций в CSV', () => {
  it('по умолчанию (этот месяц) в файл идёт ровно то, что в списке: 5 операций октября, по возрастанию даты', async () => {
    await openList();
    await user.click(await waitFor(() => screen.getByRole('button', { name: 'Выгрузить список в CSV' })));
    const lines = await csvLines();
    expect(downloads[0]!.name).toBe('sumoima-operations-2026-10-15.csv');
    expect(lines).toHaveLength(5);
    const dates = lines.map((l) => l.slice(0, 10));
    expect(dates).toEqual([...dates].sort());
    expect(lines.some((l) => l.includes('обед'))).toBe(true);
    expect(lines.some((l) => l.includes('рынок'))).toBe(false); // сентябрь в список не входит
    // тост с числом выгруженных
    await waitFor(() => expect(screen.getByText('Выгружено 5 операций')).toBeTruthy());
  });

  it('с фильтром «Доходы» и «Весь срок»: только доходы за всё время — и августовские, и октябрьские', async () => {
    await openList('/transactions?period=all&kind=income');
    await user.click(await waitFor(() => screen.getByRole('button', { name: 'Выгрузить список в CSV' })));
    const lines = await csvLines();
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.split(';')[1] === 'Доход')).toBe(true);
    expect(lines.some((l) => l.includes('аванс'))).toBe(true);
    expect(lines.some((l) => l.includes('Работа'))).toBe(true);
  });

  it('«Весь срок» без фильтров: все 8 операций, в том числе старые, не только первая страница', async () => {
    await openList('/transactions?period=all');
    await user.click(await waitFor(() => screen.getByRole('button', { name: 'Выгрузить список в CSV' })));
    expect(await csvLines()).toHaveLength(8);
  });

  it('с поиском: выгружаются только найденные операции (поиск идёт по заметке, категории, кошельку и сумме)', async () => {
    await openList();
    await user.type(await waitFor(() => screen.getByRole('textbox', { name: 'Поиск по операциям' })), 'такси');
    await waitFor(() => expect(document.querySelectorAll('section[aria-label] button')).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Выгрузить список в CSV' }));
    const lines = await csvLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('такси');
    await waitFor(() => expect(screen.getByText('Выгружено 1 операция')).toBeTruthy());
  });

  it('кнопки нет, когда в списке ничего нет: нет операций совсем или фильтр ничего не нашёл', async () => {
    await openList('/transactions', true);
    expect(exportButton()).toBeNull();
    document.body.innerHTML = '';
  });

  it('фильтр ничего не нашёл — кнопки нет', async () => {
    // доходов в октябре два, а переводов за всё время один; но «расход по кошельку, которого нет» — пусто
    await openList('/transactions?period=all&kind=transfer&category=none');
    await waitFor(() => expect(screen.getByText('Ничего не найдено')).toBeTruthy());
    expect(exportButton()).toBeNull();
  });
});
