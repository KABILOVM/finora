import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { AmountInput } from '@/components/AmountInput';
import { Button } from '@/components/Button';
import { ChipPicker } from '@/components/ChipPicker';
import { GlyphPicker } from '@/components/GlyphPicker';
import { Field, inputClasses, TextInput } from '@/components/Field';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { ValidationError, useStore } from '@/db';
import { CURRENCIES, currencyInfo } from '@/domain/currency';
import { formatMinor } from '@/domain/money';
import type { CurrencyCode, IsoDate, LocalRow, Minor, Wallet, WalletKind } from '@/domain/types';
import { endSentence } from '@/features/transactions/txDisplay';
import { addDays, isValidIsoDate, todayLocal } from '@/lib/dates';
import { BANKS, bankById, bankIcon } from './banks';
import { ColorSwatches } from './ColorSwatches';
import { GoalFields } from './GoalFields';
import { cleanName, COLOR_CHOICES, DEFAULT_ICON_BY_KIND, sameName, WALLET_KIND_LABELS, WALLET_KINDS } from './walletUi';

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
  /** Только при правке: открыть «Сверку» (из чего сложился остаток). */
  onReconcile?: () => void;
}

type FieldError = { field: 'name' | 'currency' | 'opening' | 'goal' | 'goalOn' | 'form'; message: string };

/** Срок цели по умолчанию, когда человек нажал «Указать срок»: через полгода. */
const DEFAULT_GOAL_DAYS = 180;

/** Виды, у которых выбирают банк. */
const BANK_KINDS: readonly WalletKind[] = ['card', 'bank'];

/** Что значит вид кошелька: одна строка под выбором. */
const KIND_HINTS: Record<WalletKind, string> = {
  cash: 'Деньги на руках.',
  card: 'Банковская карта: можно выбрать банк.',
  bank: 'Счёт или вклад в банке: можно выбрать банк.',
  savings: 'Копите на цель. Накопления не входят в «Можно тратить в день».',
  other: 'Всё остальное: электронный кошелёк, долги на руках и т. п.',
};

