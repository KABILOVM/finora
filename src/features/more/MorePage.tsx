import { useId } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/Card';
import { Icon, type IconName } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';

interface MoreItem {
  to: string;
  title: string;
  hint: string;
  icon: IconName;
}

/** Разделы, которых нет в нижней панели телефона. Порядок — по частоте: сначала деньги вперёд, потом справочники и настройки. */
export const MORE_ITEMS: readonly MoreItem[] = [
  { to: '/budgets', title: 'Бюджеты', hint: 'Лимиты и расход на день', icon: 'pie' },
  { to: '/recurring', title: 'Регулярные платежи', hint: 'Аренда, подписки, зарплата', icon: 'repeat' },
  { to: '/debts', title: 'Долги и кредиты', hint: 'Кто кому и сколько должен', icon: 'banknote' },
  { to: '/settings/categories', title: 'Категории', hint: 'Статьи расходов и доходов', icon: 'tag' },
  { to: '/import', title: 'Импорт из Zenmoney', hint: 'Перенос из файла', icon: 'upload' },
  { to: '/settings', title: 'Настройки', hint: 'Валюта, курсы, копия, облако', icon: 'sliders' },
];

function Row({ item }: { item: MoreItem }) {
  const id = useId();
  return (
    <Link
      to={item.to}
      aria-labelledby={`${id}-t`}
      aria-describedby={`${id}-h`}
      className="flex min-h-[64px] items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2 active:bg-border/60"
    >
      <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
        <Icon name={item.icon} size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span id={`${id}-t`} className="block text-base font-semibold text-text">
          {item.title}
        </span>
        <span id={`${id}-h`} className="block text-sm leading-snug text-muted">
          {item.hint}
        </span>
      </span>
      <Icon name="chevron" size={18} className="shrink-0 text-muted" />
    </Link>
  );
}

/** «Ещё»: крупный список разделов, которым не хватило места в нижней панели. */
export default function MorePage() {
  return (
    <>
      <PageHeader title="Ещё" />
      <Card padding="none">
        <ul className="divide-y divide-border">
          {MORE_ITEMS.map((item) => (
            <li key={item.to}>
              <Row item={item} />
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
