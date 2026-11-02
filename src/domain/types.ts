/**
 * ЕДИНЫЙ файл доменных типов Sumoima. Новые сущности — только сюда.
 *
 * Деньги: всегда целое число «минорных единиц» (дирам, центы) — `Minor`. Никаких дробных сумм.
 * Время: даты операций — календарная дата пользователя 'YYYY-MM-DD'; метки правок — ISO UTC с миллисекундами.
 * Удаление: только мягкое (`deletedAt`), строки физически не удаляются — иначе синхронизация не узнает об удалении.
 */

export type UUID = string;
/** ISO 4217, ЗАГЛАВНЫМИ: 'TJS', 'USD', 'EUR', 'RUB' */
export type CurrencyCode = string;
/** Целое число минорных единиц валюты (для TJS: 1 сомони = 100 дирам). Всегда Number.isSafeInteger. */
export type Minor = number;
/** Календарная дата 'YYYY-MM-DD' в часовом поясе пользователя */
export type IsoDate = string;
/** ISO 8601 UTC с миллисекундами: '2026-10-10T16:40:00.123Z' */
export type IsoDateTime = string;

/** Поля, общие для всех синхронизируемых сущностей. */
export interface SyncFields {
  id: UUID;
  createdAt: IsoDateTime;
  /**
   * Метка последней правки с часов устройства (монотонная в пределах устройства, см. db/clock.ts).
   * При конфликте побеждает большая пара (clientUpdatedAt, deviceId).
   */
  clientUpdatedAt: IsoDateTime;
  /** Устройство, сделавшее последнюю правку (случайный id установки). Нужен для детерминированного tie-break. */
  deviceId: string;
  /** Метка мягкого удаления; null = запись жива. */
  deletedAt: IsoDateTime | null;
}

/** Локальные служебные поля (в облако НЕ уходят). */
export interface LocalFields {
  /** 1 = есть правки, ещё не подтверждённые сервером (Dexie не умеет индексировать boolean). */
  dirty: 0 | 1;
  /**
   * server_seq последней увиденной версии (целое, растёт при каждой записи на сервере); null = ещё не синхронизирована.
   * Это курсор синхронизации. Метки времени для курсора НЕ используются (потеря точности, гонки коммитов).
   */
  serverSeq: number | null;
  /** Последняя ошибка отправки этой строки (карантин). null = ошибок нет. */
  syncError: string | null;
  /**
   * Какие ГРУППЫ полей (см. db/mergeGroups.ts) изменены локально с тех пор, как строка последний раз совпадала с сервером.
   * По ним правки разных частей одной записи на разных устройствах объединяются, а не затирают друг друга.
   * undefined у грязной строки = «неизвестно / вся запись» (новая строка, строка до обновления приложения, импорт):
   * прежнее правило «целиком побеждает более новая версия». В облако не уходит, не экспортируется, не индексируется.
   */
  dirtyGroups?: string[];
}

export type WalletKind = 'cash' | 'card' | 'bank' | 'savings' | 'other';

export interface Wallet extends SyncFields {
  name: string;
  currency: CurrencyCode;
  kind: WalletKind;
  /** Начальный остаток. Текущий остаток НИГДЕ не хранится — всегда считается из операций (см. domain/balances.ts). */
  openingBalanceMinor: Minor;
  color: string;
  icon: string;
  sortOrder: number;
  archivedAt: IsoDateTime | null;
  /**
   * Цель накопления (для кошелька вида «Накопления»): сколько хотим накопить и к какой дате. null — цели нет.
   * Срок без суммы не бывает. Накоплено = остаток кошелька, он считается из операций (domain/goals.ts).
   */
  goalMinor: Minor | null;
  goalOn: IsoDate | null;
}

export type CategoryKind = 'expense' | 'income';

export interface Category extends SyncFields {
  name: string;
  kind: CategoryKind;
  parentId: UUID | null;
  color: string;
  icon: string;
  sortOrder: number;
  archivedAt: IsoDateTime | null;
  /**
   * 1 — обязательная категория (аренда, связь, кредит): цели накопления её не «урезают» (domain/savingsPlan.ts).
   * Осмыслен только у расходных категорий; у доходных всегда 0.
   */
  essential: 0 | 1;
}

export type TxKind = 'expense' | 'income' | 'transfer';

