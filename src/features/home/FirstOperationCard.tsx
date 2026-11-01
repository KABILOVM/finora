import { useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { useCategories, useSettings, useTransactions } from '@/db';
import type { LocalRow, Wallet } from '@/domain/types';
import { parseQuickLine } from '@/features/transactions/quickLine';
import { sameName } from '@/features/wallets/walletUi';
import { ADD_PATH, useAddLink } from '@/layout/nav';
import { useToday } from '@/recurring/useToday';

/** Примеры для нажатия: название категории и сумма. Показываются те, чьи категории у человека есть: тогда категория подставится сама. */
const EXAMPLES: readonly (readonly [string, number])[] = [
  ['Еда', 35],
  ['Продукты', 150],
  ['Транспорт', 20],
];
/** Если стартовых категорий нет (человек их убрал), примеры — просто слова: категорию выберут в форме. */
const GENERIC = ['обед 35', 'такси 20', 'продукты 150'] as const;

export interface FirstOperationCardProps {
  wallets: readonly LocalRow<Wallet>[];
}

/**
 * «Запишите первую трату» на «Главной» у человека, у которого ещё нет ни одной операции. Одна строка («такси 20», «продукты 150 вчера»):
 * из неё читаются сумма, категория, кошелёк и дата тем же разбором, что и «Ввод одной строкой» в заметке. Нажатие открывает «Новую операцию»
 * уже заполненной — человек проверяет и сохраняет одним нажатием (деньги не записываются без него: у валютного кошелька форма сама запросит курс).
 * Строка не читается — говорим об этом словами, а рядом всегда есть обычная форма. Как только появляется первая операция, карточки нет.
 */
export default function FirstOperationCard({ wallets }: FirstOperationCardProps) {
  const rows = useTransactions({}, { limit: 1 });
  const categories = useCategories('expense');
  const settings = useSettings();
  const today = useToday();
  const navigate = useNavigate();
  const location = useLocation();
  const addLink = useAddLink('expense');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const live = useMemo(() => wallets.filter((w) => w.archivedAt === null), [wallets]);
  const chips = useMemo(() => {
    const found = EXAMPLES.filter(([name]) => (categories ?? []).some((c) => sameName(c.name, name))).map(([name, n]) => `${name} ${n}`);
    return found.length >= 2 ? found : [...GENERIC];
  }, [categories]);

  // Пока читается, и когда операции уже есть, карточки нет; кошелька нет — внести всё равно некуда (на «Главной» тогда «Начните с кошелька»)
  if (!rows || rows.length > 0 || !categories || live.length === 0) return null;

  const defaultWalletId = settings?.defaultWalletId && live.some((w) => w.id === settings.defaultWalletId) ? settings.defaultWalletId : (live[0]?.id ?? null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const line = parseQuickLine(text, {
      wallets: live.map((w) => ({ id: w.id, name: w.name, currency: w.currency })),
      categories: categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind, archivedAt: c.archivedAt })),
      noteIndex: [],
      kind: 'expense',
      currentWalletId: defaultWalletId,
      today,
    });
    if (!line) {
      setError('Не вижу суммы. Напишите слово и число, например «такси 20».');
      return;
    }
    setError(null);
    const walletId = line.walletId ?? defaultWalletId;
    navigate(ADD_PATH, {
      state: {
        background: location,
        kind: 'expense',
        ...(walletId ? { walletId } : {}),
        ...(line.date ? { date: line.date } : {}),
        prefill: { kind: 'expense', walletId: walletId ?? '', toWalletId: null, amountMinor: line.amountMinor, categoryId: line.categoryId, note: line.note },
      },
    });
  };

  return (
    <Card data-testid="first-operation" role="region" aria-labelledby="first-op-title" className="border-brand/30 bg-gradient-to-br from-brand/10 via-surface to-accent/10">
      <h2 id="first-op-title" className="text-lg font-bold">
        Запишите первую трату
      </h2>
      <p className="mt-1 text-sm text-muted">Напишите одной строкой, на что и сколько. Остальное подставим, вы проверите и сохраните.</p>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-2" noValidate>
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            aria-label="Первая трата одной строкой"
            aria-invalid={error ? true : undefined}
            placeholder="такси 20"
            enterKeyHint="go"
            autoComplete="off"
            maxLength={120}
            className="min-h-[48px] min-w-0 flex-1 rounded-2xl border border-border-strong bg-surface/80 px-3.5 text-base text-text placeholder:text-muted/80 transition duration-200 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/20"
          />
          <Button type="submit" size="lg" disabled={text.trim() === ''}>
            Далее
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        )}
        <div role="group" aria-label="Примеры" className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setText(c);
                setError(null);
              }}
              className="inline-flex min-h-[44px] items-center rounded-full border border-border bg-surface px-3.5 text-sm font-semibold text-text transition-colors hover:bg-surface-2 active:bg-border/60"
            >
              {c}
            </button>
          ))}
        </div>
      </form>
      <Link {...addLink} className="mt-1 inline-flex min-h-[44px] items-center text-sm font-semibold text-brand">
        Или открыть обычную форму
      </Link>
    </Card>
  );
}
