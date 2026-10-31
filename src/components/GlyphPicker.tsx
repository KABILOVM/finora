import { useState } from 'react';
import { cn } from '@/lib/cn';
import { Glyph } from './Glyph';
import { GLYPH_CHOICES, GLYPH_LABELS, glyphValue, resolveGlyph } from './glyphs';
import { Segmented } from './Segmented';
import { SERVICES, SERVICE_GROUPS, serviceValue } from './services';

export interface GlyphPickerProps {
  /** Текущее значение поля icon («i:cup», «b:alif», «s:netflix» или эмодзи). */
  value: string;
  onChange: (value: string) => void;
  /** Цвет категории или кошелька: значки показываются в нём. У логотипов сервисов свой, фирменный цвет. */
  color?: string;
  /** Название группы для скринридера. */
  ariaLabel?: string;
  /** Показывать вкладку «Сервисы» (логотипы Netflix, PayPal и других). По умолчанию да. */
  services?: boolean;
  className?: string;
}

type Tab = 'icons' | 'services';

const TABS = [
  { value: 'icons', label: 'Значки' },
  { value: 'services', label: 'Сервисы' },
] as const;

const GRID_STYLE = { gridTemplateColumns: 'repeat(auto-fill, minmax(48px, 1fr))' } as const;

const CELL = 'flex h-12 items-center justify-center rounded-2xl transition duration-200 ease-spring active:scale-90';

/**
 * Сетка значков для категории или кошелька, две вкладки: обычные значки и логотипы сервисов (подписки, платежи).
 * Каждая ячейка — не меньше 44×44. Старое эмодзи отмечается подходящей иконкой. Если сейчас выбран логотип — открывается вкладка сервисов.
 */
export function GlyphPicker({ value, onChange, color, ariaLabel = 'Значок', services = true, className }: GlyphPickerProps) {
  const current = resolveGlyph(value);
  const currentName = current.kind === 'icon' ? current.name : null;
  const currentService = current.kind === 'service' ? current.id : null;
  const [tab, setTab] = useState<Tab>(currentService !== null ? 'services' : 'icons');
  const shown: Tab = services ? tab : 'icons';

  return (
    <div role="group" aria-label={ariaLabel} className={cn('flex flex-col gap-3', className)}>
      {services && <Segmented compact ariaLabel="Набор значков" options={TABS} value={tab} onChange={setTab} />}

      {shown === 'icons' ? (
        <div className="grid gap-1" style={GRID_STYLE}>
          {GLYPH_CHOICES.map((name) => {
            const selected = name === currentName;
            return (
              <button
                key={name}
                type="button"
                aria-label={GLYPH_LABELS[name] ?? name}
                aria-pressed={selected}
                onClick={() => onChange(glyphValue(name))}
                className={cn(CELL, selected ? 'bg-brand/15 ring-2 ring-brand' : 'hover:bg-surface-2')}
              >
                <Glyph value={glyphValue(name)} color={color} size={36} />
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {SERVICE_GROUPS.map((group) => (
            <div key={group.id} role="group" aria-label={group.label} className="flex flex-col gap-1">
              <span className="px-1 text-xs font-semibold text-muted">{group.label}</span>
              <div className="grid gap-1" style={GRID_STYLE}>
                {SERVICES.filter((s) => s.group === group.id).map((s) => {
                  const selected = s.id === currentService;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-label={s.name}
                      aria-pressed={selected}
                      onClick={() => onChange(serviceValue(s.id))}
                      className={cn(CELL, selected ? 'bg-brand/15 ring-2 ring-brand' : 'hover:bg-surface-2')}
                    >
                      <Glyph value={serviceValue(s.id)} size={36} />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
