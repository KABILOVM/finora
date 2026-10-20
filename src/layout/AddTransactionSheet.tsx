import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { IconButton } from '@/components/IconButton';
import { DictateExpensesSheet } from '@/features/dictation/DictateExpensesSheet';
import { listenToExpensesWithAi, parseExpensesWithAi } from '@/features/dictation/aiExpenses';
import { saveExpenses, validateAll } from '@/features/dictation/saveExpenses';
import { useRates } from '@/rates/hooks';
import { todayLocal } from '@/lib/dates';
import { EmptyState } from '@/components/EmptyState';
import { Sheet } from '@/components/Sheet';
import type { DictCategory } from '@/domain/expensesAi';
import { DateChip } from '@/features/transactions/DateChip';
import { useToast } from '@/components/Toast';
import { newId, useCategories, useSettings, useStore, useWallets } from '@/db';
import type { Category, LocalRow, Settings, Wallet } from '@/domain/types';
import { humanError, toastWithUndo } from '@/features/transactions/txActions';
import { useRecentStats, type RecentStats } from '@/features/transactions/txData';
import { emptyForm, futureDateNotice, GENERIC_SAVE_ERROR, isFormDirty, pickDefaultWallet, resolveDate } from '@/features/transactions/txForm';
import type { CategoryState } from '@/features/transactions/ContextRow';
import { rankCategories, rankWallets, usePopularity, type Popularity } from '@/features/transactions/popularity';
import { TxFormFields } from '@/features/transactions/TxFormFields';
import { useCloseDuplicateEntry } from '@/features/transactions/useCloseDuplicateEntry';
import { useScrollToError } from '@/features/transactions/useScrollToError';
import { useTxFormController } from '@/features/transactions/useTxFormController';

export interface AddTransactionSheetProps {
  onClose: () => void;
}

const TITLE = 'Новая операция';
/** Второе «Сохранить» раньше этого срока — дрожание пальца или двойной тап, а не решение обойтись без категории. */
const NUDGE_GRACE_MS = 350;

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
  // Порядок чипов считается один раз при открытии и не меняется, пока форма открыта
  const pop = usePopularity();

  // Пока данные читаются (миллисекунды) шит не рисуем — иначе он «выезжал» бы дважды.
  if (!wallets || !allWallets || !categories || settings === undefined || !stats || !pop) return null;

  if (settings === null) {
    return (
      <Sheet open onClose={onClose} history={false} title={TITLE}>
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
      pop={pop}
      onSaved={() => setStatsVersion((v) => v + 1)}
    />
  );
}

