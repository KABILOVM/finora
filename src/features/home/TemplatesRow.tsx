import { Link } from 'react-router-dom';
import { Glyph } from '@/components/Glyph';
import { Icon } from '@/components/Icon';
import { useCategories, useStore, useWallets } from '@/db';
import { formatMinor } from '@/domain/money';
import { useTemplates } from '@/features/templates/templateStore';
import { resolveTemplate, type ResolvedTemplate, type Template } from '@/features/templates/templates';
import { useAddLink } from '@/layout/nav';

/** Сколько шаблонов показываем на «Главной»; остальные — по ссылке «Все». */
export const HOME_TEMPLATES = 8;

function Chip({ template: t, resolved }: { template: Template; resolved: ResolvedTemplate }) {
  const link = useAddLink(t.prefill.kind, undefined, undefined, t.prefill);
  const money = formatMinor(t.prefill.amountMinor, resolved.wallet.currency);
  return (
    <Link
      {...link}
      aria-label={`Шаблон: ${t.name}, ${money}`}
      data-testid="home-template"
      className="flex min-h-[44px] max-w-[70%] shrink-0 items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1.5 pr-3 text-left transition-colors hover:bg-surface-2 active:bg-border/60"
    >
      <Glyph value={t.prefill.kind === 'transfer' ? '🔁' : (resolved.category?.icon ?? '🏷️')} color={resolved.category?.color ?? undefined} size={30} />
      <span className="min-w-0 truncate text-base font-semibold text-text">{t.name}</span>
      <span className="money shrink-0 text-base font-semibold text-muted">{money}</span>
    </Link>
  );
}

/**
 * «Шаблоны» на «Главной»: строка чипов, нажатие открывает «Новую операцию» с готовыми полями (сумму можно поправить). Шаблонов нет
 * (или ни один сейчас нельзя внести) — строки нет.
 */
export default function TemplatesRow() {
  const store = useStore();
  const wallets = useWallets();
  const categories = useCategories(undefined, { includeArchived: true });
  const { templates } = useTemplates(store.userId);
  if (templates.length === 0 || !wallets || !categories) return null;
  const items = templates.flatMap((t) => {
    const resolved = resolveTemplate(t, wallets, categories);
    return resolved ? [{ t, resolved }] : [];
  });
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="home-templates" data-testid="home-templates" className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 id="home-templates" className="text-sm font-semibold text-muted">
          Шаблоны
        </h2>
        <Link to="/settings/templates" className="-mr-2 inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2 text-sm font-semibold text-brand">
          Все
          <Icon name="chevron" size={14} />
        </Link>
      </div>
      <div className="flex gap-2 overflow-x-auto overscroll-x-contain px-0.5 pb-1 [scrollbar-width:thin]">
        {items.slice(0, HOME_TEMPLATES).map(({ t, resolved }) => (
          <Chip key={t.id} template={t} resolved={resolved} />
        ))}
      </div>
    </section>
  );
}
