import { beforeAll, describe, expect, it } from 'vitest';
import type { Budget, Category, Debt, Entity, RecurringRule, SavingsGoal, Transaction, TxKind, Wallet } from '@/domain/types';
import { fromWire, toWire, type SyncTableName, type WireRow } from '@/sync/tables';
import { HOUR, MIN, expectRejected, find, iso, must, newId, pullAll, type ServerHarness } from './conformanceKit';
import { makeBudget, makeCategory, makeDebt, makeRecurringRule, makeSavingsGoal, makeTransaction, makeUserId, makeWallet } from './factories';

/**
 * Сценарии для таблиц этапа 2 (долги, бюджеты, регулярные платежи) и новых полей операций (debt_id, recurring_rule_id,
 * комиссия перевода в base_amount_minor). Подключаются из runConformance и идут против тех же серверов: PGlite, PostgREST, память.
 * Общие для всех таблиц сценарии (идемпотентность, «последний побеждает», мягкое удаление, метки из будущего, изоляция)
 * уже обходят SYNC_TABLES целиком в conformance.ts.
 */
export function runStage2Conformance(getHarness: () => ServerHarness): void {
    const fresh = () => {
      const userId = makeUserId();
      return { userId, t: getHarness().transportFor(userId) };
    };
    const h = { now: () => getHarness().now() };

    describe('8б. этап 2: отказы сервера — вся пачка отвергается целиком', () => {
      const ctx = {} as {
        B: ReturnType<typeof fresh>;
        w1: Wallet;
        w2: Wallet;
        catId: string;
        foreignWalletId: string;
        foreignCatId: string;
        debtId: string;
        ruleId: string;
        foreignDebtId: string;
        foreignRuleId: string;
      };
      const sync = () => ({ createdAt: iso(h.now().getTime() - HOUR), clientUpdatedAt: iso(h.now().getTime() - HOUR), deviceId: 'device-a' });
      const tx = (o: Partial<Transaction>): WireRow => toWire('transactions', makeTransaction({ ...sync(), walletId: ctx.w1.id, ...o }));
      const deb = (o: Partial<Debt>): WireRow => toWire('debts', makeDebt({ ...sync(), ...o }));
      const bud = (o: Partial<Budget>): WireRow => toWire('budgets', makeBudget({ ...sync(), ...o }));
      const rul = (o: Partial<RecurringRule>): WireRow => toWire('recurring_rules', makeRecurringRule({ ...sync(), walletId: ctx.w1.id, ...o }));
      const cat = (o: Partial<Category>): WireRow => toWire('categories', makeCategory({ ...sync(), ...o }));
      const goal = (o: Partial<SavingsGoal>): WireRow => toWire('savings_goals', makeSavingsGoal({ ...sync(), ...o }));

      beforeAll(async () => {
        // чужой пользователь A: кошелёк, категория, долг, платёж
        const A = fresh();
        const fw = makeWallet(sync());
        const fc = makeCategory(sync());
        const fd = makeDebt(sync());
        await A.t.push('wallets', [toWire('wallets', fw)]);
        await A.t.push('categories', [toWire('categories', fc)]);
        await A.t.push('debts', [toWire('debts', fd)]);
        const fr = makeRecurringRule({ ...sync(), walletId: fw.id });
        await A.t.push('recurring_rules', [toWire('recurring_rules', fr)]);
        // свой пользователь B: два кошелька, категория, долг, платёж
        ctx.B = fresh();
        ctx.w1 = makeWallet(sync());
        ctx.w2 = makeWallet({ ...sync(), currency: 'USD' });
        const c = makeCategory(sync());
        await ctx.B.t.push('wallets', [toWire('wallets', ctx.w1), toWire('wallets', ctx.w2)]);
        await ctx.B.t.push('categories', [toWire('categories', c)]);
        const d = makeDebt(sync());
        await ctx.B.t.push('debts', [toWire('debts', d)]);
        const r = makeRecurringRule({ ...sync(), walletId: ctx.w1.id });
        await ctx.B.t.push('recurring_rules', [toWire('recurring_rules', r)]);
        ctx.catId = c.id;
        ctx.foreignWalletId = fw.id;
        ctx.foreignCatId = fc.id;
        ctx.debtId = d.id;
        ctx.ruleId = r.id;
        ctx.foreignDebtId = fd.id;
        ctx.foreignRuleId = fr.id;
      });

      const tooLong = 'я'.repeat(501);
      const cases: Array<[string, SyncTableName, () => WireRow]> = [
        // этап 2: долги и регулярные платежи в операциях
        ['перевод с долгом', 'transactions', () => tx({ kind: 'transfer', toWalletId: ctx.w2.id, debtId: ctx.debtId })],
        ['операция с долгом другого пользователя', 'transactions', () => tx({ debtId: ctx.foreignDebtId })],
        ['операция с несуществующим долгом', 'transactions', () => tx({ debtId: newId() })],
        ['операция с регулярным платежом другого пользователя', 'transactions', () => tx({ recurringRuleId: ctx.foreignRuleId })],
        ['операция с несуществующим регулярным платежом', 'transactions', () => tx({ recurringRuleId: newId() })],
        ['комиссия перевода меньше нуля', 'transactions', () => tx({ kind: 'transfer', toWalletId: ctx.w2.id, baseAmountMinor: -1 })],
        ['комиссия перевода больше допустимой', 'transactions', () => tx({ kind: 'transfer', toWalletId: ctx.w2.id, baseAmountMinor: 1_000_000_000_000_001 })],
        // «сумма в валюте» у операций (раздел 19 схемы)
        ['операция: валюта суммы без самой суммы', 'transactions', () => tx({ foreignCurrency: 'AED', foreignAmountMinor: null })],
        ['операция: сумма в валюте без валюты', 'transactions', () => tx({ foreignCurrency: null, foreignAmountMinor: 5000 })],
        ['операция: валюта суммы строчными буквами', 'transactions', () => tx({ foreignCurrency: 'aed', foreignAmountMinor: 5000 })],
        ['операция: сумма в валюте 0', 'transactions', () => tx({ foreignCurrency: 'AED', foreignAmountMinor: 0 })],
        ['операция: отрицательная сумма в валюте', 'transactions', () => tx({ foreignCurrency: 'AED', foreignAmountMinor: -1 })],
        ['операция: сумма в валюте больше допустимой', 'transactions', () => tx({ foreignCurrency: 'AED', foreignAmountMinor: 1_000_000_000_000_001 })],
        ['перевод с суммой в валюте', 'transactions', () => tx({ kind: 'transfer', toWalletId: ctx.w2.id, foreignCurrency: 'AED', foreignAmountMinor: 5000 })],
        // долги
        ['долг: пустой контрагент', 'debts', () => deb({ counterparty: '' })],
        ['долг: контрагент длиннее 80 символов', 'debts', () => deb({ counterparty: 'я'.repeat(81) })],
        ['долг: неизвестное направление', 'debts', () => deb({ direction: 'gift' as Debt['direction'] })],
        ['долг: сумма 0', 'debts', () => deb({ principalMinor: 0 })],
        ['долг: отрицательная сумма', 'debts', () => deb({ principalMinor: -1 })],
        ['долг: сумма больше допустимой', 'debts', () => deb({ principalMinor: 1_000_000_000_000_001 })],
        ['долг: плохая валюта', 'debts', () => deb({ currency: 'usd' })],
        ['долг: дата выдачи раньше 2000 года', 'debts', () => deb({ openedOn: '1999-12-31' })],
        ['долг: дата выдачи позже 2100 года', 'debts', () => deb({ openedOn: '2100-01-02' })],
        ['долг: срок позже 2100 года', 'debts', () => deb({ dueOn: '2100-01-02' })],
        ['долг: срок раньше 2000 года', 'debts', () => deb({ dueOn: '1999-12-31' })],
        ['долг: заметка длиннее 500 символов', 'debts', () => deb({ note: tooLong })],
        ['долг: закрыт в невозможную дату', 'debts', () => deb({ closedAt: '1990-01-01T00:00:00.000Z' })],
        // проценты по долгу (раздел 14 схемы)
        ['долг: проценты 0', 'debts', () => deb({ interestMinor: 0 })],
        ['долг: отрицательные проценты', 'debts', () => deb({ interestMinor: -1 })],
        ['долг: проценты больше допустимых', 'debts', () => deb({ interestMinor: 1_000_000_000_000_001 })],
        ['долг: ставка 0', 'debts', () => deb({ interestMinor: 5, interestRateBp: 0 })],
        ['долг: ставка больше 1000 %', 'debts', () => deb({ interestMinor: 5, interestRateBp: 100_001 })],
        ['долг: срок 0 месяцев', 'debts', () => deb({ interestMinor: 5, termMonths: 0 })],
        ['долг: срок больше 600 месяцев', 'debts', () => deb({ interestMinor: 5, termMonths: 601 })],
        ['долг: ставка без процентов', 'debts', () => deb({ interestMinor: null, interestRateBp: 2400 })],
        ['долг: срок без процентов', 'debts', () => deb({ interestMinor: null, termMonths: 12 })],
        // объединение долгов (раздел 15 схемы)
        ['долг: в составе самого себя', 'debts', () => { const id = newId(); return deb({ id, mergedIntoId: id }); }],
        ['долг: в составе долга другого пользователя', 'debts', () => deb({ mergedIntoId: ctx.foreignDebtId })],
        ['долг: в составе несуществующего долга', 'debts', () => deb({ mergedIntoId: newId() })],
        // «обязательная» категория (раздел 16 схемы)
        ['категория: «обязательная» = 2', 'categories', () => cat({ essential: 2 as 0 })],
        ['категория: «обязательная» отрицательная', 'categories', () => cat({ essential: -1 as 0 })],
        // категория долга (раздел 17 схемы)
        ['долг: категория длиннее 40 символов', 'debts', () => deb({ category: 'я'.repeat(41) })],
        ['долг: категория длиннее 40 символов (эмодзи)', 'debts', () => deb({ category: '😀'.repeat(41) })],
        // цели накопления (раздел 18 схемы)
        ['цель: пустое название', 'savings_goals', () => goal({ name: '' })],
        ['цель: название длиннее 60 символов', 'savings_goals', () => goal({ name: 'я'.repeat(61) })],
        ['цель: название длиннее 60 символов (эмодзи)', 'savings_goals', () => goal({ name: '😀'.repeat(61) })],
        ['цель: сумма 0', 'savings_goals', () => goal({ targetMinor: 0 })],
        ['цель: отрицательная сумма', 'savings_goals', () => goal({ targetMinor: -1 })],
        ['цель: сумма больше допустимой', 'savings_goals', () => goal({ targetMinor: 1_000_000_000_000_001 })],
        ['цель: плохая валюта', 'savings_goals', () => goal({ currency: 'tjs' })],
        ['цель: срок раньше 2000 года', 'savings_goals', () => goal({ dueOn: '1999-12-31' })],
        ['цель: срок позже 2100 года', 'savings_goals', () => goal({ dueOn: '2100-01-02' })],
        ['цель: в архиве с невозможной датой', 'savings_goals', () => goal({ archivedAt: '1990-01-01T00:00:00.000Z' })],
        ['цель: кошелёк другого пользователя', 'savings_goals', () => goal({ walletId: ctx.foreignWalletId })],
        ['цель: несуществующий кошелёк', 'savings_goals', () => goal({ walletId: newId() })],
        // бюджеты
        ['бюджет: сумма 0', 'budgets', () => bud({ amountMinor: 0 })],
        ['бюджет: отрицательная сумма', 'budgets', () => bud({ amountMinor: -100 })],
        ['бюджет: сумма больше допустимой', 'budgets', () => bud({ amountMinor: 1_000_000_000_000_001 })],
        ['бюджет: плохая валюта', 'budgets', () => bud({ currency: 'tjs' })],
        ['бюджет: период не «month»', 'budgets', () => bud({ period: 'week' as Budget['period'] })],
        ['бюджет: категория другого пользователя', 'budgets', () => bud({ categoryId: ctx.foreignCatId })],
        ['бюджет: несуществующая категория', 'budgets', () => bud({ categoryId: newId() })],
        // регулярные платежи
        ['платёж: сумма 0', 'recurring_rules', () => rul({ amountMinor: 0 })],
        ['платёж: сумма больше допустимой', 'recurring_rules', () => rul({ amountMinor: 1_000_000_000_000_001 })],
        ['платёж: неизвестный вид', 'recurring_rules', () => rul({ kind: 'refund' as TxKind })],
        ['платёж: неизвестная частота', 'recurring_rules', () => rul({ frequency: 'hourly' as RecurringRule['frequency'] })],
        ['платёж: интервал 0', 'recurring_rules', () => rul({ intervalN: 0 })],
        ['платёж: интервал больше 1000', 'recurring_rules', () => rul({ intervalN: 1001 })],
        ['платёж: начало раньше 2000 года', 'recurring_rules', () => rul({ startOn: '1999-12-31' })],
        ['платёж: начало позже 2100 года', 'recurring_rules', () => rul({ startOn: '2100-01-02' })],
        ['платёж: конец раньше начала', 'recurring_rules', () => rul({ startOn: '2026-10-10', endOn: '2026-10-09' })],
        ['платёж: «проводить само» не 0 и не 1', 'recurring_rules', () => rul({ autoPost: 2 as 0 })],
        ['платёж: заметка длиннее 500 символов', 'recurring_rules', () => rul({ note: tooLong })],
        ['платёж-перевод на тот же кошелёк', 'recurring_rules', () => rul({ kind: 'transfer', toWalletId: ctx.w1.id })],
        ['платёж-перевод без суммы зачисления', 'recurring_rules', () => rul({ kind: 'transfer', toWalletId: ctx.w2.id, toAmountMinor: null })],
        ['платёж-перевод с нулевой суммой зачисления', 'recurring_rules', () => rul({ kind: 'transfer', toWalletId: ctx.w2.id, toAmountMinor: 0 })],
        ['платёж-перевод без кошелька зачисления', 'recurring_rules', () => rul({ kind: 'transfer', toWalletId: null, toAmountMinor: 5 })],
        ['платёж-перевод с категорией', 'recurring_rules', () => rul({ kind: 'transfer', toWalletId: ctx.w2.id, categoryId: ctx.catId })],
        ['платёж-перевод с долгом', 'recurring_rules', () => rul({ kind: 'transfer', toWalletId: ctx.w2.id, debtId: ctx.debtId })],
        ['платёж-расход с to_wallet_id', 'recurring_rules', () => rul({ toWalletId: ctx.w2.id })],
        ['платёж-расход с to_amount_minor', 'recurring_rules', () => rul({ toAmountMinor: 5 })],
        ['платёж с кошельком другого пользователя', 'recurring_rules', () => rul({ walletId: ctx.foreignWalletId })],
        ['платёж-перевод на кошелёк другого пользователя', 'recurring_rules', () => rul({ kind: 'transfer', toWalletId: ctx.foreignWalletId })],
        ['платёж с категорией другого пользователя', 'recurring_rules', () => rul({ categoryId: ctx.foreignCatId })],
        ['платёж с долгом другого пользователя', 'recurring_rules', () => rul({ debtId: ctx.foreignDebtId })],
        ['платёж с несуществующим долгом', 'recurring_rules', () => rul({ debtId: newId() })],
        ['платёж на ещё не отправленный кошелёк', 'recurring_rules', () => rul({ walletId: newId() })],
      ];

      for (const [title, table, bad] of cases) {
        it(title, async () => {
          const good =
            table === 'debts' ? deb({})
            : table === 'categories' ? cat({})
            : table === 'savings_goals' ? goal({})
            : table === 'budgets' ? bud({})
            : table === 'recurring_rules' ? rul({})
            : tx({});
          const badRow = bad();
          await expectRejected(ctx.B.t.push(table, [good, badRow]));
          const ids = (await pullAll(ctx.B.t, table)).map((r) => r.id);
          expect(ids, 'хорошая строка из той же пачки не должна сохраниться').not.toContain(good['id']);
          expect(ids).not.toContain(badRow['id']);
        });
      }
    });

    it('13. этап 2: предельные значения принимаются ровно по границе (символы, а не байты), и приходят обратно без искажений', async () => {
      const { t } = fresh();
      const t0 = h.now().getTime();
      const sync = { createdAt: iso(t0 - HOUR), clientUpdatedAt: iso(t0 - HOUR), deviceId: 'device-a' };
      const w1 = makeWallet(sync);
      const w2 = makeWallet({ ...sync, currency: 'USD' });
      await t.push('wallets', [toWire('wallets', w1), toWire('wallets', w2)]);
      const MAX = 1_000_000_000_000_000;
      const debts = [
        makeDebt({ ...sync, counterparty: 'я'.repeat(80), note: 'я'.repeat(500), principalMinor: 1, openedOn: '2000-01-01', dueOn: '2100-01-01' }),
        makeDebt({ ...sync, counterparty: '😀'.repeat(80), note: '😀'.repeat(500), principalMinor: MAX, openedOn: '2100-01-01', dueOn: null }),
        // проценты на нижней и верхней границе: сумма 1…1e15, ставка 1…100000, срок 1…600; только сумма процентов — без ставки и срока
        makeDebt({ ...sync, interestMinor: 1, interestRateBp: 1, termMonths: 1 }),
        makeDebt({ ...sync, interestMinor: MAX, interestRateBp: 100_000, termMonths: 600 }),
        makeDebt({ ...sync, interestMinor: 12_345 }),
      ];
      // составляющая объединения: ссылается на главный долг (он уже на сервере)
      const parts = [makeDebt({ ...sync, mergedIntoId: debts[0]!.id, interestMinor: 7_000, interestRateBp: 1800, termMonths: 6 })];
      const budgets = [makeBudget({ ...sync, amountMinor: 1 }), makeBudget({ ...sync, amountMinor: MAX })];
      const rules = [
        makeRecurringRule({ ...sync, walletId: w1.id, amountMinor: 1, intervalN: 1, startOn: '2000-01-01', endOn: '2000-01-01', note: 'я'.repeat(500), autoPost: 1 }),
        makeRecurringRule({ ...sync, walletId: w1.id, amountMinor: MAX, intervalN: 1000, startOn: '2100-01-01', endOn: '2100-01-01', frequency: 'daily' }),
        makeRecurringRule({ ...sync, kind: 'transfer', walletId: w1.id, toWalletId: w2.id, amountMinor: MAX, toAmountMinor: MAX, frequency: 'yearly' }),
      ];
      const fees = [
        makeTransaction({ ...sync, kind: 'transfer', walletId: w1.id, toWalletId: w2.id, baseAmountMinor: 0 }), // перевод без комиссии
        makeTransaction({ ...sync, kind: 'transfer', walletId: w1.id, toWalletId: w2.id, baseAmountMinor: MAX }), // комиссия на пределе
        makeTransaction({ ...sync, kind: 'transfer', walletId: w2.id, toWalletId: w1.id, baseAmountMinor: 1 }),
      ];
      await t.push('debts', debts.map((e) => toWire('debts', e)));
      await t.push('debts', parts.map((e) => toWire('debts', e)));
      await t.push('budgets', budgets.map((e) => toWire('budgets', e)));
      await t.push('recurring_rules', rules.map((e) => toWire('recurring_rules', e)));
      await t.push('transactions', fees.map((e) => toWire('transactions', e)));
      const sent: Array<[SyncTableName, Entity[]]> = [['debts', [...debts, ...parts]], ['budgets', budgets], ['recurring_rules', rules], ['transactions', fees]];
      for (const [table, list] of sent) {
        const got = new Map((await pullAll(t, table)).map((r) => [r.id as string, fromWire(table, r).entity]));
        for (const e of list) expect(got.get(e.id), `${table}/${e.id}`).toEqual(e);
      }
    });

    it('14. этап 2: мягко удалённый родитель остаётся родителем; правка, меняющая ссылку на чужой долг или правило, отвергается и ничего не портит', async () => {
      const A = fresh();
      const B = fresh();
      const t0 = h.now().getTime();
      const sync = { createdAt: iso(t0 - HOUR), clientUpdatedAt: iso(t0 - HOUR), deviceId: 'device-a' };
      const gone = iso(t0 - 30 * MIN);
      const w = makeWallet(sync);
      const cat = makeCategory({ ...sync, deletedAt: gone });
      const debt = makeDebt({ ...sync, deletedAt: gone });
      await A.t.push('wallets', [toWire('wallets', w)]);
      await A.t.push('categories', [toWire('categories', cat)]);
      await A.t.push('debts', [toWire('debts', debt)]);
      const rule = makeRecurringRule({ ...sync, walletId: w.id, debtId: debt.id, categoryId: cat.id, deletedAt: gone });
      await A.t.push('recurring_rules', [toWire('recurring_rules', rule)]);
      const budget = makeBudget({ ...sync, categoryId: cat.id });
      await A.t.push('budgets', [toWire('budgets', budget)]);
      const tx = makeTransaction({ ...sync, walletId: w.id, debtId: debt.id, recurringRuleId: rule.id });
      await A.t.push('transactions', [toWire('transactions', tx)]); // все родители удалены мягко — ссылки по-прежнему верны
      expect(must(await find(A.t, 'transactions', tx.id), 'операция').debt_id).toBe(debt.id);

      // чужой пользователь заводит свои долг и правило; правка своей операции со ссылкой на ЧУЖИЕ — отказ
      const bw = makeWallet(sync);
      await B.t.push('wallets', [toWire('wallets', bw)]);
      const bt = makeTransaction({ ...sync, walletId: bw.id });
      await B.t.push('transactions', [toWire('transactions', bt)]);
      const before = await pullAll(B.t, 'transactions');
      const later = iso(t0);
      await expectRejected(B.t.push('transactions', [toWire('transactions', { ...bt, clientUpdatedAt: later, debtId: debt.id })]));
      await expectRejected(B.t.push('transactions', [toWire('transactions', { ...bt, clientUpdatedAt: later, recurringRuleId: rule.id })]));
      expect(await pullAll(B.t, 'transactions')).toEqual(before);
      // а ссылку можно и убрать, и вернуть своим родителем
      const own = makeDebt({ ...sync });
      await B.t.push('debts', [toWire('debts', own)]);
      await B.t.push('transactions', [toWire('transactions', { ...bt, clientUpdatedAt: later, debtId: own.id })]);
      expect(must(await find(B.t, 'transactions', bt.id), 'операция B').debt_id).toBe(own.id);
      // чужие долги и правила не видны через pull
      expect(await pullAll(B.t, 'debts')).toHaveLength(1);
      expect(await pullAll(B.t, 'recurring_rules')).toEqual([]);
    });
    it('15. «обязательная» категория, категория долга и цели накопления: границы принимаются и приходят обратно без искажений', async () => {
      const { t } = fresh();
      const t0 = h.now().getTime();
      const sync = { createdAt: iso(t0 - HOUR), clientUpdatedAt: iso(t0 - HOUR), deviceId: 'device-a' };
      const w1 = makeWallet({ ...sync, kind: 'savings' });
      await t.push('wallets', [toWire('wallets', w1)]);
      const MAX = 1_000_000_000_000_000;
      const categories = [makeCategory({ ...sync, essential: 0 }), makeCategory({ ...sync, essential: 1 })];
      const debts = [makeDebt({ ...sync, category: '' }), makeDebt({ ...sync, category: 'я'.repeat(40) }), makeDebt({ ...sync, category: '😀'.repeat(40) })];
      const goals = [
        makeSavingsGoal({ ...sync, name: 'я', targetMinor: 1, dueOn: '2000-01-01' }),
        makeSavingsGoal({ ...sync, name: '😀'.repeat(60), targetMinor: MAX, dueOn: '2100-01-01', walletId: w1.id }),
        makeSavingsGoal({ ...sync, name: 'я'.repeat(60), currency: 'USD', archivedAt: iso(t0 - MIN) }),
      ];
      await t.push('categories', categories.map((e) => toWire('categories', e)));
      await t.push('debts', debts.map((e) => toWire('debts', e)));
      await t.push('savings_goals', goals.map((e) => toWire('savings_goals', e)));
      const sent: Array<[SyncTableName, Entity[]]> = [['categories', categories], ['debts', debts], ['savings_goals', goals]];
      for (const [table, list] of sent) {
        const got = new Map((await pullAll(t, table)).map((r) => [r.id as string, fromWire(table, r).entity]));
        for (const e of list) expect(got.get(e.id), `${table}/${e.id}`).toEqual(e);
      }
    });

    it('16. колонки, которую клиент не прислал (старое приложение), берётся значение по умолчанию, а сохранённое не затирается', async () => {
      const { t } = fresh();
      const t0 = h.now().getTime();
      const sync = { createdAt: iso(t0 - HOUR), clientUpdatedAt: iso(t0 - HOUR), deviceId: 'device-a' };
      const cat = makeCategory({ ...sync, essential: 1 });
      const debt = makeDebt({ ...sync, category: 'Кредит' });
      const stripped = (table: 'categories' | 'debts', e: Category | Debt, column: string, stamp: number): WireRow => {
        const { [column]: _dropped, ...rest } = toWire(table, { ...e, clientUpdatedAt: iso(t0 - HOUR + stamp), deviceId: 'device-old' });
        void _dropped;
        return rest;
      };
      // новая запись без колонки — значение по умолчанию (0 и пустой текст)
      await t.push('categories', [stripped('categories', makeCategory({ ...sync }), 'essential', 1)]);
      await t.push('debts', [stripped('debts', makeDebt({ ...sync }), 'category', 1)]);
      const freshCat = (await pullAll(t, 'categories'))[0] as Record<string, unknown>;
      const freshDebt = (await pullAll(t, 'debts'))[0] as Record<string, unknown>;
      expect(freshCat['essential']).toBe(0);
      expect(freshDebt['category']).toBe('');
      // запись с настоящим значением, потом правка «старым» приложением без колонки: значение остаётся
      await t.push('categories', [toWire('categories', cat)]);
      await t.push('debts', [toWire('debts', debt)]);
      await t.push('categories', [{ ...stripped('categories', { ...cat, name: 'Переименована' }, 'essential', 10) }]);
      await t.push('debts', [{ ...stripped('debts', { ...debt, note: 'правка' }, 'category', 10) }]);
      expect(must(await find(t, 'categories', cat.id), 'категория')).toMatchObject({ essential: 1, name: 'Переименована' });
      expect(must(await find(t, 'debts', debt.id), 'долг')).toMatchObject({ category: 'Кредит', note: 'правка' });
    });

    it('17. «сумма в валюте» у операций: границы принимаются и приходят обратно; старое приложение (без колонок) её не затирает', async () => {
      const { t } = fresh();
      const t0 = h.now().getTime();
      const sync = { createdAt: iso(t0 - HOUR), clientUpdatedAt: iso(t0 - HOUR), deviceId: 'device-a' };
      const w = makeWallet({ ...sync });
      await t.push('wallets', [toWire('wallets', w)]);
      const MAX = 1_000_000_000_000_000;
      const plain = makeTransaction({ ...sync, walletId: w.id });
      const small = makeTransaction({ ...sync, walletId: w.id, foreignCurrency: 'AED', foreignAmountMinor: 1 });
      const big = makeTransaction({ ...sync, walletId: w.id, kind: 'income', categoryId: null, foreignCurrency: 'USD', foreignAmountMinor: MAX });
      await t.push('transactions', [plain, small, big].map((e) => toWire('transactions', e)));
      const got = new Map((await pullAll(t, 'transactions')).map((r) => [r.id as string, fromWire('transactions', r).entity]));
      for (const e of [plain, small, big]) expect(got.get(e.id), e.id).toEqual(e);
      expect(got.get(plain.id)).toMatchObject({ foreignCurrency: null, foreignAmountMinor: null });

      // старое приложение правит заметку и колонок не присылает: сумма в валюте остаётся
      const { foreign_currency: _c, foreign_amount_minor: _a, ...rest } = toWire('transactions', {
        ...small,
        note: 'правка со старого приложения',
        clientUpdatedAt: iso(t0 - HOUR + 10),
        deviceId: 'device-old',
      });
      void _c;
      void _a;
      await t.push('transactions', [rest]);
      expect(must(await find(t, 'transactions', small.id), 'операция')).toMatchObject({
        foreign_currency: 'AED',
        foreign_amount_minor: 1,
        note: 'правка со старого приложения',
      });
    });
}
