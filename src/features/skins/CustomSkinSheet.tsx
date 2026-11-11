import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { inputClasses } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { Notice } from '@/components/Notice';
import { Sheet } from '@/components/Sheet';
import { deletePhoto, loadPhoto, MAX_CUSTOM_SKINS, photoKey, readCustomSkins, savePhoto, writeCustomSkins, type CustomSkin, type PhotoSlot } from '@/customSkin';
import { cn } from '@/lib/cn';
import { triple } from '@/lib/paletteBase';
import { DEFAULT_TRAITS, HEROES, MATERIALS, MOTIONS, NAVS, parseTraits, SCENES, SHAPES, traitsLine, type SkinTraits } from '@/skinCore';
import { buildCustomPalette, FONT_CHOICES, ICON_CHOICES, PATTERN_CHOICES, patternCss, PRESET_COLORS } from './customSkinParts';
import { fitPhoto } from './photo';
import { SkinPreview } from './SkinPreview';
import { HERO_TEXT, MATERIAL_TEXT, MOTION_TEXT, NAV_TEXT, SCENE_TEXT, SHAPE_TEXT } from './traitText';

export interface CustomSkinSheetProps {
  /** Образ, который правим; null — новый. */
  skin: CustomSkin | null;
  /** Уже сохранённые образы (чтобы не превысить предел и подобрать название). */
  existing: readonly CustomSkin[];
  onClose: () => void;
  /** Образ записан: он сам и весь новый список. */
  onSaved: (skin: CustomSkin, list: readonly CustomSkin[]) => void;
}

