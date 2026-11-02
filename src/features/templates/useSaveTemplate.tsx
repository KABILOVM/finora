import { useState, type ReactNode } from 'react';
import { useToast } from '@/components/Toast';
import { useStore } from '@/db';
import type { TxPrefill } from '@/features/transactions/prefill';
import { NameDialog } from './NameDialog';
import { useTemplates } from './templateStore';
import { suggestName, TEMPLATES_MAX } from './templates';

/**
 * «Сохранить как шаблон»: `ask(заготовка, название категории)` спрашивает название (предложение — заметка, категория или вид
 * операции) и кладёт заготовку в шаблоны этого устройства. Операцию саму не сохраняет и форму не закрывает. Окно с вопросом (`dialog`)
 * рисует тот, кто вызвал хук, на уровне формы: так оно переживает закрытие панели категорий, из которой его открыли.
 */
export function useSaveTemplate(): { ask: (prefill: TxPrefill, categoryName: string | null) => void; dialog: ReactNode } {
  const store = useStore();
  const toast = useToast();
  const { save } = useTemplates(store.userId);
  const [asking, setAsking] = useState<{ prefill: TxPrefill; suggestion: string } | null>(null);
  const dialog = (
    <NameDialog
      open={asking !== null}
      title="Название шаблона"
      initial={asking?.suggestion ?? ''}
      confirmLabel="Сохранить"
      onCancel={() => setAsking(null)}
      onConfirm={(name) => {
        if (!asking) return;
        const r = save(name, asking.prefill);
        setAsking(null);
        if (r.ok) toast.success(`Шаблон «${r.template.name}» сохранён`);
        else if (r.reason === 'limit') toast.error(`Шаблонов уже ${TEMPLATES_MAX}. Удалите ненужные: Операции → «⋯» → Шаблоны операций.`);
        else toast.error('Не получилось сохранить шаблон: проверьте сумму и счёт.');
      }}
    />
  );
  return { ask: (prefill, categoryName) => setAsking({ prefill, suggestion: suggestName(prefill, categoryName) }), dialog };
}
