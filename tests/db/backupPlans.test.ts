import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { defaultId, exportBackup, importBackup, uuidV5, ValidationError, type BackupFile, type Store } from '@/db';
import { withoutSettings } from '@/features/settings/backupAccount';
import { basics, makeStore, USER_A, USER_B } from './helpers';

/** Резервная копия версии 2: бюджеты, долги, регулярные платежи; чтение версии 1; строгая проверка; перекодирование чужой копии. */

const fresh = (userId = USER_A) => makeStore({ factory: new IDBFactory(), userId });
const clone = (f: BackupFile): Record<string, any> => JSON.parse(JSON.stringify(f));
const noTime = (f: BackupFile) => ({ ...f, exportedAt: '' });
const NOPE = '99999999-9999-4999-8999-999999999999';

/** Источник: бюджет (общий и на категорию), два долга, правило с долгом, платёж по долгу, операция по правилу, пропуск, перевод с комиссией. */
async function populated(store: Store) {
  const b = await basics(store);
  const card = await store.wallets.create({ name: 'Карта', currency: 'TJS', kind: 'card', openingBalanceMinor: 0, color: '#000000', icon: 'x' });
  const total = await store.budgets.create({ amountMinor: 900_000 });
  const food = await store.budgets.create({ categoryId: b.food.id, amountMinor: 300_000 });
  const lent = await store.debts.create({ direction: 'lent', counterparty: 'Али', principalMinor: 50_000, currency: 'TJS', openedOn: '2026-10-01', dueOn: '2026-12-01', note: 'на ремонт' });
  const borrowed = await store.debts.create({ direction: 'borrowed', counterparty: 'Банк', principalMinor: 90_000, currency: 'TJS', openedOn: '2026-09-01' });
  await store.debts.close(borrowed.id);
  const issue = await store.transactions.create({ kind: 'expense', walletId: b.cash.id, amountMinor: 50_000, occurredOn: '2026-10-01', debtId: lent.id });
  const pay = await store.transactions.create({ kind: 'income', walletId: b.cash.id, amountMinor: 10_000, occurredOn: '2026-10-20', debtId: lent.id });
  const rule = await store.recurring.create({ kind: 'expense', walletId: b.cash.id, amountMinor: 30_000, frequency: 'monthly', startOn: '2026-10-15', debtId: borrowed.id, note: 'Платёж банку', autoPost: 1 });
  const done = await store.transactions.createFromRule(rule, '2026-10-15');
  const skipped = await store.transactions.skipOccurrence(rule, '2026-11-15');
  const fee = await store.transactions.create({ kind: 'transfer', walletId: b.cash.id, toWalletId: card.id, amountMinor: 10_000, toAmountMinor: 9_800, occurredOn: '2026-10-02' });
  return { ...b, card, total, food: b.food, foodBudget: food, lent, borrowed, issue, pay, rule, done, skipped, fee };
}

describe('экспорт версии 2', () => {
  it('содержит бюджеты, долги и регулярные платежи; у операций есть debtId и recurringRuleId; служебных полей нет', async () => {
    const store = await fresh();
    const k = await populated(store);
    const file = await exportBackup(store);
    expect(file).toMatchObject({ format: 'finora-backup', version: 2 });
    expect(file.budgets.map((b) => b.id).sort()).toEqual([k.total.id, k.foodBudget.id].sort());
    expect(file.debts).toHaveLength(2);
    expect(file.recurringRules).toHaveLength(1);
    expect(file.recurringRules[0]).toMatchObject({ debtId: k.borrowed.id, autoPost: 1 });
    expect(file.transactions.find((t) => t.id === k.issue.id)).toMatchObject({ debtId: k.lent.id, recurringRuleId: null });
    expect(file.transactions.find((t) => t.id === k.done.id)).toMatchObject({ debtId: k.borrowed.id, recurringRuleId: k.rule.id });
    expect(file.transactions.find((t) => t.id === k.skipped.id)?.deletedAt).not.toBeNull(); // пропуск едет в копии: иначе платёж «воскреснет»
    expect(file.transactions.find((t) => t.id === k.fee.id)?.baseAmountMinor).toBe(200);
    for (const row of [...file.budgets, ...file.debts, ...file.recurringRules]) {
      expect(row).not.toHaveProperty('dirty');
      expect(row).not.toHaveProperty('serverSeq');
      expect(row).not.toHaveProperty('syncError');
      expect(row).not.toHaveProperty('dirtyGroups');
    }
  });
});

