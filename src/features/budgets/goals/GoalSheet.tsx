import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AmountInput } from '@/components/AmountInput';
import { Button } from '@/components/Button';
import { ChipPicker } from '@/components/ChipPicker';
import { Field, inputClasses } from '@/components/Field';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { ValidationError, useStore } from '@/db';
import { endOfMonth } from '@/domain/forecast';
import type { CurrencyCode, IsoDate, LocalRow, Minor, SavingsGoal, Wallet } from '@/domain/types';
import { FieldGroup } from '@/features/transactions/FieldGroup';
import { DeleteGoalDialog } from './DeleteGoalDialog';
import { MAX_DATE, MIN_DATE } from '@/features/transactions/txForm';
import { UNDO_MS } from '@/features/transactions/txActions';
import { addDays, isValidIsoDate } from '@/lib/dates';
import { useToday } from '@/recurring/useToday';

/** Не длиннее — иначе название ломает строку списка (и репозиторий отклонит длиннее). */
export const GOAL_NAME_MAX = 60;

const NO_WALLET = '';

export interface GoalSheetProps {
  /** null — новая цель; иначе правка существующей. */
  goal: LocalRow<SavingsGoal> | null;
  /** Основная валюта: цель всегда в ней. */
  base: CurrencyCode;
  /** Кошельки-накопления не в архиве. */
  savingsWallets: readonly LocalRow<Wallet>[];
  /** Живые цели не в архиве: кошелёк, занятый другой целью, второй раз привязать нельзя. */
  goals: readonly LocalRow<SavingsGoal>[];
  onClose: () => void;
}

/** Быстрый выбор срока: конец месяца и несколько ближайших горизонтов. */
function dueChips(today: IsoDate): { value: string; label: string; date: IsoDate }[] {
  return [
    { value: 'month', label: 'Конец месяца', date: endOfMonth(today) },
    { value: '3m', label: 'Через 3 месяца', date: addDays(today, 90) },
    { value: '6m', label: 'Через полгода', date: addDays(today, 180) },
    { value: '12m', label: 'Через год', date: addDays(today, 365) },
  ];
}

/**
 * Новая цель накопления или правка: название, сумма, срок и (по желанию) кошелёк-накопление, остаток которого считается
 * накопленным. Деньги вводятся только через AmountInput. Цель всегда в основной валюте.
 */
