import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Icon } from '@/components/Icon';
import { cn } from '@/lib/cn';
import { hexToRgb, normalizeHex, oklchToRgb, paletteFromHex, rgbToHex, rgbToOklch, triple } from '@/lib/palette';
import { ACCENTS, CUSTOM_ACCENT, type AccentId } from '@/theme';

export interface AccentPickerProps {
  value: AccentId;
  onChange: (id: AccentId) => void;
  /** Сохранённый «свой цвет» (#rrggbb); null — ещё не выбирали. */
  customHex?: string | null;
  /** Запомнить «свой цвет» и выбрать его акцентом. Не передан — «Свой цвет» в списке не показывается. */
  onCustomChange?: (hex: string) => void;
}

interface Item {
  id: AccentId;
  label: string;
}

const CUSTOM_LABEL = 'Свой цвет';

/** Код цвета: целый (#rrggbb) и «пока набирают» (не больше шести знаков 0–9, a–f). */
const FULL_CODE = /^#?[0-9a-f]{6}$/i;
const PARTIAL_CODE = /^#?[0-9a-f]{0,6}$/i;

/** Цвет, с которого начинается «Свой цвет», пока ничего не сохранено: приятный сине-фиолетовый. */
const START_HEX = '#6d5ef0';

/** Радуга для ползунка оттенка: те же краски, из которых строятся палитры (OKLCH, средняя светлота). */
const HUE_TRACK = `linear-gradient(to right, ${Array.from({ length: 13 }, (_, i) => rgbToHex(oklchToRgb(0.72, 0.16, i * 30))).join(', ')})`;

/** Переменные, по которым .accent-swatch (index.css) рисует кнопку «своего цвета» в светлой и тёмной теме. */
function swatchVars(hex: string | null): CSSProperties | undefined {
  const palette = hex === null ? null : paletteFromHex(hex);
  if (!palette) return undefined;
  return {
    '--ac-brand-l': triple(palette['brand-l']),
    '--ac-accent-l': triple(palette['accent-l']),
    '--ac-brand-d': triple(palette['brand-d']),
    '--ac-accent-d': triple(palette['accent-d']),
  } as CSSProperties;
}

/** Оттенок (градусы) выбранного цвета для ползунка. */
function hueOf(hex: string): number {
  const rgb = hexToRgb(hex);
  return rgb ? Math.round(rgbToOklch(rgb)[2]) : 0;
}

/**
 * Панель «Свой цвет»: системный выбор цвета, ползунок оттенка и поле с кодом. Выбранное применяется сразу; из цвета приложение
 * само строит светлую и тёмную палитры и следит, чтобы текст на них читался (src/lib/palette.ts).
 */