describe('круг «экспорт → импорт» (своя копия)', () => {
  it('в чистую базу того же аккаунта: всё переносится бит в бит; повторный импорт ничего не меняет', async () => {
    const src = await fresh();
    await populated(src);
    const file = JSON.parse(JSON.stringify(await exportBackup(src)));
    const dst = await fresh();
    const first = await importBackup(dst, file);
    expect(first.added).toBeGreaterThan(0);
    expect(first.replaced + first.keptLocal).toBe(0);
    expect(noTime(await exportBackup(dst))).toEqual(noTime(file));
    expect(await importBackup(dst, file)).toMatchObject({ added: 0, replaced: 0 });
    // импортированное помечено «ждёт отправки»
    for (const t of ['budgets', 'debts', 'recurring_rules'] as const) {
      const rows = await dst.db.syncTable(t).toArray();
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(r).toMatchObject({ dirty: 1, serverSeq: null, syncError: null });
    }
  });

  it('более новая локальная версия не затирается файлом (как у остальных таблиц)', async () => {
    const src = await fresh();
    const k = await populated(src);
    const old = JSON.parse(JSON.stringify(await exportBackup(src)));
    await src.budgets.update(k.total.id, { amountMinor: 1 });
    await src.debts.update(k.lent.id, { principalMinor: 2 });
    await src.recurring.update(k.rule.id, { amountMinor: 3 });
    const r = await importBackup(src, old);
    expect(r.replaced).toBe(0);
    expect((await src.db.budgets.get(k.total.id))?.amountMinor).toBe(1);
    expect((await src.db.debts.get(k.lent.id))?.principalMinor).toBe(2);
    expect((await src.db.recurring_rules.get(k.rule.id))?.amountMinor).toBe(3);
  });

  it('новая версия записи из файла заменяет старую локальную', async () => {
    const src = await fresh();
    const k = await populated(src);
    const dst = await fresh();
    await importBackup(dst, JSON.parse(JSON.stringify(await exportBackup(src))));
    await src.debts.update(k.lent.id, { note: 'новое' });
    const r = await importBackup(dst, JSON.parse(JSON.stringify(await exportBackup(src))));
    expect(r.replaced).toBe(1);
    expect((await dst.db.debts.get(k.lent.id))?.note).toBe('новое');
  });
});

