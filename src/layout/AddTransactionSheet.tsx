import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { newId, useCategories, useSettings, useStore, useWallets } from '@/db';
import type { Category, LocalRow, Settings, Wallet } from '@/domain/types';
import { humanError, toastWithUndo } from '@/features/transactions/txActions';
import { useRecentStats, type RecentStats } from '@/features/transactions/txData';
import { emptyForm, GENERIC_SAVE_ERROR, pickDefaultWallet, rankByCount } from '@/features/transactions/txForm';
import { TxFormFields } from '@/features/transactions/TxFormFields';
import { useCloseDuplicateEntry } from '@/features/transactions/useCloseDuplicateEntry';
import { useScrollToError } from '@/features/transactions/useScrollToError';
import { useTxFormController } from '@/features/transactions/useTxFormController';

export interface AddTransactionSheetProps {
  onClose: () => void;
}

const TITLE = 'Новая операция';

/**
 * Шит «Новая операция»: расход, доход или перевод. Расход вносится за 3–4 касания: сумма → категория → «Сохранить»;
 * кошелёк и дата подставляются сами. Работает без интернета.
 */
export default function AddTransactionSheet({ onClose }: AddTransactionSheetProps) {
  useCloseDuplicateEntry(onClose);
  const [statsVersion, setStatsVersion] = useState(0);
  const wallets = useWallets();
  const allWallets = useWallets({ includeArchived: true });
  const categories = useCategories();
  const settings = useSettings();
  const stats = useRecentStats(statsVersion);

  // Пока данные читаются (миллисекунды) шит не рисуем — иначе он «выезжал» бы дважды.
  if (!wallets || !allWallets || !categories || settings === undefined || !stats) return null;

  if (settings === null) {
    return (
      <Sheet open onClose={onClose} title={TITLE}>
        <EmptyState
          icon="cloud"
          title="Данные ещё загружаются"
          text="Подождите немного: после первой загрузки можно будет вносить операции."
        />
      </Sheet>
    );
  }
  if (wallets.length === 0) return <NoWalletSheet onClose={onClose} hasArchived={allWallets.length > 0} />;

  return (
    <AddForm
      onClose={onClose}
      wallets={wallets}
      categories={categories}
      settings={settings}
      stats={stats}
      onSaved={() => setStatsVersion((v) => v + 1)}
    />
  );
}

function NoWalletSheet({ onClose, hasArchived }: { onClose: () => void; hasArchived: boolean }) {
  const navigate = useNavigate();
  return (
    <Sheet open onClose={onClose} title={TITLE}>
      <EmptyState
        icon="wallet"
        title={hasArchived ? 'Все кошельки в архиве' : 'Сначала создайте кошелёк'}
        text={
          hasArchived
            ? 'Верните кошелёк из архива или создайте новый — тогда можно вносить операции.'
            : 'Деньги учитываются по кошелькам: например, «Наличные» или «Карта». Создайте первый — это занимает полминуты.'
        }
        action={
          <Button size="lg" onClick={() => navigate('/wallets', { replace: true })}>
            {hasArchived ? 'Открыть кошельки' : 'Создать кошелёк'}
          </Button>
        }
      />
    </Sheet>
  );
}

interface AddFormProps {
  onClose: () => void;
  wallets: readonly LocalRow<Wallet>[];
  categories: readonly LocalRow<Category>[];
  settings: LocalRow<Settings>;
  stats: RecentStats;
  onSaved: () => void;
}

function AddForm({ onClose, wallets, categories, settings, stats, onSaved }: AddFormProps) {
  const store = useStore();
  const toast = useToast();
  const formRef = useRef<HTMLDivElement>(null);

  const [initial] = useState(() =>
    emptyForm(pickDefaultWallet(wallets, stats.lastWalletId, settings.defaultWalletId)),
  );
  const c = useTxFormController({ mode: 'add', initial, wallets, allWallets: wallets, base: settings.baseCurrency });

  // Номер операции выдаётся при открытии: повторное нажатие или повтор после сбоя не создаст дубль.
  const idRef = useRef(newId());
  const savingRef = useRef(false);
  const [saving, setSaving] = useState<'close' | 'more' | null>(null);
  // Сохранили и закрываем: если шит на миг задержится на экране, второе «Сохранить» с тем же номером молча вернуло бы
  // старую операцию, а набранное потерялось бы. Поэтому после успешного «Сохранить» форму прячем сразу.
  const [finished, setFinished] = useState(false);

  const kind = c.form.kind;
  const categoryOptions = useMemo(() => {
    if (kind === 'transfer') return [];
    const ranked = rankByCount(
      categories.filter((x) => x.kind === kind),
      stats.counts[kind],
    );
    return ranked.map((x) => ({ value: x.id, label: x.name, icon: x.icon }));
  }, [categories, kind, stats]);

  useScrollToError(formRef, c.errors);

  const focusAmount = () => formRef.current?.querySelector<HTMLInputElement>('input.money')?.focus({ preventScroll: true });
  // Сумма — главное: фокус на ней (после фокуса, который шит ставит сам). На телефоне экранная клавиатура не появляется.
  useEffect(focusAmount, []);

  const save = async (again: boolean) => {
    if (savingRef.current) return; // второе нажатие, пока идёт сохранение
    const prepared = c.prepare();
    if (!prepared) return;
    savingRef.current = true;
    setSaving(again ? 'more' : 'close');
    try {
      const row = await store.transactions.create(prepared.input, { id: idRef.current });
      toastWithUndo(toast, 'Сохранено', () => store.transactions.softDelete(row.id), 'Операция отменена');
      onSaved();
      if (again) {
        idRef.current = newId();
        c.resetForNext();
        focusAmount();
      } else {
        setFinished(true);
        onClose();
      }
    } catch (e) {
      console.error('Не удалось сохранить операцию:', e);
      c.fail(humanError(e, GENERIC_SAVE_ERROR));
    } finally {
      savingRef.current = false;
      setSaving(null);
    }
  };

  return (
    <Sheet
      open={!finished}
      onClose={onClose}
      dismissible={saving === null}
      title={TITLE}
      footer={
        <div className="flex flex-col gap-2">
          {c.errors.form && (
            <p role="alert" className="text-sm font-medium text-danger">
              {c.errors.form}
            </p>
          )}
          <div className="grid grid-cols-[1fr_1.2fr] gap-2">
            <Button
              variant="secondary"
              size="lg"
              className="!text-sm leading-tight"
              loading={saving === 'more'}
              disabled={saving !== null}
              onClick={() => void save(true)}
            >
              Сохранить и добавить ещё
            </Button>
            <Button size="lg" loading={saving === 'close'} disabled={saving !== null} onClick={() => void save(false)}>
              Сохранить
            </Button>
          </div>
        </div>
      }
    >
      <div ref={formRef}>
        <TxFormFields c={c} wallets={wallets} categories={categoryOptions} />
      </div>
    </Sheet>
  );
}
