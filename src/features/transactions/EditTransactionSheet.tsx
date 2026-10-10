import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { useCategories, useSettings, useStore, useWallets } from '@/db';
import { formatMinor } from '@/domain/money';
import type { Category, LocalRow, Settings, Transaction, Wallet } from '@/domain/types';
import { humanError, toastWithUndo } from './txActions';
import { changedFields, formFromTx, GENERIC_SAVE_ERROR } from './txForm';
import { TxFormFields } from './TxFormFields';
import { useCloseDuplicateEntry } from './useCloseDuplicateEntry';
import { useScrollToError } from './useScrollToError';
import { useTxFormController } from './useTxFormController';

export interface EditTransactionSheetProps {
  /** id операции (UUID) */
  id: string;
  onClose: () => void;
}

const TITLE = 'Правка операции';

/**
 * Шит правки операции: те же поля, что при вводе, уже заполненные. Удаление — мягкое, с подтверждением и «Отменить».
 * Операции, которой нет или которая удалена, — понятное сообщение и закрытие.
 * Курс старой операции не пересчитывается: это делает репозиторий, форма курс не передаёт, если он не нужен.
 * В базу уходят только поля, которые человек изменил: чужая правка с другого устройства не откатывается.
 */
export default function EditTransactionSheet({ id, onClose }: EditTransactionSheetProps) {
  const store = useStore();
  const toast = useToast();
  const wallets = useWallets({ includeArchived: true });
  const categories = useCategories(undefined, { includeArchived: true });
  const settings = useSettings();
  // Обёртка в объект: «операции нет» (tx: null) отличается от «ещё читается» (undefined)
  const found = useLiveQuery(async () => ({ tx: (await store.db.transactions.get(id)) ?? null }), [store, id]);

  /** true: окно закрываем мы сами (сохранили или удалили) — сообщение «не найдена» не нужно. */
  const closing = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useCloseDuplicateEntry(onClose);

  const gone = found !== undefined && (found.tx === null || found.tx.deletedAt !== null);
  useEffect(() => {
    if (!gone || closing.current) return;
    toast.error('Операция не найдена: возможно, её уже удалили.');
    onCloseRef.current();
    // сообщение показываем один раз — при переходе в состояние «операции нет»
  }, [gone, toast]);

  if (!found || !wallets || !categories || settings === undefined) return null;

  if (gone) {
    if (closing.current) return null;
    return (
      <Sheet open onClose={onClose} title={TITLE}>
        <EmptyState
          icon="alert"
          title="Операция не найдена"
          text="Возможно, её уже удалили. Это окно закроется."
          action={<Button onClick={onClose}>Закрыть</Button>}
        />
      </Sheet>
    );
  }
  if (settings === null || found.tx === null) {
    return (
      <Sheet open onClose={onClose} title={TITLE}>
        <EmptyState icon="cloud" title="Данные ещё загружаются" text="Подождите немного и откройте операцию снова." />
      </Sheet>
    );
  }

  return (
    <EditForm
      key={found.tx.id}
      tx={found.tx}
      wallets={wallets}
      categories={categories}
      settings={settings}
      onClose={onClose}
      closing={closing}
    />
  );
}

interface EditFormProps {
  tx: LocalRow<Transaction>;
  wallets: readonly LocalRow<Wallet>[];
  categories: readonly LocalRow<Category>[];
  settings: LocalRow<Settings>;
  onClose: () => void;
  closing: { current: boolean };
}

