import { Glyph } from '@/components/Glyph';
import type { TxView } from '@/features/transactions/txDisplay';

/** Значок платежа: значок категории («i:…» или эмодзи) на плитке цвета категории; без категории — значок вида платежа. */
export function RuleIcon({ view, size = 'md' }: { view: Pick<TxView, 'icon' | 'color'>; size?: 'md' | 'sm' }) {
  return <Glyph value={view.icon} color={view.color ?? undefined} size={size === 'md' ? 40 : 36} />;
}
