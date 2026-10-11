import type { TxView } from '@/features/transactions/txDisplay';

/** Значок платежа в кружке: значок категории (или стрелки перевода) на фоне цвета категории. */
export function RuleIcon({ view, size = 'md' }: { view: Pick<TxView, 'icon' | 'color'>; size?: 'md' | 'sm' }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full bg-surface-2 ${size === 'md' ? 'h-10 w-10 text-xl' : 'h-9 w-9 text-lg'}`}
      style={view.color ? { backgroundColor: `${view.color}26` } : undefined}
    >
      {view.icon}
    </span>
  );
}