export function GoalSheet({ goal, base, savingsWallets, goals, onClose }: GoalSheetProps) {
  const store = useStore();
  const toast = useToast();
  const today = useToday();
  const editing = goal !== null;
  const wrongCurrency = editing && goal.currency !== base;
  const [name, setName] = useState(editing ? goal.name : '');
  const [amount, setAmount] = useState<Minor | null>(editing && !wrongCurrency ? goal.targetMinor : null);
  const [dueOn, setDueOn] = useState<IsoDate>(editing ? goal.dueOn : addDays(today, 90));
  const [walletId, setWalletId] = useState<string>(editing ? (goal.walletId ?? NO_WALLET) : NO_WALLET);
  const [nameError, setNameError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [dueError, setDueError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const busy = useRef(false);

  // Свободные кошельки: в основной валюте и не привязанные к другой цели (свой текущий — можно)
  const wallets = useMemo(() => {
    const taken = new Set(goals.filter((g) => g.id !== goal?.id && g.walletId !== null).map((g) => g.walletId));
    return savingsWallets.filter((w) => w.currency === base && !taken.has(w.id));
  }, [savingsWallets, goals, goal?.id, base]);
  // Кошелёк, привязанный сейчас, мог уйти в архив или сменить валюту — показываем его, чтобы выбор не «пропал» молча
  const current = editing && goal.walletId !== null ? savingsWallets.find((w) => w.id === goal.walletId) : undefined;
  const walletOptions = current && !wallets.some((w) => w.id === current.id) ? [current, ...wallets] : wallets;

  const chips = dueChips(today);
  const picked = chips.find((c) => c.date === dueOn)?.value ?? null;

  const fail = (e: unknown, fallback: string) => {
    if (e instanceof ValidationError) setFormError(e.message);
    else {
      console.error(fallback, e);
      setFormError(`${fallback} Данные не изменены, попробуйте ещё раз.`);
    }
  };

  const save = async () => {
    if (busy.current) return;
    setFormError(null);
    const title = name.trim();
    let bad = false;
    if (title === '') {
      setNameError('Назовите цель, например «Отпуск»');
      bad = true;
    }
    if (amount === null || amount <= 0) {
      setAmountError('Введите сумму больше нуля');
      bad = true;
    }
    if (!isValidIsoDate(dueOn) || dueOn < MIN_DATE || dueOn > MAX_DATE) {
      setDueError('Укажите срок датой');
      bad = true;
    } else if (dueOn < today && (!editing || dueOn !== goal.dueOn)) {
      setDueError('Срок не может быть в прошлом');
      bad = true;
    }
    if (bad || amount === null) return;
    busy.current = true;
    setSaving(true);
    try {
      // валюту цели репозиторий берёт из настроек (основная валюта) при создании и при смене суммы — как у лимитов бюджета
      const input = { name: title, targetMinor: amount, dueOn, walletId: walletId === NO_WALLET ? null : walletId };
      if (editing) await store.savingsGoals.update(goal.id, input);
      else await store.savingsGoals.create(input);
      toast.success(editing ? 'Цель сохранена' : 'Цель добавлена');
      onClose();
    } catch (e) {
      fail(e, 'Не удалось сохранить цель.');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!editing || busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      const archived = await store.savingsGoals.archive(goal.id);
      toast.success(`Цель «${goal.name}» убрана в архив`, {
        durationMs: UNDO_MS,
        action: {
          label: 'Вернуть',
          onClick: () => {
            store.savingsGoals.restore(archived.id).catch((e: unknown) => {
              console.error('Не удалось вернуть цель:', e);
              toast.error('Не удалось вернуть цель. Её можно вернуть из архива на этом экране.');
            });
          },
        },
      });
      onClose();
    } catch (e) {
      fail(e, 'Не удалось убрать цель в архив.');
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
      title={editing ? 'Цель накопления' : 'Новая цель'}
      footer={
        <div className="flex flex-col gap-2">
          {formError && (
            <p role="alert" className="text-sm font-medium text-danger">
              {formError}
            </p>
          )}
          <Button size="lg" fullWidth loading={saving} onClick={() => void save()}>
            Сохранить
          </Button>
          {editing && (
            <Button variant="ghost" fullWidth disabled={saving} onClick={() => void archive()}>
              Убрать в архив
            </Button>
          )}
          {editing && (
            <Button variant="ghost" fullWidth className="text-danger" disabled={saving} onClick={() => setDeleting(true)}>
              Удалить цель
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <Field id="goal-name" label="Название" error={nameError}>
          <input
            id="goal-name"
            type="text"
            value={name}
            maxLength={GOAL_NAME_MAX}
            placeholder="Отпуск, ноутбук, подушка безопасности"
            autoComplete="off"
            aria-invalid={nameError ? true : undefined}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
              setFormError(null);
            }}
            className={`${inputClasses(nameError !== null)} min-h-[48px]`}
          />
        </Field>

        <div className="flex flex-col gap-1">
          <AmountInput
            label="Сколько накопить"
            currency={base}
            value={amount}
            error={amountError}
            showKeypad={false}
            onChange={(v) => {
              setAmount(v);
              setAmountError(null);
              setFormError(null);
            }}
          />
          <p className="text-center text-sm text-muted">
            {wrongCurrency
              ? `Раньше цель была в ${goal.currency}. Укажите сумму в ${base} — основной валюте сейчас.`
              : `Сумма в основной валюте (${base}): сколько должно накопиться к сроку.`}
          </p>
        </div>

        <FieldGroup label="Накопить к дате" error={dueError}>
          <ChipPicker
            ariaLabel="Быстрый выбор срока"
            value={picked}
            onChange={(v) => {
              const chip = chips.find((c) => c.value === v);
              if (chip) {
                setDueOn(chip.date);
                setDueError(null);
                setFormError(null);
              }
            }}
            options={chips.map((c) => ({ value: c.value, label: c.label }))}
          />
          <input
            type="date"
            aria-label="Накопить к дате: календарь"
            aria-invalid={dueError ? true : undefined}
            min={MIN_DATE}
            max={MAX_DATE}
            value={dueOn}
            onChange={(e) => {
              setDueOn(e.target.value);
              setDueError(null);
              setFormError(null);
            }}
            className={`${inputClasses(dueError !== null)} min-h-[48px]`}
          />
        </FieldGroup>

        <div className="flex flex-col gap-1.5">
          <Field id="goal-wallet" label="Где копите" hint="можно не указывать">
            <select id="goal-wallet" value={walletId} onChange={(e) => setWalletId(e.target.value)} className={`${inputClasses(false)} min-h-[48px]`}>
              <option value={NO_WALLET}>Не привязывать</option>
              {walletOptions.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.archivedAt === null ? w.name : `${w.name} (в архиве)`}
                </option>
              ))}
            </select>
          </Field>
          <p className="text-sm text-muted">
            Накоплено — это остаток выбранного кошелька «Накопления»: пополняйте его переводом, и прогресс цели обновится сам. Без кошелька приложение не
            видит, сколько уже отложено, и считает с нуля.
          </p>
          {wallets.length === 0 && (
            <p className="text-sm text-muted">
              Свободных кошельков «Накопления» в {base} нет. Завести его можно на экране{' '}
              <Link to="/wallets" className="font-semibold text-brand underline">
                Кошельки
              </Link>
              .
            </p>
          )}
        </div>
      </div>
      {editing && deleting && <DeleteGoalDialog goal={goal} onClose={() => setDeleting(false)} onDeleted={onClose} />}
    </Sheet>
  );
}
