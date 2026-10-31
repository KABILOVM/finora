import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { IconButton } from '@/components/IconButton';
import { DictateExpensesSheet } from '@/features/dictation/DictateExpensesSheet';
import { PurchasesRow } from '@/features/products/PurchasesRow';
import { PurchasesSheet } from '@/features/products/PurchasesSheet';
import { checkLines, isGroceryCategory, totalOfLines, type PurchaseLine } from '@/features/products/purchase';
import { parseReceiptWithAi, prepareReceiptImage } from '@/features/receipt/aiReceipt';
import { ReceiptSheet } from '@/features/receipt/ReceiptSheet';
import { saveReceipt, undoReceipt } from '@/features/receipt/saveReceipt';
import { checkReceipt } from '@/features/receipt/receiptAi';
import { listenToExpensesWithAi, parseExpensesWithAi } from '@/features/dictation/aiExpenses';
import { saveExpenses, validateAll } from '@/features/dictation/saveExpenses';
import { useSaveTemplate } from '@/features/templates/useSaveTemplate';
import { useTemplates } from '@/features/templates/templateStore';
import { resolveTemplate, type Template } from '@/features/templates/templates';
import { useActiveTrip } from '@/features/trips/activeTrip';
import { withTag } from '@/features/trips/trips';
import { useRates } from '@/rates/hooks';
import { addDays, isValidIsoDate, todayLocal } from '@/lib/dates';
import { EmptyState } from '@/components/EmptyState';
import { Sheet } from '@/components/Sheet';
import type { DictCategory } from '@/domain/expensesAi';
import { DateChip } from '@/features/transactions/DateChip';
import { useToast } from '@/components/Toast';
import { newId, useCategories, useSettings, useStore, useWallets } from '@/db';
import { formatMinor } from '@/domain/money';
import { pluralRu } from '@/lib/plural';
import type { Category, LocalRow, Settings, Wallet } from '@/domain/types';
import { humanError, toastWithUndo } from '@/features/transactions/txActions';
import { useRecentStats, type RecentStats } from '@/features/transactions/txData';
import type { FrequentChoice } from '@/features/transactions/FrequentPanel';
import { suggestNotes, useNoteIndex } from '@/features/transactions/noteSuggest';
import { parseQuickLine } from '@/features/transactions/quickLine';
import type { NoteChoice } from '@/features/transactions/NoteSuggestions';
import { formFromPrefill, prefillOfForm } from '@/features/transactions/prefill';
import { emptyForm, futureDateNotice, GENERIC_SAVE_ERROR, isFormDirty, MIN_DATE, NO_FEE, pickDefaultWallet, resolveDate, ruDate } from '@/features/transactions/txForm';
import type { CategoryState } from '@/features/transactions/ContextRow';
import { rankCategories, rankWallets, usePopularity, type Popularity } from '@/features/transactions/popularity';
import { TxFormFields } from '@/features/transactions/TxFormFields';
import { buildCategoryOptions } from '@/features/categories/categoryTree';
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
          <Button size="lg" onClick={() => {
              // все кошельки в архиве: показываем список (архив там можно раскрыть), а не форму нового кошелька поверх него
              if (hasArchived) navigate('/wallets', { replace: true });
              else navigate('/wallets?new=1', { replace: true });
            }}>
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
  // «Режим поездки»: пока он включён, новые операции получают метку поездки в заметке
  const trip = useActiveTrip(store.userId);
  const { templates } = useTemplates(store.userId);
  const saveTemplate = useSaveTemplate();
  const formRef = useRef<HTMLDivElement>(null);

  // Быстрые кнопки главной («Расход», «Доход», «Перевод») открывают шит сразу на нужной вкладке.
  const preset = useLocation().state as { kind?: string; walletId?: string; prefill?: unknown; date?: unknown } | null;
  const presetKind = preset?.kind;
  // Кнопки на экране кошелька открывают шит сразу с этим кошельком (если он ещё есть)
  const presetWallet = preset?.walletId && wallets.some((w) => w.id === preset.walletId) ? preset.walletId : null;
  const [initial] = useState(() => {
    const blank = emptyForm(
      presetWallet ?? pickDefaultWallet(wallets, stats.lastWalletId, settings.defaultWalletId),
      presetKind === 'income' || presetKind === 'transfer' ? presetKind : 'expense',
    );
    // «Внести траты» с «Главной» открывает форму сразу на пропущенном дне (вчера); дата проверяется: не в будущем и в допустимых границах
    const presetDate = typeof preset?.date === 'string' && isValidIsoDate(preset.date) && preset.date >= MIN_DATE && preset.date <= todayLocal() ? preset.date : null;
    const dated = presetDate === null ? blank : { ...blank, date: { mode: 'date' as const, value: presetDate } };
    // «Повторить» из правки операции: форма приходит заполненной (дата — сегодня), всё проверено против живых кошельков и категорий
    return preset?.prefill === undefined ? dated : formFromPrefill(preset.prefill, dated, wallets, categories);
  });
  const { getRate } = useRates();
  const [dictating, setDictating] = useState(false);
  const [receipting, setReceipting] = useState(false);
  // номера расходов «Чека по позициям» по ключу категории: повтор после сбоя не создаёт дублей
  const receiptIds = useRef(new Map<string, string>());
  // Номера операций и новые категории из диктовки живут, пока открыт шит: повтор после сбоя не создаёт дублей.
  const dictation = useRef({ txIds: new Map<number, string>(), categories: [] as DictCategory[], incomeCategories: [] as DictCategory[] });
  const expenseCategories = useMemo(
    () => categories.filter((x) => x.kind === 'expense').map((x) => ({ id: x.id, name: x.name, icon: x.icon, color: x.color })),
    [categories],
  );
  const incomeCategoriesList = useMemo(
    () => categories.filter((x) => x.kind === 'income').map((x) => ({ id: x.id, name: x.name, icon: x.icon, color: x.color })),
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

  // «Что куплено»: для расхода в «Продуктах» (и её подкатегориях) в кошельке основной валюты. Строки живут, пока открыт шит.
  const [lines, setLines] = useState<PurchaseLine[]>([]);
  const [purchasesOpen, setPurchasesOpen] = useState(false);
  const [lineErrors, setLineErrors] = useState<ReadonlyMap<number, string>>(new Map());
  const [focusRid, setFocusRid] = useState<number | null>(null);
  const base = settings.baseCurrency;
  const groceryNow = kind === 'expense' && isGroceryCategory(c.form.categoryId, categories);
  const walletNow = wallets.find((w) => w.id === c.form.walletId);
  const purchasesAvailable = groceryNow && walletNow !== undefined && walletNow.currency === base;
  const purchasesActive = purchasesAvailable && lines.length > 0;
  const linesTotal = purchasesActive ? totalOfLines(lines, base) : null;
  // Сумма операции — сумма продуктов; комиссии у такой покупки нет
  useEffect(() => {
    if (!purchasesActive) return;
    if (c.form.feeOpen) c.set({ ...NO_FEE });
    if (c.form.amountMinor !== linesTotal) c.set({ amountMinor: linesTotal });
  }, [purchasesActive, linesTotal]); // eslint-disable-line react-hooks/exhaustive-deps

  const categoryOptions = useMemo(() => {
    if (kind === 'transfer') return [];
    return buildCategoryOptions(rankCategories(categories, kind, pop));
  }, [categories, kind, pop]);
  const walletsRanked = useMemo(() => rankWallets(wallets, pop), [wallets, pop]);

  // «Частые операции»: только те, что можно внести сейчас (кошелёк и категория на месте, не в архиве)
  const frequent = useMemo(() => {
    const walletById = new Map(wallets.map((w) => [w.id, w]));
    const categoryById = new Map(categories.map((x) => [x.id, x]));
    const mixed = new Set(wallets.map((w) => w.currency)).size > 1;
    const out: { choice: FrequentChoice; op: RecentStats['frequent'][number] }[] = [];
    stats.frequent.forEach((op, i) => {
      const w = walletById.get(op.walletId);
      if (!w) return;
      const cat = op.categoryId === null ? undefined : categoryById.get(op.categoryId);
      if (op.categoryId !== null && (!cat || cat.archivedAt !== null || cat.kind !== op.kind)) return;
      const catName = cat?.name ?? 'Без категории';
      const times = `${op.count} ${pluralRu(op.count, 'раз', 'раза', 'раз')}`;
      out.push({
        op,
        choice: {
          key: String(i),
          title: op.note !== '' ? op.note : catName,
          subtitle: [op.note !== '' ? catName : null, mixed ? `${w.name} · ${w.currency}` : w.name, times].filter(Boolean).join(' · '),
          amount: formatMinor(op.amountMinor, w.currency),
          icon: cat?.icon ?? '🏷️',
          ...(cat ? { color: cat.color } : {}),
        },
      });
    });
    return out;
  }, [stats.frequent, wallets, categories]);
  // «Похожие записи» под полем заметки: по набранным буквам ищем, что вносилось с такой заметкой
  const noteIndex = useNoteIndex();
  const noteMatches = useMemo(() => {
    const walletById = new Map(wallets.map((w) => [w.id, w]));
    const categoryById = new Map(categories.map((x) => [x.id, x]));
    const mixed = new Set(wallets.map((w) => w.currency)).size > 1;
    const out: { choice: NoteChoice; e: ReturnType<typeof suggestNotes>[number] }[] = [];
    // берём с запасом: часть совпадений может не пройти (кошелёк или категория в архиве), а показать надо до трёх
    for (const e of suggestNotes(noteIndex, kind, c.form.note, 12)) {
      const w = walletById.get(e.walletId);
      if (!w) continue;
      const cat = e.categoryId === null ? undefined : categoryById.get(e.categoryId);
      if (e.categoryId !== null && (!cat || cat.archivedAt !== null || cat.kind !== e.kind)) continue;
      out.push({
        e,
        choice: {
          key: String(out.length),
          note: e.note,
          detail: [cat?.name ?? 'Без категории', mixed ? `${w.name} · ${w.currency}` : w.name].join(' · '),
          amount: formatMinor(e.amountMinor, w.currency),
          icon: cat?.icon ?? '🏷️',
          ...(cat ? { color: cat.color } : {}),
        },
      });
      if (out.length === 3) break;
    }
    return out;
  }, [noteIndex, kind, c.form.note, wallets, categories]);
  // «Ввод одной строкой»: «такси 20 карта» в заметке читается как сумма + кошелёк + категория (+ «вчера»); подставляется по нажатию
  const quickLine = useMemo(
    () =>
      parseQuickLine(c.form.note, {
        wallets,
        categories,
        noteIndex,
        kind,
        currentWalletId: c.form.walletId,
        today: todayLocal(),
      }),
    [c.form.note, wallets, categories, noteIndex, kind, c.form.walletId],
  );
  const quickChoice = useMemo((): NoteChoice | null => {
    if (!quickLine) return null;
    const w = wallets.find((x) => x.id === (quickLine.walletId ?? c.form.walletId));
    if (!w) return null;
    const cat = quickLine.categoryId === null ? undefined : categories.find((x) => x.id === quickLine.categoryId);
    const mixed = new Set(wallets.map((x) => x.currency)).size > 1;
    const today = todayLocal();
    // дата в строке задаётся только словами «сегодня / вчера / позавчера»: их же и показываем
    const when =
      quickLine.date === null ? null : quickLine.date === today ? 'сегодня' : quickLine.date === addDays(today, -1) ? 'вчера' : quickLine.date === addDays(today, -2) ? 'позавчера' : ruDate(quickLine.date);
    return {
      key: 'line',
      accent: true,
      note: quickLine.note !== '' ? quickLine.note : (cat?.name ?? 'Без заметки'),
      ...(when ? { tag: when } : {}),
      detail: [cat?.name ?? null, mixed ? `${w.name} · ${w.currency}` : w.name, when].filter(Boolean).join(' · '),
      amount: formatMinor(quickLine.amountMinor, w.currency),
      icon: cat?.icon ?? 'i:bolt',
      ...(cat ? { color: cat.color } : {}),
    };
  }, [quickLine, wallets, categories, c.form.walletId]);
  const pickLine = () => {
    if (!quickLine) return;
    if (quickLine.walletId !== null) c.setWallet(quickLine.walletId);
    c.set({
      note: quickLine.note,
      amountMinor: quickLine.amountMinor,
      ...(quickLine.categoryId !== null ? { categoryId: quickLine.categoryId } : {}),
      ...(quickLine.date !== null ? { date: { mode: 'date' as const, value: quickLine.date } } : {}),
    });
    if (quickLine.categoryId !== null) setCategoryState('untouched');
  };
  const pickNote = (key: string) => {
    if (key === 'line') return pickLine();
    const m = noteMatches.find((x) => x.choice.key === key)?.e;
    if (!m) return;
    c.setWallet(m.walletId);
    // сумму подставляем, только если она ещё не набрана: набранное человеком главнее подсказки
    c.set({ note: m.note, categoryId: m.categoryId, ...(c.form.amountMinor === null ? { amountMinor: m.amountMinor } : {}) });
    setCategoryState(m.categoryId === null ? 'skipped' : 'untouched');
  };
  // «Шаблоны»: именованные заготовки этого вида, которые можно внести сейчас; стоят в строке первыми
  const templateChoices = useMemo(() => {
    const mixed = new Set(wallets.map((w) => w.currency)).size > 1;
    const out: { choice: FrequentChoice; template: Template }[] = [];
    for (const t of templates) {
      if (t.prefill.kind === 'transfer') continue;
      const r = resolveTemplate(t, wallets, categories);
      if (!r) continue;
      out.push({
        template: t,
        choice: {
          key: `t:${t.id}`,
          template: true,
          title: t.name,
          subtitle: [r.category?.name ?? 'Без категории', mixed ? `${r.wallet.name} · ${r.wallet.currency}` : r.wallet.name, t.prefill.note !== '' ? t.prefill.note : null].filter(Boolean).join(' · '),
          amount: formatMinor(t.prefill.amountMinor, r.wallet.currency),
          icon: r.category?.icon ?? '🏷️',
          ...(r.category ? { color: r.category.color } : {}),
        },
      });
    }
    return out;
  }, [templates, wallets, categories]);
  const frequentForKind = useMemo(() => {
    const mine = templateChoices.filter((x) => x.template.prefill.kind === kind);
    // частая операция, которая уже есть шаблоном (тот же кошелёк, категория, сумма и заметка), второй раз не нужна
    const same = (op: RecentStats['frequent'][number]) =>
      mine.some(({ template: { prefill: p } }) => p.walletId === op.walletId && p.categoryId === op.categoryId && p.amountMinor === op.amountMinor && p.note === op.note);
    return [...mine.map((x) => x.choice), ...frequent.filter((f) => f.op.kind === kind && !same(f.op)).map((f) => f.choice)];
  }, [templateChoices, frequent, kind]);
  const pickFrequent = (key: string) => {
    const tpl = templateChoices.find((x) => x.choice.key === key)?.template;
    if (tpl) {
      c.setWallet(tpl.prefill.walletId);
      c.set({ categoryId: tpl.prefill.categoryId, amountMinor: tpl.prefill.amountMinor, note: tpl.prefill.note });
      setCategoryState(tpl.prefill.categoryId === null ? 'skipped' : 'untouched');
      return;
    }
    const f = frequent.find((x) => x.choice.key === key)?.op;
    if (!f) return;
    c.setWallet(f.walletId);
    c.set({ categoryId: f.categoryId, amountMinor: f.amountMinor, note: f.note });
    // у такой операции категории может не быть по выбору человека: второй раз напоминать о ней при «Сохранить» не нужно
    setCategoryState(f.categoryId === null ? 'skipped' : 'untouched');
  };

  useScrollToError(formRef, c.errors);
  // Другой вид операции — другие категории: прежнее решение про категорию не в счёт
  useEffect(() => setCategoryState('untouched'), [kind]);

  const focusAmount = () => formRef.current?.querySelector<HTMLInputElement>('input.money')?.focus({ preventScroll: true });
  // Сумма — главное: фокус на ней (после фокуса, который шит ставит сам). На телефоне экранная клавиатура не появляется.
  useEffect(focusAmount, []);

  const save = async (again: boolean, dateConfirmed = false) => {
    if (savingRef.current) return; // второе нажатие, пока идёт сохранение
    // Продукты проверяем раньше суммы: сумма берётся из них, и сказать надо про строку, а не про «Введите сумму»
    let receiptLines: ReturnType<typeof checkLines> | null = null;
    if (purchasesActive) {
      receiptLines = checkLines(lines, base);
      if (!receiptLines.ok) {
        setLineErrors(receiptLines.rid === null ? new Map() : new Map([[receiptLines.rid, receiptLines.message]]));
        setFocusRid(receiptLines.rid);
        setPurchasesOpen(true);
        return;
      }
    }
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
      const input = trip.tag === null ? prepared.input : { ...prepared.input, note: withTag(prepared.input.note ?? '', trip.tag) };
      // С продуктами расход и позиции пишутся одним чеком (одна запись базы): цены потом видны в «Продуктах»
      const row =
        receiptLines?.ok === true
          ? (
              await store.shopping.recordReceipt({
                walletId: input.walletId,
                categoryId: input.categoryId ?? null,
                occurredOn: input.occurredOn,
                note: input.note ?? '',
                txId: idRef.current,
                lines: receiptLines.lines,
              })
            ).transaction
          : await store.transactions.create(input, { id: idRef.current });
      prepared.rememberRate(); // курс, набранный руками, запоминаем только после успешного сохранения
      toastWithUndo(toast, trip.tag === null ? 'Сохранено' : `Сохранено · #${trip.tag}`, () => store.transactions.softDelete(row.id), 'Операция отменена');
      onSaved();
      if (again) {
        idRef.current = newId();
        setLines([]);
        setLineErrors(new Map());
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

  if (dictating || receipting) {
    // один общий список: категории, созданные при сохранении, попадают в него и не дублируются при повторе
    const known = dictation.current.categories;
    for (const x of expenseCategories) if (!known.some((k) => k.id === x.id)) known.push(x);
    const knownIncome = dictation.current.incomeCategories;
    for (const x of incomeCategoriesList) if (!knownIncome.some((k) => k.id === x.id)) knownIncome.push(x);
    const ctx = () => ({
      store,
      wallets,
      categories: known,
      incomeCategories: knownIncome,
      base: settings.baseCurrency,
      getRate,
      txIds: dictation.current.txIds,
      tripTag: trip.tag,
    });
    if (receipting) {
      return (
        <ReceiptSheet
          wallets={wallets}
          base={settings.baseCurrency}
          categories={[...known]}
          defaultWalletId={c.form.walletId ?? ''}
          today={todayLocal()}
          analyze={async (file, rctx, rid) => parseReceiptWithAi(await prepareReceiptImage(file), rctx, rid)}
          save={(draft, walletId) => saveReceipt(draft, checkReceipt(draft, settings.baseCurrency), { store, walletId, categories: known, txIds: receiptIds.current, tripTag: trip.tag })}
          undo={(created) => undoReceipt(store, created)}
          onClose={(saved) => {
            if (saved > 0) {
              onSaved();
              setFinished(true);
              onClose();
            } else setReceipting(false);
          }}
        />
      );
    }
    return (
      <DictateExpensesSheet
        wallets={wallets}
        categories={[...known]}
        incomeCategories={[...knownIncome]}
        defaultWalletId={c.form.walletId ?? ''}
        today={todayLocal()}
        parse={(text, dctx, rid) => parseExpensesWithAi(text, dctx, rid)}
        listen={(rec, dctx, rid) => listenToExpensesWithAi(rec, dctx, rid)}
        validate={(drafts) => validateAll(drafts, ctx())}
        save={(drafts) => saveExpenses(drafts, ctx())}
        onReceipt={() => {
          setDictating(false);
          setReceipting(true);
        }}
        onClose={(saved) => {
          if (saved > 0) {
            toast.success(`Сохранено операций: ${saved}`);
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
      isDirty={isFormDirty(c.form, initial, false) || lines.length > 0}
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
          frequent={frequentForKind}
          onPickFrequent={pickFrequent}
          // «Сохранить как шаблон» живёт в панели категорий (под полями форме места нет): появляется, когда набрана сумма
          {...(c.form.amountMinor !== null && c.form.amountMinor > 0 && c.form.walletId
            ? {
                onSaveTemplate: () =>
                  saveTemplate.ask(prefillOfForm(c.form, c.fee.minor), categories.find((x) => x.id === c.form.categoryId)?.name ?? null),
              }
            : {})}
          noteSuggestions={quickChoice ? [quickChoice, ...noteMatches.map((m) => m.choice)] : noteMatches.map((m) => m.choice)}
          onPickNote={pickNote}
          amountLocked={purchasesActive}
          purchases={
            groceryNow ? (
              <PurchasesRow
                lines={lines}
                currency={base}
                onOpen={() => {
                  setLineErrors(new Map());
                  setFocusRid(null);
                  setPurchasesOpen(true);
                }}
                {...(purchasesAvailable ? {} : { unavailable: `Продукты по строкам вносятся в основной валюте (${base}): выберите кошелёк в ${base}, если хотите записать, что куплено.` })}
              />
            ) : undefined
          }
          kindAction={
            // Место под кнопку держим при любом виде: иначе «Доход» и «Перевод» прыгали бы при переключении
            <span className="h-11 w-11 shrink-0">
              <IconButton icon="mic" variant="secondary" label="Продиктовать операции" onClick={() => {
                setCategoryState((st) => (st === 'nudged' ? 'untouched' : st)); // напоминание не возвращается вместе с формой
                setDictating(true);
              }} />
            </span>
          }
        />
      </div>
      {saveTemplate.dialog}
      {purchasesOpen && purchasesAvailable && (
        <PurchasesSheet lines={lines} onChange={setLines} currency={base} focusRid={focusRid} errors={lineErrors} onClose={() => setPurchasesOpen(false)} />
      )}
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
