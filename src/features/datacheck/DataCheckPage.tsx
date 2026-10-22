import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button, buttonClasses } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Glyph } from '@/components/Glyph';
import { Icon } from '@/components/Icon';
import { MoneyText } from '@/components/MoneyText';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import { useStore } from '@/db';
import { formatMinor } from '@/domain/money';
import { budgetLabel } from '@/features/budgets/budgetText';
import { humanError, toastWithUndo } from '@/features/transactions/txActions';
import { useCategoryIndex } from '@/features/transactions/txData';
import { formatDayLabel } from '@/lib/dates';
import { useDismissedKeys } from '@/lib/dismissedKeys';
import { pluralRu } from '@/lib/plural';
import { useToday } from '@/recurring/useToday';
import { useDataCheck } from './useDataCheck';

/** Вид подсказок для «Это нормально» (на этом устройстве). */
export const DATACHECK_NAMESPACE = 'datacheck';

function Block({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <Card aria-labelledby={id} className="!py-4 md:!p-5" data-testid={id}>
      <h2 id={id} className="text-base font-semibold">
        {title}
      </h2>
      {hint && <p className="mb-1 mt-0.5 text-sm text-muted">{hint}</p>}
      <ul className="flex flex-col divide-y divide-border">{children}</ul>
    </Card>
  );
}

function Row({ icon, title, text, actions, testId }: { icon: ReactNode; title: ReactNode; text?: string; actions: ReactNode; testId?: string }) {
  return (
    <li className="flex flex-col gap-2 py-3" data-testid={testId}>
      <div className="flex items-start gap-3">
        {icon}
        <div className="min-w-0 flex-1 text-sm">
          <p className="break-words font-medium">{title}</p>
          {text && <p className="mt-0.5 text-muted">{text}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </li>
  );
}

function Loading() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Проверяем…</span>
      <div aria-hidden="true" className="flex flex-col gap-4">
        <Skeleton className="h-28 !rounded-card" />
        <Skeleton className="h-44 !rounded-card" />
      </div>
    </div>
  );
}

const NOTE_ICON = { dup: 'alert', future: 'calendar', big: 'alert', neg: 'wallet', none: 'tag' } as const;

/** Значок находки без категории: жёлтая плитка, как у значков категорий. */
const NoteIcon = ({ kind }: { kind: keyof typeof NOTE_ICON }) => (
  <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-warning/15 text-warning">
    <Icon name={NOTE_ICON[kind]} size={18} />
  </span>
);

/**
 * «Проверка данных»: что в операциях и кошельках похоже на ошибку внесения (dataCheck.ts) — возможные дубли, операции без категории,
 * даты в будущем, слишком крупные траты и отрицательные остатки. Ничего не правит само: у каждой находки «Открыть», где есть что исправить, и
 * «Это нормально» (помнится на этом устройстве). Дубль можно убрать кнопкой «Удалить лишнюю» (с «Отменить»).
 */
