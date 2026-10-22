import { Link } from 'react-router-dom';
import { Button, buttonClasses } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { MoneyText } from '@/components/MoneyText';
import { useSettings, useStore } from '@/db';
import type { IsoDate } from '@/domain/types';
import { monthTitle } from '@/lib/dates';
import { useDismissedKeys } from '@/lib/dismissedKeys';
import { useAddLink } from '@/layout/nav';
import { useRemainderSuggestion } from './saveRemainder';

/** Вид подсказок для «Не сейчас» (на этом устройстве). */
export const SAVE_NAMESPACE = 'save-remainder';

/**
 * «Отложить остаток» на «Главной» в первые дни месяца: «За сентябрь 2026 осталось 1 200 с. Отложить в «Отпуск»?». «Отложить» открывает
 * форму «Новая операция» с готовым переводом (сумму можно поправить), «Не сейчас» убирает предложение этого месяца на этом устройстве.
 */
export default function SaveRemainderCard({ today }: { today: IsoDate }) {
  const store = useStore();
  const settings = useSettings();
  const suggestion = useRemainderSuggestion(today);
  const { hidden, dismiss } = useDismissedKeys(SAVE_NAMESPACE, store.userId);
  const link = useAddLink(
    'transfer',
    suggestion?.from.id,
    undefined,
    suggestion
      ? { kind: 'transfer', walletId: suggestion.from.id, toWalletId: suggestion.to.id, amountMinor: suggestion.amountMinor, categoryId: null, note: '' }
      : undefined,
  );
  if (!suggestion || !settings) return null;
  const key = `save:${suggestion.month}`;
  if (hidden.has(key)) return null;
  const base = settings.baseCurrency;
  return (
    <section aria-labelledby="home-save" data-testid="save-remainder" className="slide-down">
      <Card padding="none" className="p-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-income/15 text-income">
            <Icon name="wallet" size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="home-save" className="text-base font-semibold">
              За {monthTitle(suggestion.month).toLowerCase()} осталось <MoneyText minor={suggestion.netMinor} currency={base} tone="income" />
            </h2>
            <p className="text-sm text-muted">
              Отложить <MoneyText minor={suggestion.amountMinor} currency={base} tone="none" className="font-semibold text-text" /> в «{suggestion.to.name}»? Из «{suggestion.from.name}».
            </p>
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Link {...link} className={`${buttonClasses('primary', 'md')} min-w-[9rem] flex-1`}>
            Отложить
          </Link>
          <Button variant="ghost" aria-label="Не откладывать в этом месяце" className="min-w-[9rem] flex-1" onClick={() => dismiss(key)}>
            Не сейчас
          </Button>
        </div>
      </Card>
    </section>
  );
}
