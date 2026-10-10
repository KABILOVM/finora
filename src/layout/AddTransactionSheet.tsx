import { EmptyState } from '@/components/EmptyState';
import { Sheet } from '@/components/Sheet';

export interface AddTransactionSheetProps {
  onClose: () => void;
}

/**
 * ЗАГЛУШКА шита «Новая операция». Настоящий шит (AmountInput + Segmented + категории + кошелёк)
 * заменит этот файл или будет подключён в App.tsx вместо него; контракт — default export с пропсом onClose.
 */
export default function AddTransactionSheet({ onClose }: AddTransactionSheetProps) {
  return (
    <Sheet open onClose={onClose} title="Новая операция">
      <EmptyState icon="plus" title="Скоро" text="Здесь будет быстрый ввод расхода, дохода и перевода." />
    </Sheet>
  );
}
