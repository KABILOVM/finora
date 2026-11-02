import { ValidationError, type Store } from '@/db';
import { currencyInfo } from '@/domain/currency';
import type { CurrencyCode, IsoDate, LocalRow, Minor, UUID, Wallet } from '@/domain/types';
import { withTag } from './trips';

/**
 * Обмен валюты в поездке: «отдал X, получил Y». Это перевод между двумя кошельками разных валют с меткой поездки в заметке:
 * из таких переводов считается курс поездки (tripRates.ts). Кошелёк для полученной валюты заводится сам — при первом обмене в
 * этой валюте («USD · Самарканд»); следующие обмены в ту же валюту идут в него же. Возврат остатка — тот же обмен в обратную сторону.
 */

/** Заметка обмена: метка поездки дописывается в конец. */
export const EXCHANGE_NOTE = 'Обмен валюты';

/** Цвет и значок кошелька поездки. */
const TRIP_WALLET_COLOR = '#0ea5e9';
const TRIP_WALLET_ICON = '✈️';
const NAME_MAX = 60;

export interface ExchangeRequest {
  /** Метка поездки (`Самарканд`) и её название для кошелька. */
  tag: string;
  label: string;
  base: CurrencyCode;
  from: Pick<LocalRow<Wallet>, 'id' | 'currency'>;
  fromMinor: Minor;
  toCurrency: CurrencyCode;
  toMinor: Minor;
  /** Куда зачислить. Нет — кошелёк поездки в этой валюте (есть — берём, нет — заводим). Для основной валюты обязателен. */
  toWalletId?: UUID | undefined;
  /** Кошельки, уже заведённые обменами этой поездки. */
  tripWallets: readonly { walletId: UUID; currency: CurrencyCode; archived: boolean }[];
  occurredOn: IsoDate;
  /** Заранее выданные номера: повтор после сбоя или двойное нажатие не заводит второй кошелёк и не дублирует обмен. */
  ids: { tx: UUID; wallet: UUID };
}

export interface ExchangeResult {
  txId: UUID;
  walletId: UUID;
  /** Кошелёк поездки заведён этим обменом (отмена обмена его архивирует). */
  createdWallet: boolean;
}

/** Название кошелька поездки: «USD · Самарканд»; занято — «USD · Самарканд (2)». */
export function tripWalletName(currency: CurrencyCode, label: string, taken: ReadonlySet<string>): string {
  const base = `${currency} · ${label}`.slice(0, NAME_MAX - 4).trim();
  let name = base;
  for (let n = 2; taken.has(name.toLocaleLowerCase('ru')); n += 1) name = `${base} (${n})`;
  return name;
}

export async function recordExchange(store: Store, req: ExchangeRequest): Promise<ExchangeResult> {
  if (req.from.currency === req.toCurrency) throw new ValidationError('Валюты должны быть разными: это обмен');
  if (!(req.fromMinor > 0) || !(req.toMinor > 0)) throw new ValidationError('Укажите, сколько отдали и сколько получили');

  let walletId = req.toWalletId;
  let createdWallet = false;
  if (walletId === undefined) {
    if (req.toCurrency === req.base) throw new ValidationError('Выберите кошелёк, куда вернуть деньги');
    const existing = req.tripWallets.find((w) => w.currency === req.toCurrency && !w.archived);
    if (existing) walletId = existing.walletId;
    else if (await store.db.wallets.get(req.ids.wallet)) walletId = req.ids.wallet; // повтор после сбоя: кошелёк уже заведён
    else {
      const taken = new Set((await store.db.wallets.toArray()).map((w) => w.name.toLocaleLowerCase('ru')));
      const wallet = await store.wallets.create(
        {
          name: tripWalletName(req.toCurrency, req.label, taken),
          currency: req.toCurrency,
          kind: 'cash',
          openingBalanceMinor: 0,
          color: TRIP_WALLET_COLOR,
          icon: TRIP_WALLET_ICON,
        },
        { id: req.ids.wallet },
      );
      walletId = wallet.id;
      createdWallet = true;
    }
  }

  const tx = await store.transactions.create(
    {
      kind: 'transfer',
      walletId: req.from.id,
      toWalletId: walletId,
      amountMinor: req.fromMinor,
      toAmountMinor: req.toMinor,
      occurredOn: req.occurredOn,
      note: withTag(EXCHANGE_NOTE, req.tag),
    },
    { id: req.ids.tx },
  );
  return { txId: tx.id, walletId, createdWallet };
}

/** Подпись кошелька в списке выбора: «Наличные · TJS». */
export const walletOptionLabel = (w: Pick<Wallet, 'name' | 'currency'>): string => `${w.name} · ${currencyInfo(w.currency).code}`;
