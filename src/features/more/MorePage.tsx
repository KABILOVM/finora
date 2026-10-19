import { Link } from 'react-router-dom';
import { moreGroups, type Section } from '@/app/sections';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { cn } from '@/lib/cn';
import { useAttention } from '@/features/home/useAttention';
import type { AttentionItem } from '@/features/home/attention';

/** Строка статуса справа — это текст из «Требует внимания» на «Главной»: тот же источник, те же слова. */
function statusFor(section: Section, attention: readonly AttentionItem[] | undefined): AttentionItem | undefined {
  if (!attention) return undefined;
  return attention.find((a) => a.to === section.path || a.to.startsWith(`${section.path}/`));
}

function Row({ section, status }: { section: Section; status: AttentionItem | undefined }) {
  return (
    <div className="relative flex min-h-[60px] items-center gap-3 px-4 py-2 transition-colors hover:bg-surface-2 active:bg-border/60">
      <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
        <Icon name={section.icon} size={22} />
      </span>
      <div className="min-w-0 flex-1">
        {/* Ссылка-растяжка (after:inset-0): нажимается вся строка, а имя ссылки — только название раздела. */}
        <Link to={section.path} className="block text-base font-semibold text-text after:absolute after:inset-0">
          {section.title}
        </Link>
        {/* Статус в потоке под названием: строка растёт, если текст длинный, и соседние строки не налезают друг на друга. */}
        {status && (
          <p className={cn('break-words text-xs font-semibold leading-snug', status.tone === 'danger' ? 'text-danger' : 'text-warning')}>
            {status.text}
          </p>
        )}
      </div>
      <Icon name="chevron" size={18} className="shrink-0 text-muted" />
    </div>
  );
}

/** «Ещё»: разделы, которым не хватило места в нижней панели, по смысловым группам; у строк — статус «Требует внимания». */
export default function MorePage() {
  const attention = useAttention();
  return (
    <>
      <PageHeader title="Ещё" />
      {moreGroups().map((g) => (
        <section key={g.group} aria-labelledby={`more-${g.group}`} className="mb-5">
          <h2 id={`more-${g.group}`} className="mb-2 px-1 text-sm font-bold uppercase tracking-wide text-muted">
            {g.title}
          </h2>
          <Card padding="none">
            <ul className="divide-y divide-border">
              {g.items.map((section) => (
                <li key={section.id}>
                  <Row section={section} status={statusFor(section, attention)} />
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ))}
    </>
  );
}