describe('копия версии 1', () => {
  it('читается: новые списки пусты, у операций debtId и recurringRuleId = null', async () => {
    const src = await fresh();
    const b = await basics(src);
    await src.transactions.create({ kind: 'expense', walletId: b.cash.id, amountMinor: 500, categoryId: b.food.id, occurredOn: '2026-10-05' });
    const v2 = clone(await exportBackup(src));
    // в точности то, что писала версия 1: без новых списков и без новых полей операций
    const v1: Record<string, any> = { ...v2, version: 1 };
    delete v1['budgets'];
    delete v1['debts'];
    delete v1['recurringRules'];
    for (const t of v1['transactions']) {
      delete t.debtId;
      delete t.recurringRuleId;
    }
    const dst = await fresh();
    await expect(importBackup(dst, v1)).resolves.toMatchObject({ added: expect.any(Number) });
    expect(await dst.db.transactions.toArray()).toEqual([expect.objectContaining({ debtId: null, recurringRuleId: null })]);
    expect(await dst.db.budgets.count()).toBe(0);
    const again = await exportBackup(dst);
    expect(again).toMatchObject({ version: 2, budgets: [], debts: [], recurringRules: [] });
    // и снова читается как своя копия версии 2
    await expect(importBackup(await fresh(), JSON.parse(JSON.stringify(again)))).resolves.toBeDefined();
  });

  it('новые списки в файле версии 1 игнорируются (это не её данные)', async () => {
    const src = await fresh();
    await populated(src);
    const v1 = { ...clone(await exportBackup(src)), version: 1 };
    const dst = await fresh();
    await importBackup(dst, v1);
    expect(await dst.db.budgets.count()).toBe(0);
    expect(await dst.db.debts.count()).toBe(0);
    expect(await dst.db.recurring_rules.count()).toBe(0);
  });

  it('версия 3 и неизвестные версии отвергаются; в версии 2 обязательны все списки', async () => {
    const src = await fresh();
    const file = clone(await exportBackup(src));
    const dst = await fresh();
    await expect(importBackup(dst, { ...file, version: 3 })).rejects.toThrow(/более новой версией/);
    await expect(importBackup(dst, { ...file, version: 0 })).rejects.toThrow(/Неизвестная версия/);
    for (const [key, label] of [['budgets', 'бюджеты'], ['debts', 'долги'], ['recurringRules', 'регулярные платежи']] as const) {
      const bad = { ...file };
      delete bad[key];
      await expect(importBackup(dst, bad)).rejects.toThrow(new RegExp(`нет списка «${label}»`));
    }
  });
});

