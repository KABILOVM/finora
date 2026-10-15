import { Badge, type BadgeTone } from '@/components/Badge';
import { Glyph } from '@/components/Glyph';
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
  /** Цвет категории (#rrggbb): плитка значка подкрашивается им. */
  color?: string | null;
  /** Основная валюта сейчас: в ней посчитаны траты. */
  base: CurrencyCode;
  /** Нажатие на строку (правка лимита). Нет — строка без кнопки (виджет «Главной»). */
  onOpen?: () => void;
  /** Компактный вид для виджета: без суммы «из …» и без своих боковых отступов (их даёт карточка). */
  compact?: boolean;
  /** Подсказка о темпе («При таком темпе лимит закончится около 19 октября»): только в полном виде, в виджете её нет. */
  paceNote?: string | null;
}

function Head({
  icon,
  color,
  name,
  sub,
  right,
  rightClass,
  size,
}: {
  icon: string;
  color?: string | null;
  name: string;
  sub?: string;
  right?: string;
  rightClass?: string;
  size: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <Glyph value={icon} color={color ?? undefined} size={size} />
      <div className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{name}</span>
        {sub && <span className="money block truncate text-sm text-muted">{sub}</span>}
      </div>
      {right && <span className={cn('money shrink-0 text-lg font-bold tabular-nums', rightClass)}>{right}</span>}
    </div>
  );
}

/** Строка бюджета: название, полоса, «Потрачено N%», остаток или превышение, слово уровня. */
export function BudgetRow({ progress, name, icon, color, base, onOpen, compact = false, paceNote = null }: BudgetRowProps) {
  const size = compact ? 36 : 44;
  const body = !progress.comparable ? (
    <>
      <Head icon={icon} color={color} size={size} name={name} right={formatMinor(progress.limitMinor, progress.currency)} rightClass="!text-sm !font-medium text-muted" />
      <p className="mt-1 text-sm font-medium text-warning">
        Лимит задан в {progress.currency}, а основная валюта сейчас {base}. Укажите сумму заново.
      </p>
    </>
  ) : (
    <>
      <Head
        icon={icon}
        color={color}
        size={size}
        name={name}
        sub={compact ? undefined : `${formatMinor(progress.spentMinor, base)} из ${formatMinor(progress.limitMinor, base)}`}
        right={compact ? undefined : progress.percent > 999 ? '999%+' : `${progress.percent}%`}
        rightClass={LEVEL_TEXT[progress.level]}
      />
      <BudgetBar percent={progress.percent} level={progress.level} label={`${name}: ${spentWord(progress.percent)}`} className="mt-3" />
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
      {!compact && paceNote && (
        <p data-testid="budget-pace" className="mt-1 flex items-start gap-1.5 text-sm font-medium text-warning">
          <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
          <span>{paceNote}</span>
        </p>
      )}
    </>
  );

  if (!onOpen) return <div className={compact ? 'py-2.5' : 'px-4 py-3'}>{body}</div>;
  const label = progress.comparable ? `Лимит «${name}», ${spentWord(progress.percent)}. Изменить` : `Лимит «${name}». Изменить`;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      className="block min-h-[64px] w-full px-4 py-3.5 text-left transition-colors hover:bg-surface-2/70 active:bg-surface-2"
    >
      {body}
    </button>
  );
}
