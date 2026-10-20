import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { SectionHeader } from '@/components/SectionHeader';
import { Skeleton } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import { useRecurringRules, useStoppedDebtPlans, useStore, useUpcoming, ValidationError } from '@/db';
import type { IsoDate, LocalRow, RecurringRule } from '@/domain/types';
import { cn } from '@/lib/cn';
import { pluralRu } from '@/lib/plural';
import { useAutoPostFailures } from '@/recurring/autoPostState';
import { monthlyTotals } from '@/recurring/monthly';
import type { RuleFormState } from '@/recurring/ruleForm';
import { AUTO_POST_MAX_AGE_DAYS } from '@/recurring/plan';
import { groupUpcoming, itemKey, SOON_DAYS } from '@/recurring/upcoming';
import { useSkipped } from '@/recurring/useSkipped';
import { useToday } from '@/recurring/useToday';
import { PostSheet } from './PostSheet';
import { ArchivedRow, RuleRow } from './RulesList';
import { RuleSheet } from './RuleSheet';
import { SkipDialog } from './SkipDialog';
import { SkippedRow } from './SkippedList';
import { candidateLabel, SubscriptionsCard } from './SubscriptionsCard';
import { UpcomingRow } from './UpcomingRow';
import { useRecurringLookups } from './useRecurringData';
import { useSubscriptions } from './useSubscriptions';

/** Сколько просроченных показываем сразу (остальные — по кнопке): у давнего ежедневного платежа их сотни. */
const OVERDUE_PAGE = 30;

type SheetState = { kind: 'new'; prefill?: Partial<RuleFormState> } | { kind: 'edit'; id: string };
type PendingRef = { ruleId: string; date: IsoDate };

function Section({ id, title, hint, tone, children }: { id: string; title: string; hint?: string; tone?: 'danger'; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mb-6">
      <SectionHeader id={id}>
        <span className={cn(tone === 'danger' && 'text-danger')}>{title}</span>
      </SectionHeader>
      {hint && <p className="mb-2 px-1 text-sm text-muted">{hint}</p>}
      <Card padding="none">
        <ul className="divide-y divide-border">{children}</ul>
      </Card>
    </section>
  );
}

function Collapsible({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="mb-6">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl px-1 text-left font-semibold text-muted"
      >
        <span>{title}</span>
        <Icon name="chevron" size={18} className={open ? 'rotate-90' : ''} />
      </button>
      {open && children}
    </section>
  );
}

/**
 * Регулярные платежи: «Просроченные», «Сегодня», «Скоро» (30 дней), пропущенные и «Все правила».
 * Провести — окно с суммой и заметкой (без двойных нажатий: кнопка блокируется на время записи). Пропустить — с подтверждением,
 * обратимо. Платежи «Проводить само» записываются при открытии приложения (AutoPostRunner); если не получилось — пометка у платежа.
 */
