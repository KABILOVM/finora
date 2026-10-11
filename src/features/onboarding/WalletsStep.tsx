import { useRef, useState } from 'react';
import { AmountInput } from '@/components/AmountInput';
import { Card } from '@/components/Card';
import { ChipPicker } from '@/components/ChipPicker';
import { Button } from '@/components/Button';
import { Field, inputClasses, TextInput } from '@/components/Field';
import { Glyph } from '@/components/Glyph';
import { IconButton } from '@/components/IconButton';
import { MoneyText } from '@/components/MoneyText';
import { useToast } from '@/components/Toast';
import { useSettings, useStore, useWallets, ValidationError } from '@/db';
import { CURRENCIES, currencyInfo } from '@/domain/currency';
import type { CurrencyCode, LocalRow, Minor, Wallet, WalletKind } from '@/domain/types';
import { sameName, WALLET_KIND_LABELS, WALLET_KINDS } from '@/features/wallets/walletUi';
import { addWalletOnce, editWallet, removeWallet, type WalletDraft } from './onboardingActions';
import { canAdvance, freeSuggestions } from './onboardingLogic';
import { WizardFrame } from './WizardFrame';

/** Шаг 2: кошельки. Стартовый «Наличные» уже есть — показываем его, как и всё заведённое; добавляем и убираем лишнее. */
export function WalletsStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const store = useStore();
  const toast = useToast();
  const settings = useSettings();
  const wallets = useWallets();
  const base = settings?.baseCurrency ?? 'TJS';

  const [name, setName] = useState('');
  const [kind, setKind] = useState<WalletKind>('card');
  const [currency, setCurrency] = useState<CurrencyCode | null>(null);
  const [opening, setOpening] = useState<Minor | null>(null);
  const [editing, setEditing] = useState<LocalRow<Wallet> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const list = wallets ?? [];
  const cur = currency ?? base;
  const suggestions = freeSuggestions(list.map((w) => w.name));
  const options = CURRENCIES.some((c) => c.code === cur) ? CURRENCIES : [...CURRENCIES, currencyInfo(cur)];

  const draft = (): WalletDraft => ({ name, kind, currency: cur, openingBalanceMinor: opening ?? 0 });
  const reset = () => {
    setName('');
    setKind('card');
    setCurrency(null);
    setOpening(null);
    setEditing(null);
    setError(null);
  };

  /** Одно действие за раз: двойной тап не отправит запись дважды. */
  const guarded = async (action: () => Promise<void>): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      await action();
      return true;
    } catch (e) {
      if (e instanceof ValidationError) setError(e.message);
      else {
        console.error('Не удалось сохранить кошелёк:', e);
        setError('Не удалось сохранить кошелёк. Данные не изменены, попробуйте ещё раз.');
      }
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const save = () =>
    guarded(async () => {
      if (editing) {
        await editWallet(store, editing, draft());
        toast.success('Кошелёк сохранён');
      } else {
        const r = await addWalletOnce(store, draft());
        if (r.status === 'exists') throw new ValidationError('Кошелёк с таким названием уже есть');
      }
      reset();
    });

  const startEdit = (w: LocalRow<Wallet>) => {
    setEditing(w);
    setName(w.name);
    setKind(w.kind);
    setCurrency(w.currency);
    setOpening(w.openingBalanceMinor >= 0 ? w.openingBalanceMinor : null);
    setError(null);
  };

  const remove = (w: LocalRow<Wallet>) =>
    void guarded(async () => {
      await removeWallet(store, w);
      if (editing?.id === w.id) reset();
    });

  /** «Дальше»: если название вписано, но «Добавить» не нажали, добавляем кошелёк сами (без дубля) и идём дальше. */
  const next = async () => {
    if (name.trim() !== '' && editing === null) {
      const ok = await guarded(async () => {
        await addWalletOnce(store, draft());
      });
      if (!ok) return;
      reset();
    }
    onNext();
  };

  const canGo = canAdvance('wallets', list.length) || name.trim() !== '';

  return (
    <WizardFrame
      step="wallets"
      title="Ваши кошельки"
      lead="Где лежат ваши деньги: наличные, карта, накопления."
      onBack={onBack}
      onNext={() => void next()}
      nextDisabled={!canGo || wallets === undefined || busy}
      note={!canGo ? 'Добавьте хотя бы один кошелёк.' : null}
    >
      {list.length > 0 && (
        <ul aria-label="Заведённые кошельки" className="flex flex-col gap-2">
          {list.map((w) => (
            <li key={w.id}>
              <Card padding="none" className="flex items-center gap-2 py-1 pl-3 pr-1">
                <Glyph value={w.icon} color={w.color} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold">{w.name}</p>
                  <p className="text-sm text-muted">
                    {!sameName(w.name, WALLET_KIND_LABELS[w.kind]) && `${WALLET_KIND_LABELS[w.kind]} · `}
                    <MoneyText minor={w.openingBalanceMinor} currency={w.currency} />
                  </p>
                </div>
                <IconButton icon="edit" label={`Изменить «${w.name}»`} onClick={() => startEdit(w)} disabled={busy} />
                <IconButton icon="trash" label={`Убрать «${w.name}»`} onClick={() => remove(w)} disabled={busy} />
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Card className="flex flex-col gap-3">
        <h2 className="text-base font-bold">{editing ? `Правка: ${editing.name}` : 'Добавить кошелёк'}</h2>
        {!editing && suggestions.length > 0 && (
          <ChipPicker
            ariaLabel="Быстрый выбор"
            layout="wrap"
            value={null}
            options={suggestions.map((s) => ({ value: s.name, label: s.name }))}
            onChange={(v) => {
              const s = suggestions.find((x) => x.name === v);
              if (!s) return;
              setName(s.name);
              setKind(s.kind);
              setError(null);
            }}
          />
        )}
        <TextInput
          label="Название"
          value={name}
          maxLength={60}
          autoComplete="off"
          placeholder="Например, Карта"
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          error={error}
        />
        <div className="grid grid-cols-2 gap-2">
          <Field id="onb-kind" label="Тип">
            <select id="onb-kind" value={kind} onChange={(e) => setKind(e.target.value as WalletKind)} className={`${inputClasses(false)} min-h-[48px]`}>
              {WALLET_KINDS.map((k) => (
                <option key={k} value={k}>
                  {WALLET_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field id="onb-wallet-currency" label="Валюта">
            <select
              id="onb-wallet-currency"
              value={cur}
              onChange={(e) => setCurrency(e.target.value)}
              className={`${inputClasses(false)} min-h-[48px]`}
            >
              {options.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div>
          <span className="text-sm font-semibold">Сколько денег там сейчас</span>
          <AmountInput label="Начальный остаток" currency={cur} value={opening} showKeypad={false} onChange={setOpening} className="!gap-0" />
        </div>
        <div className="flex gap-2">
          {editing && (
            <Button variant="secondary" onClick={reset} disabled={busy}>
              Отмена
            </Button>
          )}
          <Button variant="secondary" fullWidth loading={busy} disabled={name.trim() === ''} onClick={() => void save()} icon={editing ? 'check' : 'plus'}>
            {editing ? 'Сохранить' : 'Добавить кошелёк'}
          </Button>
        </div>
      </Card>
    </WizardFrame>
  );
}