function EditForm({ tx, wallets, categories, settings, onClose, closing }: EditFormProps) {
  const store = useStore();
  const toast = useToast();
  const formRef = useRef<HTMLDivElement>(null);
  // Исходная операция запоминается при открытии: если её тем временем обновит синхронизация, форма не «поплывёт».
  const [orig] = useState(tx);
  const [initial] = useState(() => formFromTx(orig, (wid) => wallets.find((w) => w.id === wid)?.currency));

  // Архивный кошелёк, в котором операция уже лежит, остаётся выбранным; новую операцию в архив внести нельзя
  const selectable = useMemo(
    () => wallets.filter((w) => w.archivedAt === null || w.id === orig.walletId || w.id === orig.toWalletId),
    [wallets, orig],
  );
  const c = useTxFormController({ mode: 'edit', initial, orig, wallets: selectable, allWallets: wallets, base: settings.baseCurrency });

  const kind = c.form.kind;
  const categoryOptions = useMemo(() => {
    if (kind === 'transfer') return [];
    return categories
      .filter((x) => x.kind === kind && (x.archivedAt === null || x.id === orig.categoryId))
      .map((x) => ({ value: x.id, label: x.archivedAt === null ? x.name : `${x.name} (в архиве)`, icon: x.icon }));
  }, [categories, kind, orig.categoryId]);

  useScrollToError(formRef, c.errors);

  const busyRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Сумма — первое, что правят: фокус на ней (после фокуса, который шит ставит сам)
  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>('input.money')?.focus({ preventScroll: true });
  }, []);

  const save = async () => {
    if (busyRef.current) return;
    const prepared = c.prepare();
    if (!prepared) return;
    busyRef.current = true;
    setSaving(true);
    closing.current = true;
    try {
      // Только изменённое против того, что человек видел при открытии. Ничего не менял — в базу не пишем.
      const patch = changedFields(prepared.input, orig);
      if (Object.keys(patch).length > 0) await store.transactions.update(tx.id, patch);
      toast.success('Сохранено');
      onClose();
    } catch (e) {
      closing.current = false;
      console.error('Не удалось сохранить правку:', e);
      c.fail(humanError(e, GENERIC_SAVE_ERROR));
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  };

  const remove = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setDeleting(true);
    closing.current = true;
    try {
      await store.transactions.softDelete(tx.id);
      toastWithUndo(toast, 'Операция удалена', () => store.transactions.restore(tx.id), 'Операция возвращена');
      onClose();
    } catch (e) {
      closing.current = false;
      console.error('Не удалось удалить операцию:', e);
      setConfirmOpen(false);
      c.fail(humanError(e, 'Не удалось удалить операцию. Ничего не изменилось — попробуйте ещё раз.'));
    } finally {
      busyRef.current = false;
      setDeleting(false);
    }
  };

  const busy = saving || deleting;
  const summary = (() => {
    const currency = wallets.find((w) => w.id === tx.walletId)?.currency ?? tx.baseCurrency;
    const what = tx.kind === 'expense' ? 'Расход' : tx.kind === 'income' ? 'Доход' : 'Перевод';
    return `${what} ${formatMinor(tx.amountMinor, currency)}`;
  })();

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        dismissible={!busy}
        title={TITLE}
        footer={
          <div className="flex flex-col gap-2">
            {c.errors.form && (
              <p role="alert" className="text-sm font-medium text-danger">
                {c.errors.form}
              </p>
            )}
            <div className="grid grid-cols-[auto_1fr] gap-2">
              <Button
                variant="ghost"
                size="lg"
                icon="trash"
                aria-label="Удалить операцию"
                className="!text-danger hover:!bg-danger/10"
                disabled={busy}
                onClick={() => setConfirmOpen(true)}
              >
                Удалить
              </Button>
              <Button size="lg" loading={saving} disabled={busy} onClick={() => void save()}>
                Сохранить
              </Button>
            </div>
          </div>
        }
      >
        <div ref={formRef}>
          <TxFormFields c={c} wallets={selectable} categories={categoryOptions} />
        </div>
      </Sheet>
      <ConfirmDialog
        open={confirmOpen}
        danger
        title="Удалить операцию?"
        message={`${summary}. Она пропадёт из списка, остатки пересчитаются. Сразу после удаления её можно вернуть кнопкой «Отменить».`}
        confirmLabel="Удалить"
        loading={deleting}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
