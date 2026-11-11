import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { moreGroups } from '@/app/sections';

/**
 * Блок «Разделы» на «Главной» (по умолчанию скрыт, включается в настройке главной): лента ссылок на разделы, которых нет в
 * нижней панели («Долги», «Бюджеты», «Покупки» и остальные из «Ещё»), — чтобы открывать их в одно касание. Список берётся из
 * общего реестра разделов, поэтому новый раздел появляется здесь сам.
 */
export default function ShortcutsRow() {
  const sections = moreGroups().flatMap((g) => g.items);
  return (
    <section aria-labelledby="home-shortcuts" data-testid="home-shortcuts" className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 id="home-shortcuts" className="text-sm font-semibold text-muted">
          Разделы
        </h2>
        <Link to="/more" className="-mr-2 inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2 text-sm font-semibold text-brand">
          Все
          <Icon name="chevron" size={14} />
        </Link>
      </div>
      <ul className="scroll-x-quiet -mx-4 flex snap-x scroll-px-4 gap-2 px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
        {sections.map((section, i) => (
          <li key={section.id} style={{ '--i': i } as React.CSSProperties} className="pop-spring shrink-0 snap-start">
            {/* адрес — из реестра разделов (статические пути приложения): пользовательских данных в нём нет */}
            <Link
              to={section.path}
              className="press flex min-h-[44px] items-center gap-2 rounded-full border border-border bg-surface py-1 pl-2.5 pr-3.5 text-sm font-semibold hover:bg-surface-2"
            >
              <Icon name={section.icon} size={18} className="shrink-0 text-brand" />
              <span className="whitespace-nowrap">{section.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
