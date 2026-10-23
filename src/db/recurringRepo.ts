import type { Frequency, IsoDate, LocalRow, Minor, RecurringRule, TxKind, UUID, Wallet } from '@/domain/types';
import { ValidationError } from './errors';
import { newId } from './ids';
import { cleanPatch, sameFields, touch, withDirtyGroups, writeTx, type RepoContext } from './repoContext';
import { checkCategoryOf, checkDebtLink, checkTransferAmounts, loadWallets } from './txChecks';
import { reqId } from './validate';
import { parseRuleData, type RuleData } from './validatePlans';

export interface RecurringInput {
  kind: TxKind;
  walletId: UUID;
  toWalletId?: UUID | null;
  amountMinor: Minor;
  /** Перевод между разными валютами: обязательна. В одной валюте не задана — равна сумме списания (без комиссии). */
  toAmountMinor?: Minor | null;
  categoryId?: UUID | null;
  /** Платёж по долгу (только расход/доход; валюта кошелька = валюте долга). */
  debtId?: UUID | null;
  note?: string;
  frequency: Frequency;
  /** Каждые N периодов, 1…1000. По умолчанию 1. */
  intervalN?: number;
  startOn: IsoDate;
  endOn?: IsoDate | null;
  /** 1 — проводить само в день платежа, 0 (по умолчанию) — ждать подтверждения в «Предстоящих». */
  autoPost?: 0 | 1;
}

export type RecurringPatch = Partial<RecurringInput>;

export interface RecurringRepo {
  create(input: RecurringInput, opts?: { id?: UUID }): Promise<LocalRow<RecurringRule>>;
  update(id: UUID, patch: RecurringPatch): Promise<LocalRow<RecurringRule>>;
  /** В архив: платежи по правилу больше не создаются, уже созданные операции остаются. Повтор безопасен. */
  archive(id: UUID): Promise<LocalRow<RecurringRule>>;
  restore(id: UUID): Promise<LocalRow<RecurringRule>>;
}

const INPUT_KEYS = [
  'kind',
  'walletId',
  'toWalletId',
  'amountMinor',
  'toAmountMinor',
  'categoryId',
  'debtId',
  'note',
  'frequency',
  'intervalN',
  'startOn',
  'endOn',
  'autoPost',
] as const;

const DATA_KEYS: readonly (keyof RuleData)[] = [
  'kind',
  'walletId',
  'toWalletId',
  'amountMinor',
  'toAmountMinor',
  'categoryId',
  'debtId',
  'note',
  'frequency',
  'intervalN',
  'startOn',
  'endOn',
  'autoPost',
  'archivedAt',
];

const dataOf = (r: RecurringRule): RuleData => ({
  kind: r.kind,
  walletId: r.walletId,
  toWalletId: r.toWalletId,
  amountMinor: r.amountMinor,
  toAmountMinor: r.toAmountMinor,
  categoryId: r.categoryId,
  debtId: r.debtId,
  note: r.note,
  frequency: r.frequency,
  intervalN: r.intervalN,
  startOn: r.startOn,
  endOn: r.endOn,
  autoPost: r.autoPost,
  archivedAt: r.archivedAt,
});

