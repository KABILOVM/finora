import { Link } from 'react-router-dom';
import { moreGroups, type Section } from '@/app/sections';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { SectionHeader } from '@/components/SectionHeader';
import { cn } from '@/lib/cn';
import { useAttention } from '@/features/home/useAttention';
import type { AttentionItem } from '@/features/home/attention';

/** Строка статуса справа — это текст из «Требует внимания» на «Главной»: тот же источник, те же слова. */
function statusFor(section: Section, attention: readonly AttentionItem[] | undefined): AttentionItem | undefined {
  if (!attention) return undefined;
  return attention.find((a) => a.to === section.path || a.to.startsWith(`${section.path}/`));
}

function Tile({ section, status }: { section: Section; status: AttentionItem | undefined }) {
  return (
    <div className="press card relative flex h-full min-h-[96px] flex-col justify-between gap-2.5 rounded-2xl p-3.5 shadow-card transition-colors hover:bg-surface-2 active:bg-border/60">
      <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
        <Icon name={section.icon} size={24} />
      </span>
      <div className="min-w-0">
        {/* Ссылка-растяжка (after:inset-0): нажимается вся плитка, а имя ссылки — только название раздела. */}
        <Link to={section.path} className="block text-[15px] font-semibold leading-tight text-text after:absolute after:inset-0">
          {section.title}
        </Link>
        {/* Статус в потоке под названием: плитка растёт, если текст длинный, и соседние плитки ряда тянутся за ней. */}
        {status && (
          <p className={cn('mt-0.5 break-words text-caption font-semibold', status.tone === 'danger' ? 'text-danger' : 'text-warning')}>
            {status.text}
          </p>
        )}
      </div>
    </div>
  );
}

/** «Ещё»: разделы, которым не хватило места в нижней панели, по смысловым группам, плитками в две колонки; на плитке — статус «Требует внимания». */
export default function MorePage() {
  const attention = useAttention();
  return (
    <>
      <PageHeader title="Ещё" />
      {moreGroups().map((g) => (
        <section key={g.group} aria-labelledby={`more-${g.group}`} className="mb-6">
          <SectionHeader id={`more-${g.group}`}>{g.title}</SectionHeader>
          <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {g.items.map((section) => (
              <li key={section.id}>
                <Tile section={section} status={statusFor(section, attention)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