describe('строгая проверка новых данных: ничего не записывается', () => {
  type Mutate = (f: Record<string, any>) => void;
  const broken: [string, Mutate, RegExp][] = [
    // бюджеты
    ['бюджет: сумма 0', (f) => (f.budgets[0].amountMinor = 0), /Лимит бюджета/],
    ['бюджет: сумма больше 1e15', (f) => (f.budgets[0].amountMinor = 1_000_000_000_000_001), /слишком велика/],
    ['бюджет: дробная сумма', (f) => (f.budgets[0].amountMinor = 1.5), /Лимит бюджета/],
    ['бюджет: период не месяц', (f) => (f.budgets[0].period = 'week'), /Период бюджета/],
    ['бюджет: валюта строчными', (f) => (f.budgets[0].currency = 'tjs'), /Валюта бюджета/],
    ['бюджет: категория не UUID', (f) => (f.budgets[1].categoryId = 'food'), /UUID/],
    ['бюджет: несуществующая категория', (f) => (f.budgets[1].categoryId = NOPE), /несуществующую категорию/],
    ['бюджет на категорию доходов', (f) => (f.budgets[1].categoryId = f.categories.find((c: any) => c.kind === 'income').id), /для доходов/],
    ['бюджет: два на одну категорию', (f) => (f.budgets[1].categoryId = f.budgets[0].categoryId), /два бюджета на одну/],
    ['бюджет: повторяющийся id', (f) => (f.budgets[1].id = f.budgets[0].id), /повторяющийся/],
    ['бюджет: метка не каноничная', (f) => (f.budgets[0].clientUpdatedAt = '2026-10-01'), /метка времени/],
    // долги
    ['долг: пустое имя', (f) => (f.debts[0].counterparty = '  '), /Кто должен/],
    ['долг: имя 81 символ', (f) => (f.debts[0].counterparty = 'я'.repeat(81)), /от 1 до 80/],
    ['долг: сумма 0', (f) => (f.debts[0].principalMinor = 0), /Сумма долга/],
    ['долг: сумма больше 1e15', (f) => (f.debts[0].principalMinor = 1e15 + 1), /слишком велика/],
    ['долг: направление', (f) => (f.debts[0].direction = 'gift'), /Направление долга/],
    ['долг: 31 февраля', (f) => (f.debts[0].openedOn = '2026-02-31'), /настоящая дата/],
    ['долг: дата до 2000', (f) => (f.debts[0].openedOn = '1999-01-01'), /допустимы даты/],
    ['долг: срок после 2100', (f) => (f.debts[0].dueOn = '2100-01-02'), /допустимы даты/],
    ['долг: заметка 501', (f) => (f.debts[0].note = 'я'.repeat(501)), /Заметка/],
    ['долг: closedAt не метка', (f) => (f.debts[0].closedAt = 'вчера'), /Дата закрытия/],
    ['долг: нулевой символ', (f) => (f.debts[0].counterparty = 'А\u0000'), /нулевого символа/],
    ['долг: повторяющийся id', (f) => (f.debts[1].id = f.debts[0].id), /повторяющийся/],
    // регулярные платежи
    ['правило: шаг 0', (f) => (f.recurringRules[0].intervalN = 0), /Шаг повторения/],
    ['правило: шаг 1001', (f) => (f.recurringRules[0].intervalN = 1001), /Шаг повторения/],
    ['правило: частота', (f) => (f.recurringRules[0].frequency = 'hourly'), /Частота/],
    ['правило: автопроведение 2', (f) => (f.recurringRules[0].autoPost = 2), /Автопроведение/],
    ['правило: автопроведение true', (f) => (f.recurringRules[0].autoPost = true), /Автопроведение/],
    ['правило: конец раньше начала', (f) => (f.recurringRules[0].endOn = '2026-10-14'), /раньше начала/],
    ['правило: начало 31 февраля', (f) => (f.recurringRules[0].startOn = '2026-02-31'), /настоящая дата/],
    ['правило: сумма 0', (f) => (f.recurringRules[0].amountMinor = 0), /Сумма/],
    ['правило: несуществующий кошелёк', (f) => (f.recurringRules[0].walletId = NOPE), /несуществующий кошелёк/],
    ['правило: несуществующая категория', (f) => (f.recurringRules[0].categoryId = NOPE), /несуществующую категорию/],
    ['правило: категория не того вида', (f) => (f.recurringRules[0].categoryId = f.categories.find((c: any) => c.kind === 'income').id), /не подходит/],
    ['правило: несуществующий долг', (f) => (f.recurringRules[0].debtId = NOPE), /несуществующий долг/],
    ['правило: долг в другой валюте', (f) => (f.debts.find((d: any) => d.id === f.recurringRules[0].debtId).currency = 'USD'), /не совпадает с валютой долга/],
    ['правило: перевод без суммы зачисления', (f) => ((f.recurringRules[0].kind = 'transfer'), (f.recurringRules[0].toWalletId = f.wallets[1].id), (f.recurringRules[0].debtId = null)), /сумма зачисления/],
    ['правило: у перевода долг', (f) => ((f.recurringRules[0].kind = 'transfer'), (f.recurringRules[0].toWalletId = f.wallets[1].id), (f.recurringRules[0].toAmountMinor = 1)), /не бывает долга/],
    ['правило: id не UUID', (f) => (f.recurringRules[0].id = 'rule 1'), /идентификатор/],
    // операции: новые поля
    ['операция: долг не UUID', (f) => (f.transactions.find((t: any) => t.debtId).debtId = 'долг'), /UUID/],
    ['операция: несуществующий долг', (f) => (f.transactions.find((t: any) => t.debtId).debtId = NOPE), /несуществующий долг/],
    ['операция: несуществующий регулярный платёж', (f) => (f.transactions.find((t: any) => t.recurringRuleId).recurringRuleId = NOPE), /несуществующий регулярный платёж/],
    ['операция: у перевода долг', (f) => (f.transactions.find((t: any) => t.kind === 'transfer').debtId = f.debts[0].id), /не бывает долга/],
    ['операция по долгу в кошельке другой валюты', (f) => (f.debts.find((d: any) => d.id === f.transactions.find((t: any) => t.debtId && !t.deletedAt).debtId).currency = 'USD'), /не совпадает с валютой долга/],
    ['перевод: комиссия при равных суммах', (f) => (f.transactions.find((t: any) => t.kind === 'transfer').toAmountMinor = f.transactions.find((t: any) => t.kind === 'transfer').amountMinor), /комиссия указана/],
    ['перевод между валютами с «комиссией»', (f) => {
      const usd = f.wallets.find((w: any) => w.currency === 'USD');
      const tr = f.transactions.find((t: any) => t.kind === 'transfer');
      tr.toWalletId = usd.id; tr.toAmountMinor = 100; // 98,00 → 1,00 USD: обмен, комиссии быть не может
    }, /у обмена между валютами не бывает комиссии/],
  ];

  it.each(broken)('отвергает: %s', async (_name, mutate, message) => {
    const src = await fresh();
    await populated(src);
    const file = clone(await exportBackup(src));
    mutate(file);
    const dst = await fresh();
    await populated(dst); // в базе уже есть данные — они обязаны остаться нетронутыми
    const before = JSON.stringify(noTime(await exportBackup(dst)));
    await expect(importBackup(dst, file)).rejects.toThrow(message);
    await expect(importBackup(dst, file)).rejects.toBeInstanceOf(ValidationError);
    expect(JSON.stringify(noTime(await exportBackup(dst)))).toBe(before);
  });

  it('импорт не меняет направление/валюту долга, по которому на устройстве уже есть операции', async () => {
    const src = await fresh();
    const k = await populated(src);
    const file = clone(await exportBackup(src));
    // на «втором устройстве» такой же долг уже с операциями, а файл (новее) приносит другую валюту
    const dst = await fresh();
    await importBackup(dst, JSON.parse(JSON.stringify(await exportBackup(src))));
    const d = file.debts.find((x: any) => x.id === k.lent.id);
    d.currency = 'USD';
    d.clientUpdatedAt = new Date(Date.now() + 60_000).toISOString();
    // операции в файле не заменяют локальные (те же версии) → они закрепляют долг
    await expect(importBackup(dst, file)).rejects.toThrow(/меняет направление или валюту долга/);
    expect((await dst.db.debts.get(k.lent.id))?.currency).toBe('TJS');
  });

  it('метки и тексты подрезаются как у остальных таблиц: пробелы убраны, метки в границах сервера, UUID — строчными', async () => {
    const src = await fresh();
    const k = await populated(src);
    const file = clone(await exportBackup(src));
    const d = file.debts.find((x: any) => x.id === k.lent.id);
    d.counterparty = '  Али  ';
    d.note = ' на ремонт ';
    d.closedAt = '1990-01-01T00:00:00.000Z';
    d.archivedAt = '2200-01-01T00:00:00.000Z';
    d.id = d.id.toUpperCase();
    for (const t of file.transactions) if (t.debtId === k.lent.id) t.debtId = t.debtId.toUpperCase();
    file.recurringRules[0].archivedAt = '1999-01-01T00:00:00.000Z';
    file.recurringRules[0].note = '  Платёж банку  ';
    const dst = await fresh();
    await importBackup(dst, file);
    const got = (await dst.db.debts.get(k.lent.id))!;
    expect(got).toMatchObject({ counterparty: 'Али', note: 'на ремонт', closedAt: '2000-01-01T00:00:00.000Z', archivedAt: '2100-01-01T00:00:00.000Z' });
    expect((await dst.db.transactions.where('debtId').equals(k.lent.id).count())).toBe(2); // ссылки строчные и совпали с id долга
    expect(await dst.db.recurring_rules.get(k.rule.id)).toMatchObject({ archivedAt: '2000-01-01T00:00:00.000Z', note: 'Платёж банку' });
  });

  it('файл с метками из будущего: у новых таблиц они подрезаются так же, как у остальных', async () => {
    const src = await fresh();
    const k = await populated(src);
    const file = clone(await exportBackup(src));
    const future = '2090-01-01T00:00:00.000Z';
    file.budgets[0].clientUpdatedAt = future;
    file.debts[0].createdAt = future;
    file.recurringRules[0].deletedAt = future;
    file.recurringRules[0].clientUpdatedAt = future;
    const dst = await fresh();
    await importBackup(dst, file);
    for (const row of [...(await dst.db.budgets.toArray()), ...(await dst.db.debts.toArray()), ...(await dst.db.recurring_rules.toArray())]) {
      expect(row.clientUpdatedAt < '2030-01-01').toBe(true);
      expect(row.createdAt < '2030-01-01').toBe(true);
    }
    expect(k.rule.id).toBeDefined();
    expect(await importBackup(dst, file)).toMatchObject({ added: 0, replaced: 0 });
  });
});

