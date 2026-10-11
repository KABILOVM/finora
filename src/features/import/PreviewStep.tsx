import { useState } from 'react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import type { ImportPlan, WalletChoice } from '@/import/types';
import { pluralRu } from '@/lib/plural';
import { AccountsBlock } from './AccountsBlock';
import { CategoriesBlock } from './CategoriesBlock';
import { opsWord } from './importText';
import { IssuesBlock } from './IssuesBlock';
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
        Отменить импорт одной кнопкой нельзя: добавленные операции придётся удалять по одной. Если сомневаетесь, сначала сделайте резервную копию
        (Настройки → Резервная копия).
      </p>
    </div>
  );
}

/** Шаги 2–3. Предпросмотр: счётчики, курсы, сопоставление счетов и категорий, первые операции, спорные строки. Затем подтверждение. */
export function PreviewStep({ plan, fileName, rateTexts, onRate, onChoose, onBack, onStart, error }: PreviewStepProps) {
  const [confirming, setConfirming] = useState(false);
  const n = plan.counts.add;
  const nothing = plan.ops.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <SummaryTiles plan={plan} fileName={fileName} />
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
      <AccountsBlock wallets={plan.wallets} onChoose={onChoose} />
      <CategoriesBlock categories={plan.categories} />
      <OpsPreview ops={plan.ops} />
      <IssuesBlock plan={plan} />

      <Card className="flex flex-col gap-3">
        {error && (
          <p role="alert" className="rounded-xl bg-danger/10 p-3 font-medium text-danger">
            {error}
          </p>
        )}
        <Button size="lg" icon="download" disabled={n === 0} onClick={() => setConfirming(true)}>
          {n === 0 ? 'Нечего импортировать' : `Импортировать ${n} ${opsWord(n)}`}
        </Button>
        <Button variant="secondary" onClick={onBack}>
          Выбрать другой файл
        </Button>
        <p className="text-sm text-muted">Резервную копию лучше сделать до импорта: Настройки → Резервная копия.</p>
      </Card>

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