function CustomColorPanel({ hex, onPick }: { hex: string; onPick: (hex: string) => void }) {
  const codeId = useId();
  const hueId = useId();
  const [draft, setDraft] = useState(hex);
  const [invalid, setInvalid] = useState(false);
  // Цвет сменили снаружи (системный выбор, ползунок): поле с кодом показывает его же
  useEffect(() => {
    setDraft(hex);
    setInvalid(false);
  }, [hex]);

  // Пока набирают, применяем только целый код (#rrggbb): короткий #abc раскрылся бы в #aabbcc под руками. Короткий — при уходе из поля.
  const onCode = (raw: string) => {
    setDraft(raw);
    setInvalid(!PARTIAL_CODE.test(raw.trim()));
    const clean = FULL_CODE.test(raw.trim()) ? normalizeHex(raw) : null;
    if (clean !== null && clean !== hex) onPick(clean);
  };
  const onLeave = () => {
    const clean = normalizeHex(draft);
    if (clean === null) {
      setDraft(hex); // не цвет: возвращаем прежний, чтобы поле не врало
      setInvalid(false);
    } else if (clean !== hex) onPick(clean);
    else setDraft(clean);
  };

  return (
    <div data-testid="custom-accent" className="flex flex-col gap-3 rounded-2xl border border-border bg-surface-2/60 p-3">
      <div className="flex items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-text">
          Выбрать цвет
          <input
            type="color"
            value={hex}
            onChange={(e) => onPick(normalizeHex(e.target.value) ?? hex)}
            className="h-12 w-16 cursor-pointer rounded-control border border-border-strong bg-surface p-1"
          />
        </label>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor={codeId} className="text-sm font-semibold text-text">
            Код цвета
          </label>
          <input
            id={codeId}
            value={draft}
            onChange={(e) => onCode(e.target.value)}
            onBlur={onLeave}
            inputMode="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={7}
            placeholder="#6d5ef0"
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${codeId}-error` : undefined}
            className={cn(
              'min-h-[48px] w-full rounded-2xl border bg-surface/80 px-3.5 text-base tabular-nums text-text focus:outline-none focus:ring-4 focus:ring-brand/20',
              invalid ? 'border-danger' : 'border-border-strong focus:border-brand',
            )}
          />
        </div>
      </div>
      {invalid && (
        <p id={`${codeId}-error`} role="alert" className="-mt-1 text-sm font-medium text-danger">
          Нужен код вида #6d5ef0: решётка и шесть цифр или букв a–f.
        </p>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor={hueId} className="text-sm font-semibold text-text">
          Оттенок
        </label>
        <input
          id={hueId}
          type="range"
          min={0}
          max={359}
          step={1}
          value={Math.min(359, hueOf(hex))}
          onChange={(e) => onPick(rgbToHex(oklchToRgb(0.58, 0.19, Number(e.target.value))))}
          className="hue-range"
          style={{ backgroundImage: HUE_TRACK }}
        />
      </div>
      <p className="text-sm text-muted">Остальные оттенки подберём сами и проследим, чтобы текст везде читался — и в светлой, и в тёмной теме.</p>
    </div>
  );
}

/**
 * Выбор цвета акцента: круглые образцы готовых палитр и «Свой цвет». Устроен как Segmented — одна группа radio: внутрь заходят
 * одним Tab, дальше стрелки. Образец показывает кнопку этого акцента в текущей теме (стили .accent-swatch в index.css);
 * выбранный отмечен галочкой и кольцом, а его название написано под образцами, чтобы выбор был виден не только по цвету.
 */
export function AccentPicker({ value, onChange, customHex = null, onCustomChange }: AccentPickerProps) {
  const labelId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const withCustom = onCustomChange !== undefined;
  const items: readonly Item[] = useMemo(
    () => [...ACCENTS.map((a) => ({ id: a.id as AccentId, label: a.label })), ...(withCustom ? [{ id: CUSTOM_ACCENT as AccentId, label: CUSTOM_LABEL }] : [])],
    [withCustom],
  );
  const [panelOpen, setPanelOpen] = useState(value === CUSTOM_ACCENT);
  const customVars = useMemo(() => swatchVars(customHex), [customHex]);
  const chosen = items.find((i) => i.id === value);

  const choose = (id: AccentId) => {
    if (id === CUSTOM_ACCENT) {
      setPanelOpen(true);
      // Цвет уже выбирали — возвращаем его; нет — берём стартовый, а человек подправит его в открывшейся панели
      if (customHex !== null) onChange(CUSTOM_ACCENT);
      else onCustomChange?.(START_HEX);
    } else {
      setPanelOpen(false);
      onChange(id);
    }
  };

  const move = (from: number, delta: number) => {
    const n = items.length;
    const to = (from + delta + n) % n;
    const next = items[to];
    if (!next) return;
    choose(next.id);
    refs.current[to]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      move(index, 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(index, -1);
    }
  };

  // В группу заходят одним Tab: доступен выбранный образец
  const tabStop = chosen ? chosen.id : items[0]?.id;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span id={labelId} className="text-sm font-semibold text-text">
          Цвет акцента
        </span>
        <span aria-live="polite" data-testid="accent-name" className="min-w-0 truncate text-sm text-muted">
          {value === CUSTOM_ACCENT && customHex !== null ? `${CUSTOM_LABEL} ${customHex}` : (chosen?.label ?? '')}
        </span>
      </div>
      <div role="radiogroup" aria-labelledby={labelId} className="grid grid-cols-6 gap-y-1 sm:grid-cols-8 lg:grid-cols-9">
        {items.map((item, i) => {
          const selected = item.id === value;
          const custom = item.id === CUSTOM_ACCENT;
          return (
            <button
              key={item.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={item.label}
              title={item.label}
              // Roving tabindex, как в Segmented: в группу заходим одним Tab, внутри — стрелками.
              tabIndex={item.id === tabStop ? 0 : -1}
              onClick={() => choose(item.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                'flex min-h-[44px] items-center justify-center rounded-2xl transition duration-200 ease-spring active:scale-90',
                selected ? 'bg-brand/10' : 'hover:bg-surface-2',
              )}
            >
              <span
                aria-hidden="true"
                data-accent={custom ? undefined : item.id}
                data-custom={custom ? (customHex !== null ? 'set' : 'empty') : undefined}
                style={custom ? customVars : undefined}
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full text-brand-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]',
                  custom && customVars === undefined ? 'custom-swatch-empty text-white' : 'accent-swatch',
                  selected && 'ring-2 ring-brand ring-offset-2 ring-offset-transparent',
                )}
              >
                {selected ? <Icon name="check" size={20} /> : custom && customVars === undefined ? <Icon name="plus" size={20} /> : null}
              </span>
            </button>
          );
        })}
      </div>
      {withCustom && panelOpen && <CustomColorPanel hex={customHex ?? START_HEX} onPick={onCustomChange} />}
    </div>
  );
}
