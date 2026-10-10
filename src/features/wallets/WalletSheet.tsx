import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { AmountInput } from '@/components/AmountInput';
import { Button } from '@/components/Button';
import { ChipPicker } from '@/components/ChipPicker';
import { EmojiPicker } from '@/components/EmojiPicker';
import { Field, inputClasses, TextInput } from '@/components/Field';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { ValidationError, useStore } from '@/db';
import { CURRENCIES, currencyInfo } from '@/domain/currency';
import { formatMinor } from '@/domain/money';
import type { CurrencyCode, LocalRow, Minor, Wallet, WalletKind } from '@/domain/types';
import { ColorSwatches } from './ColorSwatches';
import { COLOR_CHOICES, DEFAULT_ICON_BY_KIND, sameName, WALLET_KIND_LABELS, WALLET_KINDS } from './walletUi';

export interface WalletSheetProps {
  /** null — создаём новый кошелёк. */
  wallet: LocalRow<Wallet> | null;
  /** Валюта по умолчанию для нового кошелька (базовая валюта пользователя). */
  defaultCurrency: CurrencyCode;
  /** Названия остальных кошельков (чтобы не завести два одинаковых). */
  otherNames: readonly string[];
  onClose: () => void;
  /** Только при правке: убрать кошелёк в архив (подтверждение показывает вызывающий экран). */
  onArchive?: () => void;
}

type FieldError = { field: 'name' | 'currency' | 'opening' | 'form'; message: string };

