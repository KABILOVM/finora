import { lazy, Suspense, useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { SearchField } from '@/components/SearchField';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { deletePhoto, MAX_CUSTOM_SKINS, photoKey, readActiveCustomId, readCustomSkins, writeActiveCustomId, writeCustomSkins, type CustomSkin } from '@/customSkin';
import { cn } from '@/lib/cn';
import { CUSTOM_SKIN, DEFAULT_SKIN, parseTraits, seasonFor, skinTraits, type SkinId, type SkinTraits } from '@/skinCore';
import { SKIN_GROUPS, SKINS, skinById, type SkinGroupId } from '@/skins';
import { SKIN_THUMBS } from '@/skinThumbs';
import { readCustomPalette, saveSkinPref, useAccentPref, useCustomAccent, useSkinPref } from '@/theme';
import { toggleFav, useFavs } from './skinFavs';
import { SkinPreview } from './SkinPreview';
import { traitRows } from './traitText';

// Конструктор своего образа нужен не каждому, кто зашёл выбрать образ: он грузится отдельным файлом, когда его открывают
const CustomSkinSheet = lazy(() => import('./CustomSkinSheet'));

/**
 * Адреса рисунков образов для окна предпросмотра. В файл витрины попадают только адреса (строки), а сама картинка скачивается,
 * когда открыли предпросмотр её образа.
 */
const HERO_ART = import.meta.glob<string>('../../assets/skins/art/*-hero.webp', { eager: true, query: '?url', import: 'default' });

/** Одна карточка витрины: готовый образ или свой. `key` — под ним образ лежит в избранном. */
interface Item {
  key: string;
  id: SkinId;
  label: string;
  hint: string;
  group: SkinGroupId | 'mine';
  traits: SkinTraits;
  custom?: CustomSkin;
  /** У «Сезонных» в окне предпросмотра: праздничный образ, который встал бы сегодня. */
  resolves?: SkinId;
}

type Filter = 'all' | 'favs' | 'mine' | SkinGroupId;

/** Для поиска: без регистра, «ё» = «е», лишние пробелы убраны. */
const norm = (s: string): string => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

const GROUP_LABEL = new Map<string, string>(SKIN_GROUPS.map((g) => [g.id, g.label]));

function useItems(custom: readonly CustomSkin[]): Item[] {
  return useMemo(
    () => [
      ...SKINS.map((s): Item => ({ key: s.id, id: s.id, label: s.label, hint: s.hint, group: s.group, traits: skinTraits(s.id) })),
      ...custom.map((c): Item => ({ key: `my:${c.id}`, id: CUSTOM_SKIN, label: c.name, hint: 'Свой образ', group: 'mine', traits: parseTraits(c.traits), custom: c })),
    ],
    [custom],
  );
}

/** Картинка окна предпросмотра: рисунок образа (у «Классики» и своих образов её нет; у «Сезонных» — рисунок сегодняшнего праздника). */
const previewArt = (item: Item | null): string | undefined =>
  item === null || item.custom ? undefined : HERO_ART[`../../assets/skins/art/${item.resolves ?? item.id}-hero.webp`];

/**
 * Витрина образов (Настройки → Оформление → «Образ»): все образы большими карточками с маленьким «экраном» в цветах и с чертами образа,
 * поиск по названию, разделы, избранное и свои образы. Нажатие на карточку открывает предпросмотр: что именно изменит образ, и кнопка
 * «Применить». Пока её не нажали, приложение остаётся в прежнем образе.
 */
export default function SkinsPage() {
  const toast = useToast();
  const [skin] = useSkinPref();
  const [accent] = useAccentPref();
  const customHex = useCustomAccent();
  const favs = useFavs();
  const [custom, setCustom] = useState<readonly CustomSkin[]>(() => readCustomSkins());
  const [activeCustom, setActiveCustom] = useState<string | null>(() => readActiveCustomId());
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [preview, setPreview] = useState<Item | null>(null);
  /** Конструктор: null — закрыт, 'new' — новый образ, иначе — правка сохранённого. */
  const [editing, setEditing] = useState<CustomSkin | 'new' | null>(null);

  const items = useItems(custom);
  const accentPalette = accent === 'custom' && customHex !== null ? readCustomPalette(customHex) : null;
  const isActive = (item: Item): boolean => (item.custom ? skin === CUSTOM_SKIN && activeCustom === item.custom.id : skin === item.id);

  const q = norm(query);
  const shown = items.filter((item) => {
    if (filter === 'favs' && !favs.includes(item.key)) return false;
    if (filter !== 'all' && filter !== 'favs' && item.group !== filter) return false;
    return q === '' || norm(`${item.label} ${item.hint} ${GROUP_LABEL.get(item.group) ?? 'свои образы'}`).includes(q);
  });
  // без поиска и фильтра образы идут разделами; с ними — одним списком
  const sections: { id: string; label: string | null; items: Item[] }[] =
    filter === 'all' && q === ''
      ? [
          ...(custom.length > 0 ? [{ id: 'mine', label: 'Свои образы', items: shown.filter((i) => i.group === 'mine') }] : []),
          ...SKIN_GROUPS.map((g) => ({ id: g.id, label: g.label, items: shown.filter((i) => i.group === g.id) })),
        ]
      : [{ id: 'found', label: null, items: shown }];

  const chips: { value: Filter; label: string }[] = [
    { value: 'all', label: 'Все' },
    { value: 'favs', label: 'Избранное' },
    ...(custom.length > 0 ? [{ value: 'mine' as const, label: 'Свои' }] : []),
    ...SKIN_GROUPS.map((g) => ({ value: g.id, label: g.label })),
  ];

  const open = (item: Item) => setPreview(item.id === 'seasonal' ? { ...item, resolves: seasonFor(new Date()), traits: skinTraits('seasonal') } : item);

  const apply = (item: Item) => {
    if (item.custom) {
      writeActiveCustomId(item.custom.id);
      setActiveCustom(item.custom.id);
    }
    saveSkinPref(item.id);
    setPreview(null);
    toast.show(`Образ «${item.label}» применён`);
  };

  const remove = (item: Item) => {
    const c = item.custom;
    if (!c) return;
    const next = custom.filter((x) => x.id !== c.id);
    writeCustomSkins(next);
    setCustom(next);
    void deletePhoto(photoKey(c.id, 'bg'));
    void deletePhoto(photoKey(c.id, 'hero'));
    if (favs.includes(item.key)) toggleFav(item.key);
    // удалили образ, который стоит сейчас, — возвращаемся к «Классике»
    if (isActive(item)) {
      writeActiveCustomId(null);
      setActiveCustom(null);
      saveSkinPref(DEFAULT_SKIN);
    }
    setPreview(null);
    toast.show(`Образ «${item.label}» удалён`);
  };

  const onSaved = (saved: CustomSkin, list: readonly CustomSkin[]) => {
    setCustom(list);
    setEditing(null);
    writeActiveCustomId(saved.id);
    setActiveCustom(saved.id);
    saveSkinPref(CUSTOM_SKIN);
    toast.show(`Образ «${saved.name}» сохранён и применён`);
  };

  const art = previewArt(preview);
  const previewActive = preview !== null && isActive(preview);
  const today = preview?.resolves ? skinById(preview.resolves) : undefined;

  return (
    <>
      <PageHeader
        title="Образы"
        subtitle="Образ меняет не только цвета: форму, карточки, меню, движение и живой фон."
        back={{ to: '/settings?section=appearance', label: 'Настройки' }}
      />

      <div className="mb-3 flex flex-col gap-2.5">
        <SearchField value={query} onChange={setQuery} label="Поиск образа" placeholder="Название образа" />
        <div role="group" aria-label="Раздел образов" className="scroll-x-quiet -mx-4 flex gap-2 px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
          {chips.map((c) => (
            <button
              key={c.value}
              type="button"
              aria-pressed={filter === c.value}
              onClick={() => setFilter(c.value)}
              className={cn(
                'min-h-[44px] shrink-0 whitespace-nowrap rounded-pill border px-4 text-sm font-semibold transition-colors',
                filter === c.value ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-surface text-text hover:bg-surface-2',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {filter === 'all' && q === '' && (
        <button
          type="button"
          data-testid="skin-create"
          disabled={custom.length >= MAX_CUSTOM_SKINS}
          onClick={() => setEditing('new')}
          className="press card mb-5 flex min-h-[72px] w-full items-center gap-3 rounded-card p-4 text-left shadow-card hover:bg-surface-2 disabled:opacity-50"
        >
          <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-accent text-brand-fg">
            <Icon name="plus" size={26} strokeWidth={2.5} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-text">Свой образ</span>
            <span className="block text-sm text-muted">
              {custom.length >= MAX_CUSTOM_SKINS ? `Сохранено ${MAX_CUSTOM_SKINS} образов — это предел. Удалите лишний.` : 'Соберите сами: цвет, шрифт, узор, значки, форма и своё фото.'}
            </span>
          </span>
          <Icon name="chevron" size={18} className="shrink-0 text-muted" />
        </button>
      )}

      {shown.length === 0 ? (
        <EmptyState
          icon={filter === 'favs' && q === '' ? 'star' : 'search'}
          title={filter === 'favs' && q === '' ? 'В избранном пока пусто' : 'Ничего не нашлось'}
          text={filter === 'favs' && q === '' ? 'Отметьте образ звёздочкой на его карточке — он появится здесь.' : 'Попробуйте другое слово или другой раздел.'}
        />
      ) : (
        sections
          .filter((s) => s.items.length > 0)
          .map((s) => (
            <section key={s.id} aria-label={s.label ?? 'Найденные образы'} data-skin-group={s.id} className="mb-6">
              {s.label !== null && <h2 className="section-title mb-2.5 px-1">{s.label}</h2>}
              <ul className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
                {s.items.map((item) => {
                  const active = isActive(item);
                  const fav = favs.includes(item.key);
                  return (
                    <li key={item.key} className="relative">
                      <button
                        type="button"
                        data-skin-option={item.custom ? `my:${item.custom.id}` : item.id}
                        aria-current={active ? 'true' : undefined}
                        aria-label={`${item.label}. ${item.hint}${active ? '. Выбран' : ''}`}
                        onClick={() => open(item)}
                        className="press block w-full text-left"
                      >
                        <span className={cn('block rounded-[1.25em] p-[3px] transition-shadow', active ? 'ring-2 ring-brand' : 'ring-1 ring-border/70')}>
                          <SkinPreview
                            scope={item.custom ? 'custom' : skinById(item.id)?.base ? null : item.id === 'seasonal' ? seasonFor(new Date()) : item.id}
                            accent={accent}
                            palette={item.custom ? item.custom.palette : skinById(item.id)?.base ? accentPalette : null}
                            traits={item.traits}
                            art={item.custom ? undefined : SKIN_THUMBS[item.id]}
                          />
                        </span>
                        <span className="mt-2 flex items-center gap-1.5 px-0.5">
                          <span className="min-w-0 truncate font-semibold text-text">{item.label}</span>
                          {active && <Icon name="check" size={18} label="Выбран" className="shrink-0 text-brand" />}
                        </span>
                        <span className="block px-0.5 text-sm leading-snug text-muted">{item.hint}</span>
                      </button>
                      <button
                        type="button"
                        aria-pressed={fav}
                        aria-label={`${fav ? 'Убрать из избранного' : 'В избранное'}: ${item.label}`}
                        onClick={() => toggleFav(item.key)}
                        className={cn(
                          'tap-44 absolute left-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full backdrop-blur transition-colors',
                          fav ? 'bg-brand text-brand-fg' : 'bg-surface/75 text-muted hover:text-text',
                        )}
                      >
                        <Icon name="star" size={17} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
      )}

      <Sheet
        open={preview !== null}
        onClose={() => setPreview(null)}
        title={preview?.label ?? 'Образ'}
        footer={
          preview && (
            <div className="flex flex-col gap-2">
              <Button size="lg" fullWidth disabled={previewActive} onClick={() => apply(preview)}>
                {previewActive ? 'Уже выбран' : 'Применить'}
              </Button>
              {preview.custom && (
                <div className="flex gap-2">
                  <Button variant="secondary" fullWidth icon="edit" onClick={() => (setEditing(preview.custom ?? null), setPreview(null))}>
                    Изменить
                  </Button>
                  <Button variant="ghost" fullWidth icon="trash" className="!text-danger" onClick={() => remove(preview)}>
                    Удалить
                  </Button>
                </div>
              )}
            </div>
          )
        }
      >
        {preview && (
          <div className="flex flex-col gap-4">
            <SkinPreview
              scope={preview.custom ? 'custom' : skinById(preview.id)?.base ? null : (preview.resolves ?? preview.id)}
              accent={accent}
              palette={preview.custom ? preview.custom.palette : skinById(preview.id)?.base ? accentPalette : null}
              traits={preview.traits}
              art={art}
              artFull
              size={17}
              className="mx-auto w-full max-w-[17rem] shadow-float"
            />
            <p className="text-muted">
              {preview.hint}.
              {today && ` Сегодня это «${today.label}»: образ сам меняется к ближайшему празднику.`}
              {skinById(preview.id)?.base && ' Цвет выбирается в «Оформлении».'}
            </p>
            <dl data-testid="skin-traits" className="grid grid-cols-2 gap-2">
              {traitRows(preview.traits).map((r) => (
                <div key={r.key} className="rounded-2xl bg-surface-2/70 px-3 py-2">
                  <dt className="text-xs text-muted">{r.label}</dt>
                  <dd className="text-sm font-semibold">{r.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </Sheet>

      {editing !== null && (
        <Suspense fallback={null}>
          <CustomSkinSheet skin={editing === 'new' ? null : editing} existing={custom} onClose={() => setEditing(null)} onSaved={onSaved} />
        </Suspense>
      )}
    </>
  );
}