export interface Transaction extends SyncFields {
  kind: TxKind;
  /** Кошелёк операции; для перевода — откуда списали. */
  walletId: UUID;
  /** Только перевод: куда зачислили (≠ walletId). Иначе null. */
  toWalletId: UUID | null;
  /** > 0. В валюте walletId (для перевода — сумма списания). */
  amountMinor: Minor;
  /** Только перевод: сумма зачисления в валюте toWalletId (> 0). Иначе null. */
  toAmountMinor: Minor | null;
  /** Для расхода/дохода — категория соответствующего вида; для перевода — null. */
  categoryId: UUID | null;
  occurredOn: IsoDate;
  note: string;
  /**
   * Снимок для отчётов: сумма в базовой валюте пользователя на МОМЕНТ внесения (курс не пересчитывается задним числом).
   * Для перевода = КОМИССИЯ в базовой валюте: (amountMinor − toAmountMinor), переведённая в базовую валюту, если у обоих
   * кошельков одна валюта; для перевода между разными валютами (обмен) и без комиссии = 0. Комиссия считается РАСХОДОМ
   * месяца (см. db/queries.ts); сам перевод в доходы/расходы не входит.
   */
  baseCurrency: CurrencyCode;
  baseAmountMinor: Minor;
  /** Единиц базовой валюты за 1 единицу валюты кошелька, использованных для снимка (1 если валюты совпадают). null для перевода. */
  fxRate: number | null;
  /** 'same' | 'nbt' | 'server' | 'api' | 'manual' | 'cached' | 'trip' — откуда взят курс ('trip' — по обменам валюты в поездке). null для перевода. */
  fxSource: string | null;
  /**
   * Долг, к которому относится движение денег (выдача/получение долга или платёж по нему). Только для расхода/дохода.
   * Такие операции НЕ входят в «Доходы/Расходы» месяца и в бюджеты (это не траты), но меняют остаток кошелька.
   */
  debtId: UUID | null;
  /** Регулярный платёж, по которому операция создана (id операции тогда детерминирован: v5(ruleId, дата)). */
  recurringRuleId: UUID | null;
  /**
   * «Сумма в валюте»: оплата картой в другой валюте (банк списал 135 с., а на чеке было 50 AED). Только расход/доход; оба поля вместе
   * или оба пусты, валюта отличается от валюты кошелька. Остаток и отчёты считаются по amountMinor (в валюте кошелька), эти поля
   * лишь помнят, сколько было на чеке. Нет поля (старые строки) — то же, что null.
   */
  foreignCurrency?: CurrencyCode | null;
  foreignAmountMinor?: Minor | null;
}

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

/**
 * Бюджет: лимит расходов на календарный месяц в БАЗОВОЙ валюте. categoryId === null — общий лимит на все расходы.
 * id детерминирован (v5(userId, 'budget:' + (categoryId ?? 'total'))) — два устройства не заведут два бюджета на одно и то же.
 */
export interface Budget extends SyncFields {
  categoryId: UUID | null;
  amountMinor: Minor;
  currency: CurrencyCode;
  period: 'month';
  archivedAt: IsoDateTime | null;
}

/**
 * Цель накопления в «Бюджетах»: «накопить targetMinor к дате dueOn». Накоплено = остаток кошелька-накопления walletId
 * (считается из операций, нигде не хранится); без кошелька накоплено 0. Валюта — основная на момент создания.
 * Расчёт «сколько откладывать и сколько можно тратить» — чистые функции domain/savingsPlan.ts.
 */
export interface SavingsGoal extends SyncFields {
  name: string;
  targetMinor: Minor;
  currency: CurrencyCode;
  dueOn: IsoDate;
  /** Кошелёк вида «Накопления», остаток которого считается накопленным; null — не привязан. */
  walletId: UUID | null;
  archivedAt: IsoDateTime | null;
}

export type DebtDirection = 'lent' | 'borrowed';

/**
 * Долг. lent — мне должны (я дал), borrowed — я должен (мне дали). Остаток считается из операций с debtId (см. domain/debts.ts),
 * нигде не хранится. Валюта долга = валюта кошельков его операций.
 * Проценты (кредит в банке): interestMinor — сумма процентов за весь срок, её платят сверх principalMinor; null — без процентов.
 * interestRateBp (сотые доли процента годовых, 2400 = 24 %) и termMonths (месяцев) — то, из чего она получена: для показа и
 * подсказки платежа, на остаток не влияют. Ставка и срок бывают только вместе с процентами (domain/interest.ts).
 */
