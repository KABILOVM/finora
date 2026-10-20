import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { Notice } from '@/components/Notice';
import type { Minor, UUID } from '@/domain/types';
import type { ImportPlan, WalletChoice } from '@/import/types';
import { pluralRu } from '@/lib/plural';
import { AccountsBlock } from './AccountsBlock';
import { CategoriesBlock } from './CategoriesBlock';
import { opsWord } from './importText';
import { walletImpacts } from './impact';
import { NotesBlock, ReviewBlock, SkippedBlock } from './IssuesBlock';
import { OpsPreview } from './OpsPreview';
import { RatesBlock } from './RatesBlock';
import { SummaryTiles } from './SummaryTiles';

export interface PreviewStepProps {
  plan: ImportPlan;
  fileName: string;
  rateTexts: Readonly<Record<string, string>>;
  onRate: (currency: string, text: string) => void;
  onChoose: (key: string, choice: WalletChoice) => void;
  onBack: () => void;
  onStart: () => void;
  /** Текст ошибки предыдущей попытки записи. */
  error: string | null;
  /** Текущие остатки кошельков: по ним показано, как импорт изменит остаток кошелька, найденного по названию. */
  balances?: ReadonlyMap<UUID, Minor>;
}

function confirmMessage(plan: ImportPlan) {
  const newWallets = plan.wallets.filter((w) => w.target.kind === 'create' && w.addCount > 0).length;
  const newCats = plan.categories.filter((c) => c.target.kind === 'create' && c.needed).length;
  const c = plan.counts;
  const skipped = c.review + c.waitRate + c.blocked;
  return (
    <div className="flex flex-col gap-2">
      <p>
        Будет добавлено: {c.add} {opsWord(c.add)}. Новых кошельков: {newWallets}, новых категорий: {newCats}.
      </p>
      {skipped > 0 && (
        <p>
          Не будет добавлено: {skipped} {pluralRu(skipped, 'строка', 'строки', 'строк')} (нужно проверить, ждут курса или нет кошелька).
        </p>
      )}
      <p>Уже добавленное повторно не добавится: загрузить тот же файл ещё раз безопасно.</p>
      <p>
        Отменить импорт одной кнопкой пока нельзя: добавленные операции придётся удалять по одной. Резервная копия импорт не откатит —
        загрузка копии добавляет данные и ничего не удаляет, поэтому проверьте список до нажатия.
      </p>
    </div>
  );
}

/**
 * Шаги 2–3. Предпросмотр. Сначала то, что требует решения (курсы, счета, спорные строки), потом справочное (категории, операции,
 * пропущенное). Кнопка «Импортировать» закреплена над нижней панелью: нажать её можно, не промотав весь список. Затем подтверждение.
 */
export function PreviewStep({ plan, fileName, rateTexts, onRate, onChoose, onBack, onStart, error, balances }: PreviewStepProps) {
  const [confirming, setConfirming] = useState(false);
  const n = plan.counts.add;
  const nothing = plan.ops.length === 0;
  const impacts = useMemo(() => walletImpacts(plan.ops), [plan.ops]);

  return (
    <div className="flex flex-col gap-5">
      <SummaryTiles plan={plan} fileName={fileName} onBack={onBack} />
      {nothing && (
        <Card>
          <EmptyState
            icon="info"
            title="Нет операций для добавления"
            text="В файле не нашлось строк, которые можно добавить. Причины — в списках ниже."
          />
        </Card>
      )}
      <RatesBlock needs={plan.rates} base={plan.baseCurrency} texts={rateTexts} onChange={onRate} />
      <AccountsBlock wallets={plan.wallets} onChoose={onChoose} balances={balances} impacts={impacts} />
      <NotesBlock notes={plan.notes} />
      <ReviewBlock review={plan.review} />
      <CategoriesBlock categories={plan.categories} />
      <OpsPreview plan={plan} />
      <SkippedBlock skipped={plan.skipped} />

      <p className="px-1 text-sm text-muted">
        Резервная копия сохранит данные на случай сбоя, но импорт не откатит.{' '}
        <Link to="/settings?section=data" className="font-semibold text-brand underline">
          Настройки → Резервная копия
        </Link>
        .
      </p>

      {error && <Notice tone="danger">{error}</Notice>}
      {/* Закреплена над нижней панелью телефона (её высота с отступом ≈ 5,5 rem); на ПК — у нижнего края окна */}
      <div
        data-testid="import-actions"
        className="sticky bottom-[calc(6rem+env(safe-area-inset-bottom))] z-20 rounded-card border border-border/70 bg-surface p-3 shadow-float md:bottom-4"
      >
        <Button size="lg" fullWidth icon="download" disabled={n === 0} onClick={() => setConfirming(true)}>
          {n === 0 ? 'Нечего импортировать' : `Импортировать ${n} ${opsWord(n)}`}
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        title={`Импортировать ${n} ${opsWord(n)}?`}
        message={confirmMessage(plan)}
        confirmLabel="Импортировать"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onStart();
        }}
      />
    </div>
  );
}
