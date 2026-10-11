import { Badge, type BadgeTone } from '@/components/Badge';
import { Icon } from '@/components/Icon';
import type { BudgetLevel, BudgetProgress } from '@/domain/budgetProgress';
import { formatMinor } from '@/domain/money';
import type { CurrencyCode } from '@/domain/types';
import { cn } from '@/lib/cn';
import { BudgetBar, LEVEL_TEXT } from './BudgetBar';
import { levelWord, restWord, spentWord } from './budgetText';

const BADGE_TONE: Record<BudgetLevel, BadgeTone> = { ok: 'brand', warn: 'warning', danger: 'danger', over: 'danger' };

export interface BudgetRowProps {
  progress: BudgetProgress;
  name: string;
  icon: string;
  /** Основная валюта сейчас: в ней посчитаны траты. */
  base: CurrencyCode;
  /** Нажатие на строку (правка лимита). Нет — строка без кнопки (виджет «Главной»). */
  onOpen?: () => void;
  /** Компактный вид для виджета: без суммы «из …» и без своих боковых отступов (их даёт карточка). */
  compact?: boolean;
}

function Head({ icon, name, right }: { icon: string; name: string; right?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
      <span className="min-w-0 truncate font-semibold">
        <span aria-hidden="true">{icon} </span>
        {name}
      </span>
      {right && <span className="money shrink-0 text-sm text-muted">{right}</span>}
    </div>
  );
}

/** Строка бюджета: название, полоса, «Потрачено N%», остаток или превышение, слово уровня. */
export function BudgetRow({ progress, name, icon, base, onOpen, compact = false }: BudgetRowProps) {
  const body = !progress.comparable ? (
    <>
      <Head icon={icon} name={name} right={formatMinor(progress.limitMinor, progress.currency)} />
      <p className="mt-1 text-sm font-medium text-warning">
        Лимит задан в {progress.currency}, а основная валюта сейчас {base}. Укажите сумму заново.
      </p>
    </>
  ) : (
    <>
      <Head icon={icon} name={name} right={compact ? undefined : `${formatMinor(progress.spentMinor, base)} из ${formatMinor(progress.limitMinor, base)}`} />
      <BudgetBar percent={progress.percent} level={progress.level} label={`${name}: ${spentWord(progress.percent)}`} className="mt-2" />
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
        <span className="flex flex-wrap items-center gap-2">
          <span className={cn('font-semibold', LEVEL_TEXT[progress.level])}>{spentWord(progress.percent)}</span>
          {progress.level !== 'ok' && (
            <Badge tone={BADGE_TONE[progress.level]}>
              <Icon name="alert" size={12} />
              {levelWord(progress)}
            </Badge>
          )}
        </span>
        <span className={cn('money', progress.overMinor > 0 ? 'font-semibold text-danger' : 'text-muted')}>{restWord(progress, base)}</span>
      </div>
    </>
  );

  if (!onOpen) return <div className={compact ? 'py-2.5' : 'px-4 py-3'}>{body}</div>;
  const label = progress.comparable ? `Лимит «${name}», ${spentWord(progress.percent)}. Изменить` : `Лимит «${name}». Изменить`;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      className="block min-h-[56px] w-full px-4 py-3 text-left transition-colors hover:bg-surface-2 active:bg-border/60"
    >
      {body}
    </button>
  );
}