describe('копия чужого аккаунта (без блока настроек): ссылки и детерминированные id пересчитываются', () => {
  async function importForeign() {
    const alice = await fresh(USER_A);
    const k = await populated(alice);
    const file = JSON.parse(JSON.stringify(withoutSettings(await exportBackup(alice))));
    const bob = await fresh(USER_B);
    await bob.settings.ensure({ baseCurrency: 'TJS' });
    const result = await importBackup(bob, file);
    return { alice, bob, k, file, result };
  }

  it('все записи получают id Боба; ссылки согласованы; ничего не осталось с id Алисы', async () => {
    const { bob, k, file } = await importForeign();
    const aliceIds = new Set<string>([
      ...file.wallets.map((x: any) => x.id), ...file.categories.map((x: any) => x.id), ...file.transactions.map((x: any) => x.id),
      ...file.debts.map((x: any) => x.id), ...file.recurringRules.map((x: any) => x.id), ...file.budgets.map((x: any) => x.id),
    ]);
    const wallets = await bob.db.wallets.toArray();
    const cats = await bob.db.categories.toArray();
    const debts = await bob.db.debts.toArray();
    const rules = await bob.db.recurring_rules.toArray();
    const budgets = await bob.db.budgets.toArray();
    const txs = await bob.db.transactions.toArray();
    expect(debts).toHaveLength(2);
    expect(rules).toHaveLength(1);
    expect(budgets).toHaveLength(2);
    for (const row of [...wallets, ...cats, ...debts, ...rules, ...budgets, ...txs]) expect(aliceIds.has(row.id), `id ${row.id} не перекодирован`).toBe(false);
    const walletIds = new Set(wallets.map((w) => w.id));
    const catIds = new Set(cats.map((c) => c.id));
    const debtIds = new Set(debts.map((d) => d.id));
    const ruleIds = new Set(rules.map((r) => r.id));
    for (const t of txs) {
      expect(walletIds.has(t.walletId)).toBe(true);
      if (t.debtId) expect(debtIds.has(t.debtId)).toBe(true);
      if (t.recurringRuleId) expect(ruleIds.has(t.recurringRuleId)).toBe(true);
    }
    const rule = rules[0]!;
    expect(walletIds.has(rule.walletId)).toBe(true);
    expect(debtIds.has(rule.debtId!)).toBe(true);
    expect(rule.debtId).not.toBe(k.borrowed.id);
    // долг правила и долг его операции — один и тот же долг Боба
    const done = txs.find((t) => t.recurringRuleId === rule.id && t.deletedAt === null)!;
    expect(done.debtId).toBe(rule.debtId);
    // бюджет на категорию указывает на категорию Боба
    for (const b of budgets) if (b.categoryId) expect(catIds.has(b.categoryId)).toBe(true);
  });

  it('id бюджета пересчитан от НОВОЙ категории (повторное создание лимита на неё обновит его, а не заведёт второй)', async () => {
    const { bob } = await importForeign();
    const budgets = await bob.db.budgets.toArray();
    for (const b of budgets) expect(b.id).toBe(await defaultId(USER_B, `budget:${b.categoryId ?? 'total'}`));
    const withCat = budgets.find((b) => b.categoryId !== null)!;
    const updated = await bob.budgets.create({ categoryId: withCat.categoryId, amountMinor: 1_234 });
    expect(updated.id).toBe(withCat.id);
    expect(await bob.db.budgets.count()).toBe(2);
    const total = budgets.find((b) => b.categoryId === null)!;
    expect(total.id).toBe(await defaultId(USER_B, 'budget:total'));
  });

  it('операции по расписанию: id = v5(новое правило, дата); createFromRule на этой дате возвращает ту же операцию, а пропуск остаётся пропуском', async () => {
    const { bob, k } = await importForeign();
    const rule = (await bob.db.recurring_rules.toArray())[0]!;
    const done = await bob.db.transactions.get(await uuidV5(rule.id, '2026-10-15'));
    expect(done).toMatchObject({ recurringRuleId: rule.id, occurredOn: '2026-10-15', deletedAt: null });
    expect(done!.id).not.toBe(k.done.id);
    const again = await bob.transactions.createFromRule(rule.id, '2026-10-15');
    expect(again.id).toBe(done!.id);
    const skipped = await bob.db.transactions.get(await uuidV5(rule.id, '2026-11-15'));
    expect(skipped?.deletedAt).not.toBeNull();
    expect((await bob.transactions.createFromRule(rule.id, '2026-11-15')).deletedAt).not.toBeNull();
    expect(await bob.db.transactions.where('recurringRuleId').equals(rule.id).count()).toBe(2);
  });

  it('тот же файл второй раз ничего не плодит и ничего не заменяет', async () => {
    const { bob, file } = await importForeign();
    const counts = async () => [await bob.db.wallets.count(), await bob.db.categories.count(), await bob.db.transactions.count(), await bob.db.budgets.count(), await bob.db.debts.count(), await bob.db.recurring_rules.count()];
    const before = await counts();
    expect(await importBackup(bob, file)).toMatchObject({ added: 0, replaced: 0 });
    expect(await counts()).toEqual(before);
  });

  it('операция с изменённой датой (id уже не выводится из даты) перекодируется как обычная и остаётся привязанной к правилу', async () => {
    const alice = await fresh(USER_A);
    const k = await populated(alice);
    await alice.transactions.update(k.done.id, { occurredOn: '2026-10-17' });
    const file = JSON.parse(JSON.stringify(withoutSettings(await exportBackup(alice))));
    const bob = await fresh(USER_B);
    await bob.settings.ensure({ baseCurrency: 'TJS' });
    await importBackup(bob, file);
    const rule = (await bob.db.recurring_rules.toArray())[0]!;
    const moved = (await bob.db.transactions.where('recurringRuleId').equals(rule.id).toArray()).find((t) => t.occurredOn === '2026-10-17')!;
    expect(moved).toBeDefined();
    expect(moved.id).not.toBe(await uuidV5(rule.id, '2026-10-17'));
    expect(await importBackup(bob, file)).toMatchObject({ added: 0 });
  });

  it('стартовые категории: копия известного аккаунта сопоставляется со стартовыми записями Боба, бюджет ложится на его стартовую категорию', async () => {
    const { ensureSeeded } = await import('@/db');
    const alice = await fresh(USER_A);
    await ensureSeeded(alice);
    const foodId = await defaultId(USER_A, 'category:food');
    await alice.budgets.create({ categoryId: foodId, amountMinor: 70_000 });
    const file = JSON.parse(JSON.stringify(withoutSettings(await exportBackup(alice))));
    const bob = await fresh(USER_B);
    await ensureSeeded(bob);
    const catsBefore = await bob.db.categories.count();
    await importBackup(bob, file, { sourceUserId: USER_A });
    expect(await bob.db.categories.count()).toBe(catsBefore); // стартовые не продублированы
    const bobFood = await defaultId(USER_B, 'category:food');
    const budget = await bob.db.budgets.get(await defaultId(USER_B, `budget:${bobFood}`));
    expect(budget).toMatchObject({ categoryId: bobFood, amountMinor: 70_000 });
  });
});