export default function RecurringPage() {
  const store = useStore();
  const toast = useToast();
  const today = useToday();
  const rules = useRecurringRules({ includeArchived: true });
  const upcoming = useUpcoming(SOON_DAYS, { today });
  const lookups = useRecurringLookups();
  const failures = useAutoPostFailures(store.userId);
  const stoppedPlans = useStoppedDebtPlans();
  const skipped = useSkipped(rules ?? [], today);
  const subs = useSubscriptions(lookups, today);

  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [posting, setPosting] = useState<PendingRef | null>(null);
  const [skipping, setSkipping] = useState<PendingRef | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  const [showSubs, setShowSubs] = useState(false);
  const [overdueShown, setOverdueShown] = useState(OVERDUE_PAGE);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const busyRef = useRef(new Set<string>());

  const groups = useMemo(() => groupUpcoming(upcoming), [upcoming]);
  // уже проведённые и пропущенные даты по правилам: «Следующий платёж» их не называет
  const doneDates = useMemo(() => {
    const out = new Map<string, Set<IsoDate>>();
    for (const it of upcoming ?? []) {
      if (!it.alreadyExists) continue;
      const set = out.get(it.rule.id) ?? new Set<IsoDate>();
      set.add(it.date);
      out.set(it.rule.id, set);
    }
    return out;
  }, [upcoming]);

  if (rules === undefined || upcoming === undefined || lookups === undefined || skipped === undefined) {
    return (
      <>
        <PageHeader title="Регулярные платежи" />
        <div role="status" aria-busy="true">
          <span className="sr-only">Загрузка…</span>
          <div aria-hidden="true" className="flex flex-col gap-4">
            <Skeleton className="h-24 !rounded-card" />
            <Skeleton className="h-40 !rounded-card" />
          </div>
        </div>
      </>
    );
  }
  if (lookups === null) {
    return (
      <>
        <PageHeader title="Регулярные платежи" />
        <EmptyState icon="cloud" title="Данные ещё загружаются" text="Подождите немного: после первой загрузки здесь появятся платежи." />
      </>
    );
  }

  // пока не известно, какие планы по долгам остановлены, итог не показываем: иначе он «прыгнул» бы, когда это выяснится
  const monthly =
    stoppedPlans === undefined
      ? undefined
      : monthlyTotals(
          rules,
          (walletId) => lookups.wallets.get(walletId)?.currency,
          today,
          lookups.base,
          (r) => stoppedPlans.has(r.id),
        );
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const active = rules.filter((r) => r.archivedAt === null);
  const archived = rules.filter((r) => r.archivedAt !== null);
  const postingRule = posting ? ruleById.get(posting.ruleId) : undefined;
  const skippingRule = skipping ? ruleById.get(skipping.ruleId) : undefined;
  const editRule = sheet?.kind === 'edit' ? ruleById.get(sheet.id) : undefined;

  /** Действие по одной строке с защитой от повторного нажатия: пока оно идёт, кнопка заблокирована. */
  const guarded = async (key: string, fn: () => Promise<void>) => {
    if (busyRef.current.has(key)) return;
    busyRef.current.add(key);
    setBusyIds(new Set(busyRef.current));
    try {
      await fn();
    } finally {
      busyRef.current.delete(key);
      setBusyIds(new Set(busyRef.current));
    }
  };

  const fail = (e: unknown, fallback: string) => {
    if (!(e instanceof ValidationError)) console.error(fallback, e);
    toast.error(e instanceof ValidationError ? e.message : fallback);
  };

  const restoreRule = (rule: LocalRow<RecurringRule>) =>
    guarded(`rule:${rule.id}`, async () => {
      try {
        await store.recurring.restore(rule.id);
        toast.success('Платёж возвращён из архива');
      } catch (e) {
        fail(e, 'Не удалось вернуть платёж из архива');
      }
    });

  const restoreSkipped = (txId: string) =>
    guarded(`tx:${txId}`, async () => {
      try {
        await store.transactions.restore(txId);
        toast.success('Платёж возвращён и записан в операции');
      } catch (e) {
        fail(e, 'Не удалось вернуть платёж. Он остался пропущенным.');
      }
    });

  const empty = groups.overdue.length === 0 && groups.due.length === 0 && groups.soon.length === 0;
  const row = (item: (typeof groups.overdue)[number]) => (
    <UpcomingRow
      key={itemKey(item)}
      item={item}
      today={today}
      lookups={lookups}
      failure={failures.get(item.rule.id)}
      onPost={() => setPosting({ ruleId: item.rule.id, date: item.date })}
      onSkip={() => setSkipping({ ruleId: item.rule.id, date: item.date })}
    />
  );
  // «Похоже на подписки» — под ближайшими платежами; если платежей ещё нет, подсказки стоят первыми (с них удобно начать)
  const subsCard =
    subs && subs.items.length > 0 ? (
      <SubscriptionsCard
        items={subs.items}
        open={showSubs}
        onToggle={() => setShowSubs((v) => !v)}
        lookups={lookups}
        onDismiss={subs.dismiss}
        onCreate={(c) => {
          const category = c.categoryId === null ? undefined : lookups.categories.get(c.categoryId);
          setSheet({
            kind: 'new',
            prefill: {
              kind: 'expense',
              walletId: c.walletId,
              amountMinor: c.amountMinor,
              // категория могла уйти в архив: тогда без неё, а не с ошибкой при сохранении
              categoryId: category && category.deletedAt === null && category.archivedAt === null ? c.categoryId : null,
              note: candidateLabel(c, lookups),
              frequency: c.frequency,
              intervalText: String(c.intervalN),
              startOn: c.nextOn,
            },
          });
        }}
      />
    ) : null;

  const overdueRows = groups.overdue.slice(0, overdueShown);
  const overdueMore = groups.overdue.length - overdueRows.length;

  return (
    <>
      <PageHeader
        title="Регулярные платежи"
        // на самом узком телефоне (320 px) заголовок переносится на вторую строку, а не обрезается многоточием
        className="[&_h1]:whitespace-normal"
        actions={
          // На телефоне — только «+»: рядом с длинным заголовком слову «Добавить» не хватает места (подпись для скринридера есть всегда)
          <Button icon="plus" aria-label="Добавить платёж" onClick={() => setSheet({ kind: 'new' })}>
            <span className="hidden sm:inline">Добавить</span>
          </Button>
        }
      />

      {rules.length === 0 ? (
        <>
          {subsCard}
          <EmptyState
            icon="repeat"
            title="Платежей по расписанию пока нет"
            text="Добавьте аренду, подписку или зарплату: приложение напомнит о платеже и, если хотите, запишет его само."
            action={<Button onClick={() => setSheet({ kind: 'new' })}>Добавить первый платёж</Button>}
          />
        </>
      ) : (
        <>
          {monthly === null ? (
            <Card className="mb-6 text-muted" role="status">
              Суммы платежей слишком велики, чтобы посчитать итог в месяц.
            </Card>
          ) : (
            monthly !== undefined &&
            monthly.length > 0 && (
              <Card className="mb-6" data-testid="recurring-monthly" role="group" aria-label="Платежи по расписанию в месяц">
                <p className="text-sm font-semibold text-muted">В месяц, примерно</p>
                <ul className="mt-1 flex flex-col gap-2">
                  {monthly.map((m) => (
                    <li key={m.currency} className="flex flex-wrap items-baseline justify-between gap-x-4">
                      {m.expenseMinor > 0 && (
                        <span className="text-base">
                          Платежи <MoneyText minor={m.expenseMinor} currency={m.currency} tone="expense" className="text-xl font-bold" />
                        </span>
                      )}
                      {m.incomeMinor > 0 && (
                        <span className="text-base">
                          Поступления <MoneyText minor={m.incomeMinor} currency={m.currency} tone="income" sign="always" className="text-xl font-bold" />
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted">Платежи с разной периодичностью пересчитаны на месяц. Переводы и остановленные платежи не входят.</p>
              </Card>
            )
          )}
          {groups.overdue.length > 0 && (
            <Section
              id="rec-overdue"
              title="Просроченные"
              tone="danger"
              hint={`${groups.overdue.length} ${pluralRu(groups.overdue.length, 'платёж ждёт', 'платежа ждут', 'платежей ждут')} вашего решения: проведите или пропустите.`}
            >
              {overdueRows.map(row)}
              {overdueMore > 0 && (
                <li className="px-4 py-2">
                  <Button variant="ghost" fullWidth onClick={() => setOverdueShown((n) => n + OVERDUE_PAGE)}>
                    Показать ещё {Math.min(overdueMore, OVERDUE_PAGE)} из {overdueMore}
                  </Button>
                </li>
              )}
            </Section>
          )}
          {groups.due.length > 0 && (
            <Section id="rec-today" title="Сегодня">
              {groups.due.map(row)}
            </Section>
          )}
          {groups.soon.length > 0 && (
            <Section id="rec-soon" title="Скоро" hint={`Ближайшие ${SOON_DAYS} дней`}>
              {groups.soon.map(row)}
            </Section>
          )}
          {empty && (
            <Card className="mb-6 text-muted" role="status">
              На ближайшие {SOON_DAYS} дней платежей нет.
            </Card>
          )}

          {subsCard}

          {skipped.length > 0 && (
            <Collapsible title={`Пропущенные · ${skipped.length}`} open={showSkipped} onToggle={() => setShowSkipped((v) => !v)}>
              <p className="mb-2 px-1 text-sm text-muted">
                Эти платежи вы пропустили. «Вернуть» записывает платёж в операции.
              </p>
              <Card padding="none">
                <ul className="divide-y divide-border">
                  {skipped.map((s) => {
                    const rule = s.tx.recurringRuleId === null ? undefined : ruleById.get(s.tx.recurringRuleId);
                    return rule ? (
                      <SkippedRow
                        key={s.tx.id}
                        item={s}
                        rule={rule}
                        lookups={lookups}
                        today={today}
                        busy={busyIds.has(`tx:${s.tx.id}`)}
                        onRestore={() => void restoreSkipped(s.tx.id)}
                      />
                    ) : null;
                  })}
                </ul>
              </Card>
            </Collapsible>
          )}

          <Section id="rec-all" title="Все правила">
            {active.length === 0 ? (
              <li className="px-4 py-4 text-muted">Все платежи в архиве.</li>
            ) : (
              active.map((r) => (
                <RuleRow
                  key={r.id}
                  rule={r}
                  lookups={lookups}
                  today={today}
                  failure={failures.get(r.id)}
                  stop={stoppedPlans?.get(r.id)}
                  done={doneDates.get(r.id)}
                  onOpen={() => setSheet({ kind: 'edit', id: r.id })}
                />
              ))
            )}
          </Section>

          {archived.length > 0 && (
            <Collapsible
              title={`В архиве · ${archived.length} ${pluralRu(archived.length, 'платёж', 'платежа', 'платежей')}`}
              open={showArchived}
              onToggle={() => setShowArchived((v) => !v)}
            >
              <Card padding="none" className="mt-1">
                <ul className="divide-y divide-border">
                  {archived.map((r) => (
                    <ArchivedRow
                      key={r.id}
                      rule={r}
                      lookups={lookups}
                      busy={busyIds.has(`rule:${r.id}`)}
                      onRestore={() => void restoreRule(r)}
                    />
                  ))}
                </ul>
              </Card>
            </Collapsible>
          )}

          <p className="mt-2 flex items-start gap-2 text-sm text-muted">
            <Icon name="info" size={16} className="mt-0.5 shrink-0" />
            <span>
              Платежи «Проводить само» записываются, когда вы открываете приложение. Платежи старше {AUTO_POST_MAX_AGE_DAYS} дней сами не проводятся:
              они ждут вас в «Просроченных».
            </span>
          </p>
        </>
      )}

      {sheet && (sheet.kind === 'new' || editRule) && (
        <RuleSheet
          key={sheet.kind === 'edit' ? sheet.id : 'new'}
          rule={sheet.kind === 'edit' ? (editRule ?? null) : null}
          prefill={sheet.kind === 'new' ? sheet.prefill : undefined}
          lookups={lookups}
          today={today}
          onClose={() => setSheet(null)}
        />
      )}
      {posting && postingRule && (
        <PostSheet
          key={`${posting.ruleId}:${posting.date}`}
          rule={postingRule}
          date={posting.date}
          today={today}
          lookups={lookups}
          onClose={() => setPosting(null)}
        />
      )}
      {skipping && skippingRule && (
        <SkipDialog
          key={`${skipping.ruleId}:${skipping.date}`}
          rule={skippingRule}
          date={skipping.date}
          lookups={lookups}
          onClose={() => setSkipping(null)}
        />
      )}
    </>
  );
}