export default function DataCheckPage() {
  const store = useStore();
  const toast = useToast();
  const location = useLocation();
  const today = useToday();
  const state = useDataCheck(today);
  const categories = useCategoryIndex();
  const { hidden, dismiss } = useDismissedKeys(DATACHECK_NAMESPACE, store.userId);
  const header = <PageHeader title="Проверка данных" subtitle="Ищем то, что похоже на ошибку внесения" back={{ to: '/settings', label: 'Настройки' }} />;

  if (state === undefined || categories === undefined) {
    return (
      <>
        {header}
        <Loading />
      </>
    );
  }
  if (state === null) {
    return (
      <>
        {header}
        <p role="status" className="py-10 text-center text-muted">
          Настройки ещё не загружены
        </p>
      </>
    );
  }

  const { base, check } = state;
  const catName = (id: string | null) => (id === null ? 'Без категории' : budgetLabel(id, categories).name);
  const catIcon = (id: string | null) => (id === null ? { icon: '➖', color: undefined as string | undefined } : { icon: budgetLabel(id, categories).icon, color: budgetLabel(id, categories).color ?? undefined });
  const edit = (id: string) => ({ to: `/edit/${id}`, state: { background: location } });
  const openLink = (id: string, label = 'Открыть') => (
    <Link {...edit(id)} className={buttonClasses('secondary', 'md')}>
      {label}
    </Link>
  );
  const normal = (key: string, what: string) => (
    <Button variant="ghost" aria-label={`Это нормально: ${what}`} onClick={() => dismiss(key)}>
      Это нормально
    </Button>
  );

  const dupes = check.dupes.filter((d) => !hidden.has(d.key));
  const future = check.future.items.filter((f) => !hidden.has(f.key));
  const outliers = check.outliers.filter((o) => !hidden.has(o.key));
  const negative = check.negative.filter((n) => !hidden.has(n.key));
  const uncategorized = check.uncategorized;
  const total = dupes.length + future.length + outliers.length + negative.length + uncategorized.total;

  const removeExtra = async (ids: readonly string[], label: string) => {
    try {
      const extra = ids.slice(1);
      for (const id of extra) await store.transactions.softDelete(id);
      toastWithUndo(
        toast,
        `Лишняя трата удалена: ${label}`,
        async () => {
          for (const id of extra) await store.transactions.restore(id);
        },
        'Трата возвращена',
      );
    } catch (e) {
      toast.error(humanError(e, 'Не удалось удалить. Попробуйте ещё раз.'));
    }
  };

  return (
    <>
      {header}
      {total === 0 ? (
        <EmptyState icon="check" title="Проблем не найдено" text="Дублей, операций без категории, дат в будущем, слишком крупных трат и отрицательных остатков нет." />
      ) : (
        <div className="stagger flex flex-col gap-4">
          <Card data-testid="datacheck-summary" className="!py-4 md:!p-5">
            <p className="text-base font-semibold">
              Найдено: {total} {pluralRu(total, 'пункт', 'пункта', 'пунктов')}
            </p>
            <p className="mt-0.5 text-sm text-muted">Это только кандидаты: решаете вы. Что в порядке, отметьте «Это нормально» — больше не покажем.</p>
          </Card>

          {dupes.length > 0 && (
            <Block id="check-dupes" title="Возможные дубли" hint="Одинаковые траты (кошелёк, категория, сумма, заметка) в один день за последние полгода.">
              {dupes.map((d) => {
                const name = d.note !== '' ? d.note : catName(d.categoryId);
                const count = d.txIds.length;
                const ic = catIcon(d.categoryId);
                return (
                  <Row
                    key={d.key}
                    testId="check-dupe"
                    icon={<Glyph value={ic.icon} color={ic.color} size={32} />}
                    title={
                      <>
                        {name} — <MoneyText minor={d.amountMinor} currency={base} tone="expense" /> × {count}
                      </>
                    }
                    text={`${formatDayLabel(d.occurredOn, today)} · ${count} ${pluralRu(count, 'одинаковая трата', 'одинаковые траты', 'одинаковых трат')} за день`}
                    actions={
                      <>
                        {openLink(d.txIds[0]!)}
                        <Button variant="secondary" aria-label={`Удалить лишнюю: ${name}`} onClick={() => void removeExtra(d.txIds, name)}>
                          Удалить лишнюю
                        </Button>
                        {normal(d.key, name)}
                      </>
                    }
                  />
                );
              })}
            </Block>
          )}

          {uncategorized.total > 0 && (
            <Block id="check-uncategorized" title={`Без категории · ${uncategorized.total}`} hint="Операции без категории не попадают в разбивку по категориям. За последние три месяца.">
              {uncategorized.items.slice(0, 5).map((u) => (
                <Row
                  key={u.id}
                  testId="check-uncategorized-item"
                  icon={<NoteIcon kind="none" />}
                  title={
                    <>
                      {u.note !== '' ? u.note : u.kind === 'income' ? 'Доход' : 'Расход'} — <MoneyText minor={u.kind === 'income' ? u.amountMinor : -u.amountMinor} currency={u.currency} tone="auto" />
                    </>
                  }
                  text={formatDayLabel(u.occurredOn, today)}
                  actions={openLink(u.id, 'Выбрать категорию')}
                />
              ))}
              <li className="py-2">
                <Link to="/transactions?period=all&category=none" className={buttonClasses('ghost', 'md')}>
                  Все без категории · {uncategorized.total}
                </Link>
              </li>
            </Block>
          )}

          {future.length > 0 && (
            <Block id="check-future" title="Дата в будущем" hint="Часто это опечатка в годе. Если операция запланирована специально, отметьте «Это нормально».">
              {future.map((f) => (
                <Row
                  key={f.key}
                  testId="check-future-item"
                  icon={<NoteIcon kind="future" />}
                  title={
                    <>
                      {f.note !== '' ? f.note : f.kind === 'income' ? 'Доход' : f.kind === 'transfer' ? 'Перевод' : 'Расход'} — <MoneyText minor={f.amountMinor} currency={f.currency} tone="none" />
                    </>
                  }
                  text={`${formatDayLabel(f.occurredOn, today)} · через ${f.daysAhead} ${pluralRu(f.daysAhead, 'день', 'дня', 'дней')}`}
                  actions={
                    <>
                      {openLink(f.id, 'Исправить дату')}
                      {normal(f.key, f.note !== '' ? f.note : 'операция')}
                    </>
                  }
                />
              ))}
            </Block>
          )}

          {outliers.length > 0 && (
            <Block id="check-outliers" title="Слишком крупные траты" hint="Больше любой другой траты категории за год и не меньше чем в 10 раз больше обычной: часто это лишний ноль.">
              {outliers.map((o) => {
                const name = o.note !== '' ? o.note : catName(o.categoryId);
                const ic = catIcon(o.categoryId);
                return (
                  <Row
                    key={o.key}
                    testId="check-outlier"
                    icon={<Glyph value={ic.icon} color={ic.color} size={32} />}
                    title={
                      <>
                        {name} — <MoneyText minor={o.amountMinor} currency={base} tone="expense" />
                      </>
                    }
                    text={`${formatDayLabel(o.occurredOn, today)} · в «${catName(o.categoryId)}» обычно около ${formatMinor(o.usualMinor, base)}`}
                    actions={
                      <>
                        {openLink(o.txId, 'Проверить сумму')}
                        {normal(o.key, name)}
                      </>
                    }
                  />
                );
              })}
            </Block>
          )}

          {negative.length > 0 && (
            <Block id="check-negative" title="Отрицательный остаток" hint="Деньги в кошельке не могут уйти в минус: возможно, не внесён доход или перевод. Если это кредитка, всё верно.">
              {negative.map((n) => (
                <Row
                  key={n.key}
                  testId="check-negative-item"
                  icon={<NoteIcon kind="neg" />}
                  title={
                    <>
                      {n.name}: <MoneyText minor={n.balanceMinor} currency={n.currency} tone="expense" />
                    </>
                  }
                  actions={
                    <>
                      <Link to={`/wallets/${n.walletId}`} className={buttonClasses('secondary', 'md')}>
                        Открыть кошелёк
                      </Link>
                      {normal(n.key, n.name)}
                    </>
                  }
                />
              ))}
            </Block>
          )}
        </div>
      )}
    </>
  );
}
