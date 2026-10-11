/** Большой выдуманный файл для проверки скорости и пределов. Данные случайные (но повторяемые), настоящих тут нет. */

const HEADER =
  'date,categoryName,payee,comment,outcomeAccountName,outcome,outcomeCurrencyShortTitle,incomeAccountName,income,incomeCurrencyShortTitle,createdDate,changedDate,qrCode';

const EXPENSE_CATEGORIES = ['Продукты', 'Транспорт', 'Еда / Кафе', 'Связь', 'Покупки', 'Здоровье'];
const INCOME_CATEGORIES = ['Зарплата', 'Подработка', 'Подарки'];

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** n строк: ~80% расходы, ~10% доходы, ~10% переводы (часть с комиссией). Все суммы в сомони (TJS). */
export function makeBigCsv(n: number, seed = 7): string {
  const rnd = lcg(seed);
  const lines: string[] = [HEADER];
  for (let i = 0; i < n; i++) {
    const year = 2020 + Math.floor(rnd() * 7);
    const month = 1 + Math.floor(rnd() * 12);
    const day = 1 + Math.floor(rnd() * 28);
    const date = `${year}-${p2(month)}-${p2(day)}`;
    const cents = 100 + Math.floor(rnd() * 500_000);
    const amount = `${Math.floor(cents / 100)}.${p2(cents % 100)}`;
    const kind = rnd();
    const cat = (list: string[]) => list[Math.floor(rnd() * list.length)]!;
    if (kind < 0.8) {
      lines.push(`${date},${cat(EXPENSE_CATEGORIES)},Магазин ${i % 50},покупка ${i},Карта,${amount},TJS,,0,,,,`);
    } else if (kind < 0.9) {
      lines.push(`${date},${cat(INCOME_CATEGORIES)},Заказчик ${i % 20},доход ${i},,0,,Карта,${amount},TJS,,,`);
    } else {
      const fee = cents > 300 && rnd() < 0.5 ? 150 : 0;
      const got = `${Math.floor((cents - fee) / 100)}.${p2((cents - fee) % 100)}`;
      lines.push(`${date},,,перевод ${i},Карта,${amount},TJS,Копилка,${got},TJS,,,`);
    }
  }
  return lines.join('\n') + '\n';
}
