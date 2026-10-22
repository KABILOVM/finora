import { useState } from 'react';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
import { useStore } from '@/db';
import type { TxPrefill } from '@/features/transactions/prefill';
import { NameDialog } from './NameDialog';
import { useTemplates } from './templateStore';
import { suggestName, TEMPLATES_MAX } from './templates';

export interface SaveTemplateButtonProps {
  /** Что сохранить: заготовка из формы; null — формы ещё мало для шаблона (нет суммы или кошелька), кнопки нет. */
  prefill: TxPrefill | null;
  /** Название категории — для предложения названия. */
  categoryName: string | null;
}

/**
 * «Сохранить как шаблон» внизу формы операции: спрашивает название (предложение — заметка, категория или вид операции) и кладёт
 * заготовку в шаблоны этого устройства. Операцию саму не сохраняет и форму не закрывает.
 */
export function SaveTemplateButton({ prefill, categoryName }: SaveTemplateButtonProps) {
  const store = useStore();
  const toast = useToast();
  const { save } = useTemplates(store.userId);
  const [asking, setAsking] = useState<TxPrefill | null>(null);
  if (!prefill && !asking) return null;
  return (
    <>
      {prefill && (
        <Button variant="ghost" icon="star" fullWidth className="mt-2" onClick={() => setAsking(prefill)}>
          Сохранить как шаблон
        </Button>
      )}
      <NameDialog
        open={asking !== null}
        title="Название шаблона"
        initial={asking ? suggestName(asking, categoryName) : ''}
        confirmLabel="Сохранить"
        onCancel={() => setAsking(null)}
        onConfirm={(name) => {
          if (!asking) return;
          const r = save(name, asking);
          setAsking(null);
          if (r.ok) toast.success(`Шаблон «${r.template.name}» сохранён`);
          else if (r.reason === 'limit') toast.error(`Шаблонов уже ${TEMPLATES_MAX}. Удалите ненужные: Настройки → Шаблоны операций.`);
          else toast.error('Не получилось сохранить шаблон: проверьте сумму и счёт.');
        }}
      />
    </>
  );
}
