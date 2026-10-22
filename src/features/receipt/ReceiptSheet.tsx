import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Field, inputClasses, TextInput } from '@/components/Field';
import { MoneyText } from '@/components/MoneyText';
import { Notice } from '@/components/Notice';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import type { DictCategory } from '@/domain/expensesAi';
import { checkReceipt, emptyLine, MERCHANT_MAX, type ReceiptContext, type ReceiptDraft } from '@/features/receipt/receiptAi';
import type { CurrencyCode, IsoDate, LocalRow, Transaction, Wallet } from '@/domain/types';
import { toastWithUndo } from '@/features/transactions/txActions';
import { pluralRu } from '@/lib/plural';
import { ReceiptLinesEditor } from './ReceiptLinesEditor';

export interface ReceiptSheetProps {
  /** Живые кошельки; для чека берутся только кошельки в основной валюте (цены чека — в ней). */
  wallets: readonly LocalRow<Wallet>[];
  base: CurrencyCode;
  /** Категории расходов. */
  categories: readonly DictCategory[];
  defaultWalletId: string;
  today: IsoDate;
  /** Распознать фото чека (облачная функция с ИИ). Бросает Error с понятным текстом. */
  analyze: (file: File, ctx: ReceiptContext, firstRid: number) => Promise<ReceiptDraft>;
  /** Записать чек: расходы по категориям и их позиции. Возвращает созданные расходы. */
  save: (draft: ReceiptDraft, walletId: string) => Promise<LocalRow<Transaction>[]>;
  /** Отменить записанное (расходы убираются). */
  undo: (created: readonly LocalRow<Transaction>[]) => Promise<void>;
  /** Закрыть окно. saved — сколько расходов записано. */
  onClose: (saved: number) => void;
}

/**
 * «Чек по позициям»: фотография чека (или ввод вручную) → список позиций с ценой и категорией → на каждую категорию один расход,
 * а сами позиции видны в «Чеке» расхода. Так один поход в магазин ложится на «Продукты», «Быт» и «Здоровье» по-честному. Всё можно
 * поправить до сохранения; сверка с итогом на чеке показывает, не пропала ли позиция. «Отменить» после сохранения убирает все расходы чека.
 */