/** Группа кнопок «один из нескольких»: выбранная подсвечена и помечена для скринридера (aria-pressed). */
function Choice<T extends string>({ label, options, value, onChange }: { label: string; options: readonly { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-sm font-semibold text-text">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
            className={cn(
              'min-h-[44px] rounded-pill border px-3.5 text-sm font-semibold transition-colors',
              o.value === value ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-surface text-text hover:bg-surface-2',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

const options = <T extends string>(values: readonly T[], text: Readonly<Record<T, string>>): { value: T; label: string }[] => values.map((v) => ({ value: v, label: text[v] }));

/** Фото одного места (фон или карточка): что показать в конструкторе. `blob` — новое, ещё не записанное; `kept` — уже лежит в хранилище. */
interface PhotoState {
  blob: Blob | null;
  kept: boolean;
  url: string | null;
}
const NO_PHOTO: PhotoState = { blob: null, kept: false, url: null };

function PhotoField({ label, hint, state, busy, onPick, onRemove }: { label: string; hint: string; state: PhotoState; busy: boolean; onPick: (file: File) => void; onRemove: () => void }) {
  const id = useId();
  const has = state.blob !== null || state.kept;
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-surface-2 text-muted"
        style={state.url ? { backgroundImage: `url("${state.url}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
      >
        {!state.url && <Icon name="upload" size={22} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-text">{label}</p>
        <p className="text-sm text-muted">{has ? 'Фото выбрано. Хранится только на этом устройстве.' : hint}</p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          <label htmlFor={id} className={cn('inline-flex min-h-[44px] cursor-pointer items-center rounded-control border border-border bg-surface px-3.5 text-sm font-semibold text-text hover:bg-surface-2', busy && 'pointer-events-none opacity-50')}>
            {has ? 'Заменить' : 'Выбрать фото'}
          </label>
          <input
            id={id}
            type="file"
            accept="image/*"
            className="sr-only"
            aria-label={`${label}: выбрать фото`}
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ''; // тот же файл можно выбрать снова
              if (file) onPick(file);
            }}
          />
          {has && (
            <button type="button" onClick={onRemove} className="inline-flex min-h-[44px] items-center rounded-control px-3 text-sm font-semibold text-danger hover:bg-danger/10">
              Убрать
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Конструктор своего образа: название, цвета (палитру строит приложение и следит за контрастом), шрифт заголовков, узор, набор значков,
 * шесть черт и свои фото на фон и на карточку «Всего». Сверху — маленький «экран», который меняется по ходу. «Сохранить» записывает
 * образ на это устройство и сразу применяет его. Фото уменьшаются перед записью и в облако не уходят.
 */
export default function CustomSkinSheet({ skin, existing, onClose, onSaved }: CustomSkinSheetProps) {
  const nameId = useId();
  const veilId = useId();
  const colorId = useId();
  const color2Id = useId();
  const [name, setName] = useState(skin?.name ?? `Мой образ ${existing.length + 1}`);
  const [hex, setHex] = useState(skin?.hex ?? '#6d5ef0');
  const [hex2, setHex2] = useState<string | null>(skin?.hex2 ?? null);
  const [traits, setTraits] = useState<SkinTraits>(() => (skin ? parseTraits(skin.traits) : DEFAULT_TRAITS));
  const [font, setFont] = useState<string>(() => FONT_CHOICES.find((f) => f.head === (skin?.head ?? ''))?.value ?? 'app');
  const [pattern, setPattern] = useState<string>(skin ? (PATTERN_CHOICES.find((p) => patternCss(p.value, skin.palette).image === skin.pattern)?.value ?? 'none') : 'none');
  const [icons, setIcons] = useState<string>(skin?.icons ?? 'none');
  const [veil, setVeil] = useState(skin?.veil ?? 0.7);
  const [bg, setBg] = useState<PhotoState>(() => ({ ...NO_PHOTO, kept: skin?.bgPhoto === true }));
  const [hero, setHero] = useState<PhotoState>(() => ({ ...NO_PHOTO, kept: skin?.heroPhoto === true }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);
  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    dirty.current = true;
    setError(null);
    set(v);
  };

  const palette = useMemo(() => buildCustomPalette(hex, hex2), [hex, hex2]);

  // Сохранённые фото образа, который правим, показываем сразу: читаем их из хранилища один раз
  useEffect(() => {
    if (!skin) return;
    let alive = true;
    const urls: string[] = [];
    const show = (slot: PhotoSlot, set: (fn: (s: PhotoState) => PhotoState) => void) =>
      void loadPhoto(photoKey(skin.id, slot)).then((blob) => {
        if (!alive || blob === null) return;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        set((s) => (s.blob === null && s.kept ? { ...s, url } : s));
      });
    if (skin.bgPhoto) show('bg', setBg);
    if (skin.heroPhoto) show('hero', setHero);
    return () => {
      alive = false;
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [skin]);

  const pick = (slot: PhotoSlot, set: (s: PhotoState) => void) => (file: File) => {
    setBusy(true);
    setError(null);
    void fitPhoto(file, slot)
      .then((blob) => {
        dirty.current = true;
        set({ blob, kept: false, url: URL.createObjectURL(blob) });
      })
      .catch(() => setError('Не получилось прочитать это фото. Попробуйте другое: подойдут JPEG, PNG и WebP.'))
      .finally(() => setBusy(false));
  };

  const save = async () => {
    if (palette === null) return;
    const clean = name.trim().slice(0, 40);
    if (clean === '') {
      setError('Дайте образу название.');
      return;
    }
    setBusy(true);
    const id = skin?.id ?? `c${Date.now().toString(36)}`;
    const css = patternCss(pattern, palette);
    const next: CustomSkin = {
      id,
      name: clean,
      hex,
      hex2,
      palette,
      traits: traitsLine(traits),
      head: FONT_CHOICES.find((f) => f.value === font)?.head ?? '',
      pattern: css.image,
      patternSize: css.size,
      icons: icons === 'none' ? null : icons,
      bgPhoto: bg.blob !== null || bg.kept,
      heroPhoto: hero.blob !== null || hero.kept,
      veil,
    };
    try {
      // фото: новое записываем, убранное удаляем, прежнее не трогаем
      for (const [slot, state] of [['bg', bg], ['hero', hero]] as const) {
        if (state.blob !== null) await savePhoto(photoKey(id, slot), state.blob);
        else if (!state.kept) await deletePhoto(photoKey(id, slot));
      }
    } catch {
      setBusy(false);
      setError('Фото не сохранилось: браузер не дал места или работает в закрытом режиме. Уберите фото или попробуйте позже.');
      return;
    }
    // список читаем заново: его могли поменять в другой вкладке
    const now = readCustomSkins();
    const list = now.some((s) => s.id === id) ? now.map((s) => (s.id === id ? next : s)) : [...now, next].slice(-MAX_CUSTOM_SKINS);
    if (!writeCustomSkins(list)) {
      setBusy(false);
      setError('Образ не сохранился: на устройстве не хватает места для данных сайта.');
      return;
    }
    setBusy(false);
    onSaved(next, list);
  };

  const set = <K extends keyof SkinTraits>(key: K) => touch((v: SkinTraits[K]) => setTraits((t) => ({ ...t, [key]: v })));

  return (
    <Sheet
      open
      onClose={onClose}
      title={skin ? 'Изменить образ' : 'Свой образ'}
      isDirty={dirty.current}
      dismissible={!busy}
      footer={
        <Button size="lg" fullWidth loading={busy} disabled={palette === null} onClick={() => void save()}>
          Сохранить и применить
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        {palette && (
          <div className="sticky -top-3 z-10 -mx-5 bg-surface/95 px-5 pb-3 pt-3 backdrop-blur">
            <SkinPreview scope="custom" palette={palette} traits={traits} art={hero.url ?? undefined} artFull size={11} className="mx-auto w-40" />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor={nameId} className="text-sm font-semibold text-text">
            Название
          </label>
          <input id={nameId} value={name} maxLength={40} onChange={(e) => touch(setName)(e.target.value)} className={cn(inputClasses(false), 'min-h-[48px]')} />
        </div>

        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-sm font-semibold text-text">Главный цвет</legend>
          <div className="flex flex-wrap items-center gap-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c.hex}
                type="button"
                aria-label={c.label}
                aria-pressed={hex === c.hex}
                onClick={() => touch(setHex)(c.hex)}
                style={{ backgroundColor: c.hex }}
                className={cn('tap-44 h-9 w-9 rounded-full border-2 transition', hex === c.hex ? 'scale-110 border-text' : 'border-transparent')}
              />
            ))}
            <label htmlFor={colorId} className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-control border border-border bg-surface px-3 text-sm font-semibold text-text hover:bg-surface-2">
              <span aria-hidden="true" className="h-5 w-5 rounded-full border border-border" style={{ backgroundColor: hex }} />
              Другой
            </label>
            <input id={colorId} type="color" value={hex} aria-label="Главный цвет: выбрать любой" onChange={(e) => touch(setHex)(e.target.value.toLowerCase())} className="sr-only" />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label htmlFor={color2Id} className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-control border border-border bg-surface px-3 text-sm font-semibold text-text hover:bg-surface-2">
              <span aria-hidden="true" className="h-5 w-5 rounded-full border border-border" style={{ backgroundColor: hex2 ?? `rgb(${triple(palette?.['accent-l'] ?? [128, 128, 128])})` }} />
              Второй цвет
            </label>
            <input id={color2Id} type="color" value={hex2 ?? hex} aria-label="Второй цвет: выбрать любой" onChange={(e) => touch(setHex2)(e.target.value.toLowerCase())} className="sr-only" />
            {hex2 !== null && (
              <button type="button" onClick={() => touch(setHex2)(null)} className="inline-flex min-h-[44px] items-center rounded-control px-3 text-sm font-semibold text-brand hover:bg-brand/10">
                Подобрать самому
              </button>
            )}
          </div>
          <p className="mt-1.5 text-sm text-muted">Светлую и тёмную тему приложение соберёт само и проследит, чтобы текст читался.</p>
        </fieldset>

        <Choice label="Шрифт заголовков" options={FONT_CHOICES} value={font} onChange={touch(setFont)} />
        <Choice label="Узор фона" options={PATTERN_CHOICES} value={pattern} onChange={touch(setPattern)} />
        <Choice label="Значки" options={ICON_CHOICES} value={icons} onChange={touch(setIcons)} />

        <Choice label="Форма" options={options(SHAPES, SHAPE_TEXT)} value={traits.shape} onChange={set('shape')} />
        <Choice label="Карточки" options={options(MATERIALS, MATERIAL_TEXT)} value={traits.material} onChange={set('material')} />
        <Choice label="Нижнее меню" options={options(NAVS, NAV_TEXT)} value={traits.nav} onChange={set('nav')} />
        <Choice label="Карточка «Всего»" options={options(HEROES, HERO_TEXT)} value={traits.hero} onChange={set('hero')} />
        <Choice label="Движение" options={options(MOTIONS, MOTION_TEXT)} value={traits.motion} onChange={set('motion')} />
        <Choice label="Живой фон" options={options(SCENES, SCENE_TEXT)} value={traits.scene} onChange={set('scene')} />

        <fieldset className="flex min-w-0 flex-col gap-4">
          <legend className="mb-1.5 text-sm font-semibold text-text">Свои фото</legend>
          <PhotoField
            label="Фон приложения"
            hint="Фото ляжет под все экраны, слегка прикрытое цветом образа."
            state={bg}
            busy={busy}
            onPick={pick('bg', setBg)}
            onRemove={() => touch(setBg)(NO_PHOTO)}
          />
          {(bg.blob !== null || bg.kept) && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={veilId} className="text-sm font-semibold text-text">
                Насколько прикрыть фото: {Math.round(veil * 100)}%
              </label>
              <input id={veilId} type="range" min={40} max={90} step={5} value={Math.round(veil * 100)} onChange={(e) => touch(setVeil)(Number(e.target.value) / 100)} className="h-11 w-full accent-brand" />
              <p className="text-sm text-muted">Больше — спокойнее фон и легче читать текст.</p>
            </div>
          )}
          <PhotoField
            label="Карточка «Всего»"
            hint="Фото займёт всю карточку на главной и будет приглушено под белый текст."
            state={hero}
            busy={busy}
            onPick={pick('hero', setHero)}
            onRemove={() => touch(setHero)(NO_PHOTO)}
          />
        </fieldset>

        {error !== null && <Notice tone="danger">{error}</Notice>}
      </div>
    </Sheet>
  );
}