/** Создание и правка кошелька. */
export function WalletSheet({ wallet, defaultCurrency, otherNames, onClose, onArchive }: WalletSheetProps) {
  const store = useStore();
  const toast = useToast();
  const editing = wallet !== null;

  const [name, setName] = useState(wallet?.name ?? '');
  const [currency, setCurrency] = useState<CurrencyCode>(wallet?.currency ?? defaultCurrency);
  const [kind, setKind] = useState<WalletKind>(wallet?.kind ?? 'cash');
  const [icon, setIcon] = useState(wallet?.icon ?? DEFAULT_ICON_BY_KIND.cash);
  const [color, setColor] = useState(wallet?.color ?? COLOR_CHOICES[0]?.value ?? '#16a34a');
  // Ввод не умеет отрицательные суммы: у кошелька с отрицательным начальным остатком поле пустое, пока человек его не тронул.
  const [opening, setOpening] = useState<Minor | null>(wallet && wallet.openingBalanceMinor >= 0 ? wallet.openingBalanceMinor : null);
  const [openingTouched, setOpeningTouched] = useState(false);
  const [error, setError] = useState<FieldError | null>(null);
  const [saving, setSaving] = useState(false);

  // По кошельку есть операции (даже удалённые): валюту менять нельзя, иначе суммы поменяют смысл.
  const hasOperations = useLiveQuery(async () => {
    if (!wallet) return false;
    const { transactions } = store.db;
    return (
      (await transactions.where('walletId').equals(wallet.id).count()) > 0 ||
      (await transactions.where('toWalletId').equals(wallet.id).count()) > 0
    );
  }, [store, wallet?.id]);
  const currencyLocked = editing && hasOperations === true;

  const currencyOptions = CURRENCIES.some((c) => c.code === currency)
    ? CURRENCIES
    : [...CURRENCIES, currencyInfo(currency)];

  const save = async () => {
    if (saving) return;
    const cleanName = name.trim();
    if (cleanName === '') return setError({ field: 'name', message: 'Введите название кошелька' });
    if (cleanName.length > 60) return setError({ field: 'name', message: 'Название не длиннее 60 символов' });
    if (otherNames.some((n) => sameName(n, cleanName))) {
      return setError({ field: 'name', message: 'Кошелёк с таким названием уже есть' });
    }
    setError(null);
    setSaving(true);
    try {
      if (!wallet) {
        await store.wallets.create({
          name: cleanName,
          currency,
          kind,
          openingBalanceMinor: opening ?? 0,
          color,
          icon,
        });
      } else {
        const patch: Parameters<typeof store.wallets.update>[1] = {};
        if (cleanName !== wallet.name) patch.name = cleanName;
        if (currency !== wallet.currency) patch.currency = currency;
        if (kind !== wallet.kind) patch.kind = kind;
        if (icon !== wallet.icon) patch.icon = icon;
        if (color !== wallet.color) patch.color = color;
        if (openingTouched && (opening ?? 0) !== wallet.openingBalanceMinor) patch.openingBalanceMinor = opening ?? 0;
        if (Object.keys(patch).length > 0) await store.wallets.update(wallet.id, patch);
      }
      toast.success(editing ? 'Кошелёк сохранён' : 'Кошелёк добавлен');
      onClose();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Не удалось сохранить кошелёк';
      if (e instanceof ValidationError) {
        const isCurrency = editing && wallet && currency !== wallet.currency && /валют/i.test(message);
        setError({ field: isCurrency ? 'currency' : /остаток/i.test(message) ? 'opening' : 'form', message });
      } else {
        console.error('Не удалось сохранить кошелёк:', e);
        setError({ field: 'form', message: 'Не удалось сохранить кошелёк. Данные не изменены, попробуйте ещё раз.' });
      }
    } finally {
      setSaving(false);
    }
  };

  const err = (field: FieldError['field']) => (error?.field === field ? error.message : null);

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!saving}
      title={editing ? 'Правка кошелька' : 'Новый кошелёк'}
      footer={
        <div className="flex flex-col gap-2">
          {err('form') && (
            <p role="alert" className="text-sm font-medium text-danger">
              {err('form')}
            </p>
          )}
          <Button size="lg" fullWidth loading={saving} onClick={() => void save()}>
            Сохранить
          </Button>
          {onArchive && (
            <Button variant="ghost" fullWidth disabled={saving} onClick={onArchive}>
              Убрать в архив
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <TextInput
          label="Название"
          value={name}
          maxLength={60}
          placeholder="Например, Наличные"
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
          error={err('name')}
          data-autofocus
        />

        <Field
          id="wallet-currency"
          label="Валюта"
          hint={currencyLocked ? 'Валюту нельзя менять: по этому кошельку уже есть операции. Заведите новый кошелёк.' : undefined}
          error={err('currency')}
        >
          <select
            id="wallet-currency"
            value={currency}
            disabled={currencyLocked}
            onChange={(e) => {
              setCurrency(e.target.value);
              setError(null);
            }}
            className={`${inputClasses(error?.field === 'currency')} min-h-[48px]`}
          >
            {currencyOptions.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Вид</span>
          <ChipPicker
            ariaLabel="Вид кошелька"
            value={kind}
            options={WALLET_KINDS.map((k) => ({ value: k, label: WALLET_KIND_LABELS[k] }))}
            onChange={(v) => {
              const next = v as WalletKind;
              // значок подбираем сами, пока человек не выбрал свой
              if (icon === DEFAULT_ICON_BY_KIND[kind]) setIcon(DEFAULT_ICON_BY_KIND[next]);
              setKind(next);
            }}
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold">Начальный остаток</span>
          <AmountInput
            label="Начальный остаток"
            currency={currency}
            value={opening}
            showKeypad={false}
            error={err('opening')}
            onChange={(v) => {
              setOpening(v);
              setOpeningTouched(true);
              setError(null);
            }}
          />
          <p className="text-center text-sm text-muted">
            Сколько денег уже лежало в кошельке до начала учёта. Дальше остаток считается сам.
          </p>
          {wallet && wallet.openingBalanceMinor < 0 && !openingTouched && (
            <p className="text-center text-sm text-warning">
              Сейчас начальный остаток отрицательный: {formatMinor(wallet.openingBalanceMinor, wallet.currency)}. Он не изменится, пока вы
              не введёте новое значение.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Значок</span>
          <EmojiPicker value={icon} onChange={setIcon} ariaLabel="Значок кошелька" />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Цвет</span>
          <ColorSwatches value={color} onChange={setColor} ariaLabel="Цвет кошелька" />
        </div>
      </div>
    </Sheet>
  );
}
