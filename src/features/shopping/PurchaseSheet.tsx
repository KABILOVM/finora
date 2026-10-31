import { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { ChipPicker } from '@/components/ChipPicker';
import { TextInput } from '@/components/Field';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { newId, useCategories, useSettings, useStore, useWallets, ValidationError } from '@/db';
import { pluralRu } from '@/lib/plural';
import { todayLocal } from '@/lib/dates';
import type { CurrencyCode, IsoDate, Minor } from '@/domain/types';
import { DayField } from '@/features/debts/DebtDates';
import { FieldGroup } from '@/features/transactions/FieldGroup';
import { rankCategories, rankWallets, usePopularity } from '@/features/transactions/popularity';
import { buildCategoryOptions } from '@/features/categories/categoryTree';
import { NOTE_MAX } from '@/features/transactions/txForm';
import { priceText } from './shoppingText';

export interface PurchaseSheetProps {
  totalMinor: Minor;
  count: number;
  currency: CurrencyCode;
  /** Категория прошлой покупки (или «Продукты») — выбрана заранее. */
  defaultCategoryId: string | null;
  onClose: () => void;
}

/**
 * «Подтвердить покупку»: ОДИН расход на сумму отмеченных позиций. Кошелёк и категория — самые частые из прошлых операций
 * (кошелёк обязан быть в основной валюте: цены списка в ней). Состав покупки сохраняется как «чек» расхода.
 */
export function PurchaseSheet({ totalMinor, count, currency, defaultCategoryId, onClose }: PurchaseSheetProps) {
  const store = useStore();
  const toast = useToast();
  const wallets = useWallets();
  const categories = useCategories('expense');
  const settings = useSettings();
  const pop = usePopularity();
  const [walletPick, setWalletPick] = useState<string | null>(null);
  const [categoryPick, setCategoryPick] = useState<string | null>(null);
  const [date, setDate] = useState<IsoDate>(() => todayLocal());
  const [note, setNote] = useState('Покупки');
  const [errors, setErrors] = useState<{ form?: string; note?: string; wallet?: string }>({});
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const txId = useRef(newId());

  if (wallets === undefined || categories === undefined || settings === undefined || pop === undefined) return null;

  const candidates = wallets.filter((w) => w.currency === currency);
  const walletChips = rankWallets(candidates, pop);
  // по умолчанию — самый частый кошелёк (при равенстве — по порядку, с «основным» кошельком настроек первым)
  const mainFirst = [...walletChips].sort((a, b) => (pop.wallets.get(b.id) ?? 0) - (pop.wallets.get(a.id) ?? 0) || Number(b.id === settings?.defaultWalletId) - Number(a.id === settings?.defaultWalletId));
  const walletId = walletChips.find((w) => w.id === walletPick)?.id ?? mainFirst[0]?.id ?? null;
  const categoryChips = rankCategories(categories, 'expense', pop);
  const categoryId = categoryChips.find((c) => c.id === categoryPick)?.id ?? categoryChips.find((c) => c.id === defaultCategoryId)?.id ?? categoryChips[0]?.id ?? null;

  const save = async () => {
    if (busy.current) return;
    if (walletId === null) return setErrors({ wallet: `Нет кошелька в валюте ${currency}` });
    if (note.trim().length > NOTE_MAX) return setErrors({ note: `Заметка не длиннее ${NOTE_MAX} символов` });
    busy.current = true;
    setSaving(true);
    setErrors({});
    try {
      await store.shopping.purchase({ walletId, categoryId, occurredOn: date, note: note.trim(), txId: txId.current });
      toast.success(`Покупка записана: ${priceText(totalMinor, currency)}`);
      onClose();
    } catch (e) {
      if (!(e instanceof ValidationError)) console.error('Не удалось записать покупку:', e);
      setErrors({ form: e instanceof ValidationError ? e.message : 'Не удалось записать покупку. Данные не изменены, попробуйте ещё раз.' });
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!saving}
      title="Подтвердить покупку"
      footer={
        <div className="flex flex-col gap-2">
          {errors.form && (
            <p role="alert" className="text-sm font-medium text-danger">
              {errors.form}
            </p>
          )}
          <Button size="lg" fullWidth loading={saving} disabled={walletId === null} onClick={() => void save()}>
            Записать расход
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-center">
          <span className="money block text-3xl font-bold text-expense">{priceText(totalMinor, currency)}</span>
          <span className="text-muted">
            {count} {pluralRu(count, 'позиция', 'позиции', 'позиций')} в корзине — запишется одним расходом
          </span>
        </p>

        <FieldGroup label="С какого кошелька" error={errors.wallet}>
          {walletChips.length === 0 ? (
            <p role="alert" className="text-sm font-medium text-warning">
              Нет кошелька в валюте {currency}: цены списка — в основной валюте. Создайте такой кошелёк на экране «Кошельки».
            </p>
          ) : (
            <ChipPicker ariaLabel="Кошелёк" value={walletId} onChange={setWalletPick} options={walletChips.map((w) => ({ value: w.id, label: w.name, icon: w.icon, color: w.color }))} />
          )}
        </FieldGroup>

        <FieldGroup label="Категория">
          <ChipPicker ariaLabel="Категория" value={categoryId} onChange={setCategoryPick} options={buildCategoryOptions(categoryChips)} />
        </FieldGroup>

        <DayField label="Дата покупки" value={date} onChange={setDate} />

        <TextInput label="Заметка" hint="Необязательно" value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" enterKeyHint="done" error={errors.note} />
      </div>
    </Sheet>
  );
}