export function ReceiptSheet({ wallets, base, categories, defaultWalletId, today, analyze, save, undo, onClose }: ReceiptSheetProps) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const nextRid = useRef(1);
  const busy = useRef(false);
  const [stage, setStage] = useState<'start' | 'analyzing' | 'edit'>('start');
  const [draft, setDraft] = useState<ReceiptDraft | null>(null);
  const [walletId, setWalletId] = useState('');
  const [openRid, setOpenRid] = useState<number | null>(null);
  const [errors, setErrors] = useState<ReadonlyMap<number, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const usable = useMemo(() => wallets.filter((w) => w.currency === base && w.archivedAt === null && w.deletedAt === null), [wallets, base]);
  const wallet = usable.find((w) => w.id === walletId) ?? usable.find((w) => w.id === defaultWalletId) ?? usable[0] ?? null;
  const ctx: ReceiptContext = useMemo(() => ({ categories, today, currency: base }), [categories, today, base]);
  const check = useMemo(() => (draft ? checkReceipt(draft, base) : null), [draft, base]);

  const begin = (d: ReceiptDraft) => {
    nextRid.current += d.lines.length;
    setErrors(new Map());
    setDraft(d);
    setStage('edit');
  };

  const manual = () => {
    setError(null);
    const line = emptyLine(nextRid.current++);
    setDraft({ merchant: '', date: today, totalText: '', lines: [line] });
    setOpenRid(line.rid);
    setStage('edit');
  };

  const onFile = async (file: File | undefined) => {
    if (!file || busy.current) return;
    busy.current = true;
    setError(null);
    setStage('analyzing');
    try {
      const d = await analyze(file, ctx, nextRid.current);
      if (d.lines.length === 0) {
        setStage('start');
        setError('Не удалось прочитать позиции. Снимите чек ближе и ровнее, без бликов, или введите его вручную.');
        return;
      }
      begin(d);
    } catch (e) {
      setStage('start');
      setError(e instanceof Error && e.message ? e.message : 'Не удалось разобрать чек. Попробуйте ещё раз.');
    } finally {
      busy.current = false;
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const addLine = () => {
    if (!draft) return;
    const line = emptyLine(nextRid.current++);
    setDraft({ ...draft, lines: [...draft.lines, line] });
    setOpenRid(line.rid);
  };

  const submit = async () => {
    if (busy.current || !draft || !check || !wallet) return;
    setErrors(check.errors);
    if (check.errors.size > 0) {
      setError(`Исправьте ${check.errors.size} ${pluralRu(check.errors.size, 'позицию', 'позиции', 'позиций')}: ошибки отмечены красным.`);
      return;
    }
    if (check.error) {
      setError(check.error);
      return;
    }
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const created = await save(draft, wallet.id);
      const n = created.length;
      toastWithUndo(toast, `Чек записан: ${n} ${pluralRu(n, 'расход', 'расхода', 'расходов')}`, () => undo(created), 'Чек отменён');
      onClose(n);
    } catch (e) {
      console.error('Не удалось записать чек:', e);
      setError(e instanceof Error && e.message ? e.message : 'Не удалось записать чек. Попробуйте ещё раз.');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const groups = check?.groups ?? [];
  const nameOf = (g: (typeof groups)[number]): string => (g.categoryId ? (categories.find((c) => c.id === g.categoryId)?.name ?? 'Категория') : g.newCategory !== '' ? `${g.newCategory} · новая` : 'Без категории');

  return (
    <Sheet
      open
      onClose={() => onClose(0)}
      dismissible={!saving && stage !== 'analyzing'}
      isDirty={stage === 'edit'}
      title="Чек по позициям"
      footer={
        stage === 'edit' && draft ? (
          <div className="flex flex-col gap-2">
            {error && (
              <p role="alert" className="text-sm font-medium text-danger">
                {error}
              </p>
            )}
            <Button size="lg" fullWidth loading={saving} disabled={!wallet} onClick={() => void submit()}>
              {groups.length > 0 ? `Сохранить ${groups.length} ${pluralRu(groups.length, 'расход', 'расхода', 'расходов')}` : 'Сохранить'}
            </Button>
          </div>
        ) : undefined
      }
    >
      <input ref={fileInput} type="file" accept="image/*" hidden data-testid="receipt-file" onChange={(e) => void onFile(e.target.files?.[0])} />

      {stage === 'start' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            Сфотографируйте чек или выберите снимок из галереи: приложение прочитает позиции и разложит их по категориям, а вы проверите.
            На каждую категорию — свой расход.
          </p>
          {error && (
            <Notice tone="danger" role="alert">
              {error}
            </Notice>
          )}
          <Button size="lg" icon="upload" fullWidth onClick={() => fileInput.current?.click()}>
            Сфотографировать чек
          </Button>
          <Button size="lg" icon="list" variant="secondary" fullWidth onClick={manual}>
            Ввести вручную
          </Button>
        </div>
      )}

      {stage === 'analyzing' && (
        <p role="status" aria-busy="true" className="py-10 text-center text-muted">
          Читаю чек… это может занять до полминуты
        </p>
      )}

      {stage === 'edit' && draft && check && (
        <div className="flex flex-col gap-3">
          {usable.length === 0 && (
            <Notice tone="warning" role="alert">
              Нет кошелька в основной валюте ({base}): чек вносится в ней. Создайте такой кошелёк в «Кошельках».
            </Notice>
          )}
          <Field id="receipt-wallet" label="Чем заплатили">
            <select id="receipt-wallet" value={wallet?.id ?? ''} onChange={(e) => setWalletId(e.target.value)} className={`${inputClasses(false)} min-h-[48px]`}>
              {usable.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <TextInput label="Магазин" value={draft.merchant} maxLength={MERCHANT_MAX} placeholder="Необязательно" onChange={(e) => setDraft({ ...draft, merchant: e.target.value })} wrapperClassName="min-w-0" />
            <TextInput label="Дата" type="date" value={draft.date} max={today} onChange={(e) => e.target.value !== '' && setDraft({ ...draft, date: e.target.value as IsoDate })} wrapperClassName="min-w-0" />
          </div>

          <section aria-label="Позиции чека">
            <h3 className="mb-1 text-sm font-semibold text-muted">Позиции · нажмите, чтобы поправить</h3>
            <ReceiptLinesEditor lines={draft.lines} onChange={(lines) => setDraft({ ...draft, lines })} categories={categories} currency={base} errors={errors} openRid={openRid} onOpenChange={setOpenRid} />
            <Button variant="ghost" icon="plus" className="mt-1" onClick={addLine}>
              Добавить позицию
            </Button>
          </section>

          <section aria-label="Итог чека" data-testid="receipt-summary" className="rounded-2xl bg-surface-2/70 px-3 py-2 text-sm">
            <p>
              Сумма позиций: {check.sumMinor !== null ? <MoneyText minor={check.sumMinor} currency={base} tone="none" className="font-bold" /> : <span className="text-muted">—</span>}
              {check.totalMinor !== null && (
                <>
                  {' '}
                  · на чеке: <MoneyText minor={check.totalMinor} currency={base} tone="none" className="font-bold" />
                </>
              )}
            </p>
            {check.diffMinor !== null && check.diffMinor !== 0 && (
              <p role="status" className="mt-1 font-medium text-warning" data-testid="receipt-diff">
                {check.diffMinor > 0 ? 'Позиций не хватает на ' : 'Позиции больше итога на '}
                <MoneyText minor={Math.abs(check.diffMinor)} currency={base} tone="none" />: {check.diffMinor > 0 ? 'добавьте пропущенную позицию или поправьте цены.' : 'проверьте цены и лишние позиции.'}
              </p>
            )}
            {check.diffMinor === 0 && <p className="mt-1 font-medium text-income">Сумма сходится с чеком</p>}
            {groups.length > 0 && (
              <ul className="mt-2 flex flex-col gap-0.5" aria-label="Будет записано">
                {groups.map((g) => (
                  <li key={g.key} data-testid="receipt-group" className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate">{nameOf(g)}</span>
                    <span className="shrink-0 font-semibold">
                      <MoneyText minor={-g.totalMinor} currency={base} tone="expense" />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Sheet>
  );
}
