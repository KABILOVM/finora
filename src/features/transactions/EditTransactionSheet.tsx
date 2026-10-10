import { EmptyState } from '@/components/EmptyState';
import { Sheet } from '@/components/Sheet';

export interface EditTransactionSheetProps {
  /** id операции (UUID) */
  id: string;
  onClose: () => void;
}

// ЗАГЛУШКА-КОНТРАКТ: настоящий шит правки заменит этот файл (исполнитель модуля «ops»). default export + эти пропсы менять нельзя.
export default function EditTransactionSheet({ onClose }: EditTransactionSheetProps) {
  return (
    <Sheet open onClose={onClose} title="Правка операции">
      <EmptyState icon="edit" title="Скоро" text="Здесь будет правка операции." />
    </Sheet>
  );
}
