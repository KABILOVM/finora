import { Link } from 'react-router-dom';
import { Card } from '@/components/Card';
import { Icon, type IconName } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';

interface MoreItem {
  to: string;
  title: string;
  icon: IconName;
}

/**
 * Разделы, которых нет в нижней панели телефона. Категории и импорт здесь не дублируются: они лежат внутри «Настроек».
 */
export const MORE_ITEMS: readonly MoreItem[] = [
  { to: '/budgets', title: 'Бюджеты', icon: 'pie' },
  { to: '/recurring', title: 'Регулярные платежи', icon: 'repeat' },
  { to: '/shopping', title: 'Покупки', icon: 'cart' },
  { to: '/debts', title: 'Долги и кредиты', icon: 'banknote' },
  { to: '/settings', title: 'Настройки', icon: 'sliders' },
];

function Row({ item }: { item: MoreItem }) {
  return (
    <Link to={item.to} className="flex min-h-[60px] items-center gap-3 px-4 py-2 transition-colors hover:bg-surface-2 active:bg-border/60">
      <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
        <Icon name={item.icon} size={22} />
      </span>
      <span className="min-w-0 flex-1 text-base font-semibold text-text">{item.title}</span>
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