export function createRecurringRepo(ctx: RepoContext): RecurringRepo {
  const { db } = ctx;
  const scope = () => [db.recurring_rules, db.wallets, db.categories, db.debts];

  /** Сумма зачисления перевода: явная — как есть; в одной валюте — равна сумме списания; между валютами — обязательна. */
  function resolveToAmount(d: RuleData, wallet: Wallet, toWallet: Wallet | null): Minor | null {
    if (d.kind !== 'transfer' || toWallet === null) return null;
    if (d.toAmountMinor !== null) return d.toAmountMinor;
    if (wallet.currency === toWallet.currency) return d.amountMinor;
    throw new ValidationError('Укажите сумму зачисления: у кошельков разные валюты');
  }

  /** Все проверки «против базы»; возвращает данные с выведенной суммой зачисления. prev — прежняя версия (архивное прежнее остаётся). */
  async function verify(d: RuleData, prev?: RecurringRule): Promise<RuleData> {
    const { wallet, toWallet } = await loadWallets(ctx, d, prev);
    await checkCategoryOf(ctx, d);
    await checkDebtLink(ctx, d, wallet, prev ? { debtId: prev.debtId } : undefined);
    const full: RuleData = { ...d, toAmountMinor: resolveToAmount(d, wallet, toWallet) };
    checkTransferAmounts(full, wallet, toWallet);
    return parseRuleData(full as unknown as Record<string, unknown>, { requireToAmount: true });
  }

  async function getLiveRule(id: UUID): Promise<LocalRow<RecurringRule>> {
    const r = await db.recurring_rules.get(id);
    if (!r) throw new ValidationError('Регулярный платёж не найден');
    if (r.deletedAt !== null) throw new ValidationError('Регулярный платёж удалён');
    return r;
  }

  async function save(id: UUID, change: (r: LocalRow<RecurringRule>) => RuleData, checkRefs: boolean): Promise<LocalRow<RecurringRule>> {
    return writeTx(ctx, scope(), async () => {
      const cur = await getLiveRule(id);
      const raw = change(cur);
      if (sameFields(dataOf(cur), raw, DATA_KEYS)) return cur;
      // ссылки проверяем при правке содержимого; архивация и возврат из архива не должны упираться в удалённый позже кошелёк
      const next = checkRefs ? await verify(raw, cur) : raw;
      if (sameFields(dataOf(cur), next, DATA_KEYS)) return cur;
      const row = withDirtyGroups<LocalRow<RecurringRule>>('recurring_rules', cur, { ...cur, ...next, ...touch(ctx).fields });
      await db.recurring_rules.put(row);
      return row;
    });
  }

  return {
    async create(input, opts) {
      const clean = cleanPatch(input, INPUT_KEYS, 'Регулярный платёж');
      const id = opts?.id;
      if (id !== undefined) reqId(id, 'Регулярный платёж: id');
      const parsed = parseRuleData({ intervalN: 1, autoPost: 0, ...clean, archivedAt: null });
      return writeTx(ctx, scope(), async () => {
        const newRowId = id ?? newId();
        if (id !== undefined && (await db.recurring_rules.get(newRowId))) {
          throw new ValidationError('Регулярный платёж с таким id уже существует');
        }
        const data = await verify(parsed);
        const { stamp, fields } = touch(ctx);
        const row: LocalRow<RecurringRule> = {
          id: newRowId,
          createdAt: stamp,
          deletedAt: null,
          ...data,
          ...fields,
          serverSeq: null,
          dirtyGroups: [], // создан здесь: правки до первой отправки считаются от созданного (см. mergeGroups.ts)
        };
        await db.recurring_rules.add(row);
        return row;
      });
    },

    async update(id, patch) {
      const clean = cleanPatch(patch, INPUT_KEYS, 'Регулярный платёж');
      return save(
        id,
        (cur) => {
          const merged: Record<string, unknown> = { ...dataOf(cur), ...clean };
          if (clean.kind !== undefined && clean.kind !== cur.kind) {
            // поля, которых у нового вида быть не может, сбрасываются сами (если их не передали явно)
            if (clean.kind === 'transfer') {
              merged['categoryId'] = clean.categoryId ?? null;
              merged['debtId'] = clean.debtId ?? null;
            } else {
              merged['toWalletId'] = clean.toWalletId ?? null;
              merged['toAmountMinor'] = clean.toAmountMinor ?? null;
            }
          }
          return parseRuleData(merged);
        },
        true,
      );
    },

    async archive(id) {
      return save(id, (cur) => (cur.archivedAt !== null ? dataOf(cur) : { ...dataOf(cur), archivedAt: ctx.clock.tick() }), false);
    },

    async restore(id) {
      return save(id, (cur) => ({ ...dataOf(cur), archivedAt: null }), false);
    },
  };
}