/** Создание и правка кошелька. */
export function WalletSheet({ wallet, defaultCurrency, otherNames, onClose, onArchive, onReconcile }: WalletSheetProps) {
  const store = useStore();
  const toast = useToast();
  const editing = wallet !== null;

  const [name, setName] = useState(wallet?.name ?? '');
  const [currency, setCurrency] = useState<CurrencyCode>(wallet?.currency ?? defaultCurrency);
  const [kind, setKind] = useState<WalletKind>(wallet?.kind ?? 'cash');
  const [icon, setIcon] = useState(wallet?.icon ?? DEFAULT_ICON_BY_KIND.cash);
  const [color, setColor] = useState(wallet?.color ?? COLOR_CHOICES[0]?.value ?? '#16a34a');
  // Банк (знак и цвет подставляются сами); null — обычный кошелёк.
  const [bankId, setBankId] = useState<string | null>(wallet?.icon.startsWith('b:') ? wallet.icon.slice(2) : null);
  // Ввод не умеет отрицательные суммы: у кошелька с отрицательным начальным остатком поле пустое, пока человек его не тронул.
  const [opening, setOpening] = useState<Minor | null>(wallet && wallet.openingBalanceMinor >= 0 ? wallet.openingBalanceMinor : null);
  const [openingTouched, setOpeningTouched] = useState(false);
  // Цель накопления (только для вида «Накопления»): сумма и необязательный срок.
  const [goal, setGoal] = useState<Minor | null>(wallet?.goalMinor ?? null);
  const [hasDue, setHasDue] = useState(wallet?.goalOn != null);
  const [dueOn, setDueOn] = useState<IsoDate>(wallet?.goalOn ?? addDays(todayLocal(), DEFAULT_GOAL_DAYS));
  const [error, setError] = useState<FieldError | null>(null);
  const [saving, setSaving] = useState(false);

  // Несохранённый ввод: у нового кошелька — имя, остаток, цель; у правки — любое отличие от того, что открыли.
  const typed = [name.trim(), opening?.toString() ?? '', goal?.toString() ?? ''];
  const snapshot = JSON.stringify(editing ? [...typed, currency, kind, icon, color, bankId, hasDue ? dueOn : null] : typed);
  const [baseline] = useState(snapshot);
  const dirty = snapshot !== baseline;

  // Валюта закреплена (операции, даже удалённые, или регулярные платежи): то же правило, что у хранилища. Пока ответа нет — считаем закреплённой.
  const locked = useLiveQuery(() => (wallet ? store.wallets.isCurrencyLocked(wallet.id) : false), [store, wallet?.id]);
  const currencyLocked = editing && locked !== false;
  // пояснение — только когда запрет подтверждён, иначе оно мигало бы на кадр при каждом открытии
  const lockedHint = locked === true;

  const currencyOptions = CURRENCIES.some((c) => c.code === currency)
    ? CURRENCIES
    : [...CURRENCIES, currencyInfo(currency)];

  const save = async () => {
    if (saving) return;
    const cleaned = cleanName(name);
    if (cleaned === '') return setError({ field: 'name', message: 'Введите название кошелька' });
    if (cleaned.length > 60) return setError({ field: 'name', message: 'Название не длиннее 60 символов' });
    if (otherNames.some((n) => sameName(n, cleaned))) {
      return setError({ field: 'name', message: 'Кошелёк с таким названием уже есть' });
    }
    // цель есть только у накоплений: при другом виде она очищается
    const wantGoal = kind === 'savings' ? goal : null;
    if (wantGoal !== null && wantGoal <= 0) return setError({ field: 'goal', message: 'Цель должна быть больше нуля' });
    const wantDue = wantGoal !== null && hasDue ? dueOn : null;
    if (wantDue !== null) {
      if (!isValidIsoDate(wantDue)) return setError({ field: 'goalOn', message: 'Укажите дату, к которой хотите накопить' });
      // уже прошедший срок можно оставить у старой цели, но новый ставить в прошлое незачем
      if (wantDue < todayLocal() && wantDue !== (wallet?.goalOn ?? null)) {
        return setError({ field: 'goalOn', message: 'Срок не может быть в прошлом' });
      }
    }
    setError(null);
    setSaving(true);
    try {
      if (!wallet) {
        await store.wallets.create({
          name: cleaned,
          currency,
          kind,
          openingBalanceMinor: opening ?? 0,
          color,
          icon,
          goalMinor: wantGoal,
          goalOn: wantDue,
        });
      } else {
        const patch: Parameters<typeof store.wallets.update>[1] = {};
        if (cleaned !== wallet.name) patch.name = cleaned;
        if (currency !== wallet.currency) patch.currency = currency;
        if (kind !== wallet.kind) patch.kind = kind;
        if (icon !== wallet.icon) patch.icon = icon;
        if (color !== wallet.color) patch.color = color;
        if (openingTouched && (opening ?? 0) !== wallet.openingBalanceMinor) patch.openingBalanceMinor = opening ?? 0;
        if (wantGoal !== (wallet.goalMinor ?? null)) patch.goalMinor = wantGoal;
        if (wantDue !== (wallet.goalOn ?? null)) patch.goalOn = wantDue;
        if (Object.keys(patch).length > 0) await store.wallets.update(wallet.id, patch);
      }
      toast.success(editing ? 'Кошелёк сохранён' : 'Кошелёк добавлен');
      onClose();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Не удалось сохранить кошелёк';
      if (e instanceof ValidationError) {
        const isCurrency = editing && wallet && currency !== wallet.currency && /валют/i.test(message);
        const field: FieldError['field'] = isCurrency
          ? 'currency'
          : /срок цели/i.test(message)
            ? 'goalOn'
            : /цель накопления/i.test(message)
              ? 'goal'
              : /остаток/i.test(message)
                ? 'opening'
                : 'form';
        setError({ field, message });
      } else {
        console.error('Не удалось сохранить кошелёк:', e);
        setError({ field: 'form', message: 'Не удалось сохранить кошелёк. Данные не изменены, попробуйте ещё раз.' });
      }
    } finally {
      setSaving(false);
    }
  };

  const pickBank = (id: string | null) => {
    setBankId(id);
    const bank = id ? bankById(id) : undefined;
    if (bank) {
      setIcon(bankIcon(bank.id));
      setColor(bank.color);
      // название подставляем, только если его не писали сами
      if (name.trim() === '' || BANKS.some((b) => b.name === name)) setName(bank.name);
    } else {
      setIcon(DEFAULT_ICON_BY_KIND[kind]);
    }
  };

  const err = (field: FieldError['field']) => (error?.field === field ? error.message : null);

  return (
    <Sheet
      open
      onClose={onClose}
      isDirty={dirty}
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
            <>
              <Button variant="ghost" fullWidth disabled={saving || dirty} onClick={onArchive}>
                Убрать в архив
              </Button>
              {dirty && <p className="text-center text-sm text-muted">Чтобы убрать в архив, сначала сохраните изменения.</p>}
            </>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Вид</span>
          <ChipPicker
            ariaLabel="Вид кошелька"
            value={kind}
            options={WALLET_KINDS.map((k) => ({ value: k, label: WALLET_KIND_LABELS[k] }))}
            onChange={(v) => {
              const next = v as WalletKind;
              if (bankId !== null && !BANK_KINDS.includes(next)) {
                // банк выбирают только у карты и счёта: уходя с них, возвращаем обычный значок
                setBankId(null);
                setIcon(DEFAULT_ICON_BY_KIND[next]);
              } else if (icon === DEFAULT_ICON_BY_KIND[kind]) {
                // значок подбираем сами, пока человек не выбрал свой
                setIcon(DEFAULT_ICON_BY_KIND[next]);
              }
              setKind(next);
            }}
          />
          <p className="text-sm text-muted">{KIND_HINTS[kind]}</p>
        </div>

        {BANK_KINDS.includes(kind) && (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">Банк</span>
            <ChipPicker
              ariaLabel="Банк"
              layout="scroll"
              value={bankId ?? 'none'}
              options={[...BANKS.map((b) => ({ value: b.id, label: b.name, icon: bankIcon(b.id) })), { value: 'none', label: 'Другой' }]}
              onChange={(v) => pickBank(v === 'none' ? null : v)}
            />
          </div>
        )}

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
          hint={lockedHint ? 'Валюту нельзя менять: по этому кошельку уже есть операции или регулярные платежи. Заведите новый кошелёк.' : undefined}
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

        {kind === 'savings' && (
          <GoalFields
            currency={currency}
            goal={goal}
            onGoal={(v) => {
              setGoal(v);
              setError(null);
            }}
            hasDue={hasDue}
            dueOn={dueOn}
            onDue={(p) => {
              if (p.hasDue !== undefined) setHasDue(p.hasDue);
              if (p.dueOn !== undefined) setDueOn(p.dueOn);
              setError(null);
            }}
            goalError={err('goal')}
            dueError={err('goalOn')}
          />
        )}

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
          {onReconcile && (
            <div className="mt-2 flex flex-col items-center gap-1">
              <Button variant="secondary" disabled={dirty || saving} onClick={onReconcile}>
                Сверка остатка
              </Button>
              <p className="text-center text-sm text-muted">
                {dirty ? 'Сначала сохраните изменения.' : 'Покажет, из чего сложился остаток: начальный остаток, доходы, расходы и переводы.'}
              </p>
            </div>
          )}
          {wallet && wallet.openingBalanceMinor < 0 && !openingTouched && (
            <p className="text-center text-sm text-warning">
              Сейчас начальный остаток отрицательный: {endSentence(formatMinor(wallet.openingBalanceMinor, wallet.currency))} Он не изменится, пока вы
              не введёте новое значение.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Значок</span>
          <GlyphPicker
            value={icon}
            color={color}
            onChange={(v) => {
              setBankId(null);
              setIcon(v);
            }}
            ariaLabel="Значок кошелька"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Цвет</span>
          <ColorSwatches value={color} onChange={setColor} ariaLabel="Цвет кошелька" />
        </div>
      </div>
    </Sheet>
  );
}