function NoWalletSheet({ onClose, hasArchived }: { onClose: () => void; hasArchived: boolean }) {
  const navigate = useNavigate();
  return (
    <Sheet open onClose={onClose} history={false} title={TITLE}>
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
  pop: Popularity;
  onSaved: () => void;
}

function AddForm({ onClose, wallets, categories, settings, stats, pop, onSaved }: AddFormProps) {
  const store = useStore();
  const toast = useToast();
  const formRef = useRef<HTMLDivElement>(null);

  // Быстрые кнопки главной («Расход», «Доход», «Перевод») открывают шит сразу на нужной вкладке.
  const presetKind = (useLocation().state as { kind?: string } | null)?.kind;
  const [initial] = useState(() =>
    emptyForm(
      pickDefaultWallet(wallets, stats.lastWalletId, settings.defaultWalletId),
      presetKind === 'income' || presetKind === 'transfer' ? presetKind : 'expense',
    ),
  );
  const { getRate } = useRates();
  const [dictating, setDictating] = useState(false);
  // Номера операций и новые категории из диктовки живут, пока открыт шит: повтор после сбоя не создаёт дублей.
  const dictation = useRef({ txIds: new Map<number, string>(), categories: [] as DictCategory[] });
  const expenseCategories = useMemo(
    () => categories.filter((x) => x.kind === 'expense').map((x) => ({ id: x.id, name: x.name, icon: x.icon, color: x.color })),
    [categories],
  );
  const c = useTxFormController({ mode: 'add', initial, wallets, allWallets: wallets, base: settings.baseCurrency });

  // Номер операции выдаётся при открытии: повторное нажатие или повтор после сбоя не создаст дубль.
  const idRef = useRef(newId());
  const savingRef = useRef(false);
  const [saving, setSaving] = useState<'close' | 'more' | null>(null);
  // Сохранили и закрываем: если шит на миг задержится на экране, второе «Сохранить» с тем же номером молча вернуло бы
  // старую операцию, а набранное потерялось бы. Поэтому после успешного «Сохранить» форму прячем сразу.
  const [finished, setFinished] = useState(false);
  // Категория не выбрана: при «Сохранить» напоминаем один раз (список откроется сам), дальше — как решит человек
  const [categoryState, setCategoryState] = useState<CategoryState>('untouched');
  const nudgedAt = useRef(0);
  // Дату в будущем уже подтвердили для этой даты (серия «Ещё одну» с той же датой не переспрашивает каждый раз)
  const futureConfirmed = useRef<string | null>(null);
  // Дата в будущем: спрашиваем «Сохранить?»; again — какой из двух кнопок сохраняли
  const [futureAsk, setFutureAsk] = useState<{ notice: string; again: boolean } | null>(null);

  const kind = c.form.kind;
  const categoryOptions = useMemo(() => {
    if (kind === 'transfer') return [];
    return rankCategories(categories, kind, pop).map((x) => ({ value: x.id, label: x.name, icon: x.icon, color: x.color }));
  }, [categories, kind, pop]);
  const walletsRanked = useMemo(() => rankWallets(wallets, pop), [wallets, pop]);

  useScrollToError(formRef, c.errors);
  // Другой вид операции — другие категории: прежнее решение про категорию не в счёт
  useEffect(() => setCategoryState('untouched'), [kind]);

  const focusAmount = () => formRef.current?.querySelector<HTMLInputElement>('input.money')?.focus({ preventScroll: true });
  // Сумма — главное: фокус на ней (после фокуса, который шит ставит сам). На телефоне экранная клавиатура не появляется.
  useEffect(focusAmount, []);

  const save = async (again: boolean, dateConfirmed = false) => {
    if (savingRef.current) return; // второе нажатие, пока идёт сохранение
    const prepared = c.prepare();
    if (!prepared) return;
    const { input } = prepared;
    if (input.kind !== 'transfer' && input.categoryId === null) {
      // Напоминаем один раз; сохранили после напоминания — человек решил обойтись без категории
      if (categoryState === 'untouched' && categoryOptions.length > 0) {
        nudgedAt.current = performance.now();
        setCategoryState('nudged');
        return;
      }
      if (categoryState === 'nudged') {
        if (performance.now() - nudgedAt.current < NUDGE_GRACE_MS) return; // человек ещё не успел прочитать напоминание
        setCategoryState('skipped');
      }
    }
    const notice = dateConfirmed || futureConfirmed.current === input.occurredOn ? null : futureDateNotice(input.occurredOn, todayLocal());
    if (notice) {
      setFutureAsk({ notice, again });
      return;
    }
    savingRef.current = true;
    setSaving(again ? 'more' : 'close');
    try {
      const row = await store.transactions.create(prepared.input, { id: idRef.current });
      prepared.rememberRate(); // курс, набранный руками, запоминаем только после успешного сохранения
      toastWithUndo(toast, 'Сохранено', () => store.transactions.softDelete(row.id), 'Операция отменена');
      onSaved();
      if (again) {
        idRef.current = newId();
        c.resetForNext();
        setCategoryState('untouched');
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

  if (dictating) {
    // один общий список: категории, созданные при сохранении, попадают в него и не дублируются при повторе
    const known = dictation.current.categories;
    for (const x of expenseCategories) if (!known.some((k) => k.id === x.id)) known.push(x);
    const ctx = () => ({
      store,
      wallets,
      categories: known,
      base: settings.baseCurrency,
      getRate,
      txIds: dictation.current.txIds,
    });
    return (
      <DictateExpensesSheet
        wallets={wallets}
        categories={[...known]}
        defaultWalletId={c.form.walletId ?? ''}
        today={todayLocal()}
        parse={(text, dctx, rid) => parseExpensesWithAi(text, dctx, rid)}
        listen={(rec, dctx, rid) => listenToExpensesWithAi(rec, dctx, rid)}
        validate={(drafts) => validateAll(drafts, ctx())}
        save={(drafts) => saveExpenses(drafts, ctx())}
        onClose={(saved) => {
          if (saved > 0) {
            toast.success(`Сохранено расходов: ${saved}`);
            onSaved();
            setFinished(true);
            onClose();
          } else setDictating(false);
        }}
      />
    );
  }

  return (
    <Sheet
      open={!finished}
      onClose={onClose}
      history={false}
      isDirty={isFormDirty(c.form, initial, false)}
      dismissible={saving === null}
      title={TITLE}
      headerAction={<DateChip c={c} />}
      footer={
        <div className="flex flex-col gap-2">
          {c.errors.form && (
            <p role="alert" className="text-sm font-medium text-danger">
              {c.errors.form}
            </p>
          )}
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button
              variant="secondary"
              size="lg"
              icon="plus"
              aria-label="Сохранить и добавить ещё одну"
              title="Сохранить и добавить ещё одну операцию (Ctrl+Enter)"
              loading={saving === 'more'}
              disabled={saving !== null}
              onClick={() => void save(true)}
            >
              Ещё одну
            </Button>
            <Button size="lg" loading={saving === 'close'} disabled={saving !== null} onClick={() => void save(false)}>
              Сохранить
            </Button>
          </div>
        </div>
      }
    >
      <div ref={formRef}>
        {/* Диктовка — круглая кнопка рядом с «Расход / Доход / Перевод»: отдельная строка под формой удлиняла окно */}
        <TxFormFields
          c={c}
          wallets={walletsRanked}
          categories={categoryOptions}
          categoryState={categoryState}
          onCategorySkip={() => setCategoryState('skipped')}
          onSubmit={(more) => void save(more)}
          kindAction={
            // Место под кнопку держим при любом виде: иначе «Доход» и «Перевод» прыгали бы при переключении
            <span className="h-11 w-11 shrink-0">
              {kind === 'expense' && <IconButton icon="mic" variant="secondary" label="Продиктовать расходы" onClick={() => {
                    setCategoryState((st) => (st === 'nudged' ? 'untouched' : st)); // напоминание не возвращается вместе с формой
                    setDictating(true);
                  }} />}
            </span>
          }
        />
      </div>
      <ConfirmDialog
        open={futureAsk !== null}
        title="Дата в будущем"
        message={futureAsk?.notice}
        confirmLabel="Сохранить"
        cancelLabel="Изменить дату"
        onCancel={() => setFutureAsk(null)}
        onConfirm={() => {
          const again = futureAsk?.again ?? false;
          futureConfirmed.current = resolveDate(c.form.date);
          setFutureAsk(null);
          void save(again, true);
        }}
      />
    </Sheet>
  );
}