export interface Debt extends SyncFields {
  direction: DebtDirection;
  counterparty: string;
  principalMinor: Minor;
  interestMinor: Minor | null;
  interestRateBp: number | null;
  termMonths: number | null;
  /**
   * Объединение: id долга, в состав которого входит этот. У каждой составляющей остаются свои сумма, проценты, ставка, срок, даты,
   * платежи и планы; общая сумма — их сумма (domain/debtGroups.ts). null — долг сам по себе или он главный в объединении.
   * Вложенности нет: главный долг сам ни в чей состав не входит.
   */
  mergedIntoId: UUID | null;
  /**
   * Категория долга — короткий свободный текст («Друзья», «Семья», «Кредит»), по нему список долгов фильтруется.
   * '' — без категории. Не больше DEBT_CATEGORY_MAX символов, без пробелов по краям (domain/debtCategory.ts).
   */
  category: string;
  currency: CurrencyCode;
  openedOn: IsoDate;
  dueOn: IsoDate | null;
  note: string;
  closedAt: IsoDateTime | null;
  archivedAt: IsoDateTime | null;
}

/**
 * Регулярный платёж/доход/перевод. Операции по расписанию создаются с ДЕТЕРМИНИРОВАННЫМ id v5(ruleId, 'YYYY-MM-DD'),
 * поэтому два устройства не создадут одну и ту же операцию дважды. «Пропустить» = создать операцию с этим id сразу удалённой.
 * autoPost: 1 — проводить само в день платежа, 0 — показать в «Предстоящих» и ждать подтверждения.
 */
export interface RecurringRule extends SyncFields {
  kind: TxKind;
  walletId: UUID;
  toWalletId: UUID | null;
  amountMinor: Minor;
  toAmountMinor: Minor | null;
  categoryId: UUID | null;
  debtId: UUID | null;
  note: string;
  frequency: Frequency;
  /** Каждые N периодов, N ≥ 1 */
  intervalN: number;
  startOn: IsoDate;
  endOn: IsoDate | null;
  autoPost: 0 | 1;
  archivedAt: IsoDateTime | null;
}

export type ShoppingUnit = 'pcs' | 'kg' | 'l';

/**
 * Позиция списка покупок. Количество — целое в тысячных долях единицы (qtyMilli: 1400 = 1,4 кг, 3000 = 3 шт), без дробных чисел.
 * Цены — целые минорные единицы основной валюты. Отметка «в корзине» (checkedAt) ставится вместе с ценой, вписанной в магазине
 * (priceMinor — за всю позицию); «куплено» (purchasedAt) — после подтверждения покупки: тогда позиция входит в чек расхода
 * (transactionId) и больше не меняется. Прошлые цены берутся из купленных позиций с тем же названием и единицей (domain/shopping.ts).
 */
export interface ShoppingItem extends SyncFields {
  name: string;
  qtyMilli: number;
  unit: ShoppingUnit;
  /** Цена позиции целиком, вписанная в магазине; null = не отмечена. */
  priceMinor: Minor | null;
  checkedAt: IsoDateTime | null;
  purchasedAt: IsoDateTime | null;
  /** Расход, в чек которого вошла позиция. */
  transactionId: UUID | null;
}

/** Настройки пользователя. ОДНА строка на пользователя, id = id пользователя (чтобы устройства не плодили дубли). */
export interface Settings extends SyncFields {
  baseCurrency: CurrencyCode;
  locale: 'ru';
  /** 1 = понедельник */
  weekStartsOn: 0 | 1;
  defaultWalletId: UUID | null;
  /**
   * Города для погоды и выбранный город одним текстом (формат и проверки — domain/weatherPlaces.ts). null — человек ещё ничего
   * не выбирал. Живёт в настройках, чтобы выбор ехал между устройствами.
   */
  weather: string | null;
}

export type LocalRow<T> = T & LocalFields;

export type Entity = Wallet | Category | Transaction | Settings | Budget | Debt | RecurringRule | ShoppingItem | SavingsGoal;

/**
 * Таблица курсов относительно «опорной» валюты (pivot): 1 единица X стоит perUnit[X] единиц pivot.
 * perUnit[pivot] === 1. Перекрёстный курс A→B = perUnit[A] / perUnit[B] (см. domain/rates.ts).
 */
export interface RateTable {
  asOf: IsoDate;
  pivot: CurrencyCode;
  perUnit: Record<CurrencyCode, number>;
  /** 'nbt' | 'server' | 'api' | 'manual' */
  source: string;
  fetchedAt: IsoDateTime;
}
