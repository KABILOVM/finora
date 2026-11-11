import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Glyph } from '@/components/Glyph';
import { PageHeader } from '@/components/PageHeader';
import { SectionHeader } from '@/components/SectionHeader';
import { Switch } from '@/components/Switch';
import { useToast } from '@/components/Toast';
import { useStore } from '@/db';
import { parseHome, stringifyHome, type HomeItem, type HomeSize } from '@/domain/homeLayout';
import { cn } from '@/lib/cn';
import { HOME_PRESETS, matchPreset, presetHome, reorderShown, resolveHome, setShown, setSize, shiftShown, sizeOf, slotsOf, type HomePresetId, type HomeSlot } from './layout';

/** Раскладка, которую уже видно на экране, но настройки ещё не подтвердили запись (чтобы список не «прыгал» назад на мгновение). */
interface Pending {
  items: HomeItem[] | null;
  text: string | null;
}

/** Что видно, пока блок тащат: какой блок, откуда и куда он встанет, на сколько сдвинут и его высота (на неё расступаются соседи). */
interface DragView {
  id: string;
  from: number;
  to: number;
  dy: number;
  height: number;
}

/** Что помнит перетаскивание между событиями указателя (не состояние: менять его можно сколько угодно раз за кадр). */
interface DragMemory {
  id: string;
  ids: string[];
  from: number;
  to: number;
  /** Положение указателя в странице в момент захвата (с учётом прокрутки). */
  startY: number;
  /** Середины строк в странице на момент захвата. */
  mids: number[];
  height: number;
  clientY: number;
  raf: number | null;
}

/** Зоны у краёв экрана, где список сам прокручивается, пока блок тащат (сверху шапка, снизу панель разделов). */
const EDGE_TOP = 96;
const EDGE_BOTTOM = 120;

const SIZE_LABEL: Record<HomeSize, string> = { full: 'Вся ширина', half: 'Половина' };

/** Шесть точек — ручка перетаскивания. */
function Grip() {
  return (
    <svg aria-hidden="true" width="14" height="20" viewBox="0 0 14 20" fill="currentColor">
      {[4, 10, 16].flatMap((y) => [3, 11].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.8" />))}
    </svg>
  );
}

function BlockText({ slot }: { slot: HomeSlot }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-base font-semibold">{slot.block.title}</span>
      <span className="block text-sm leading-snug text-muted">{slot.block.hint}</span>
      {slot.block.when && <span className="block text-xs leading-snug text-muted/80">{slot.block.when}</span>}
    </span>
  );
}

/**
 * «Настройка главной» (адрес `/?edit=1`; вход — «Настроить главную» внизу главной и строка «Главный экран» в «Настройках»). Сверху
 * готовые наборы; дальше блоки, которые сейчас на главной, в их порядке: блок перетаскивают за ручку (или двигают стрелками
 * ↑/↓, когда ручка в фокусе), выключателем убирают с главной, а у блоков с узким видом выбирают ширину. Ниже — скрытые блоки:
 * выключатель возвращает блок на главную на прежнее место. Каждое изменение сохраняется сразу — в настройки, поэтому раскладка
 * появляется на всех устройствах человека. «Готово» возвращает на главную.
 * `home` — текущая запись раскладки из настроек (её уже прочитала главная): список сразу настоящий, без мгновения со стандартным.
 */
export default function HomeEditor({ home: text }: { home: string | null }) {
  const store = useStore();
  const toast = useToast();
  // непонятная запись (её оставило более новое приложение) читается как «не задана»
  const stored = useMemo(() => parseHome(text), [text]);
  const savedItems = useMemo(() => resolveHome(stored), [stored]);
  const navigate = useNavigate();
  const location = useLocation();

  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => {
    if (pending && pending.text === text) setPending(null);
  }, [pending, text]);
  const items = useMemo(() => (pending ? resolveHome(pending.items) : savedItems), [pending, savedItems]);
  const current = pending ? pending.items : stored;

  const slots = useMemo(() => slotsOf(items), [items]);
  const shown = slots.filter((s) => s.on);
  const hidden = slots.filter((s) => !s.on);
  const preset = matchPreset(current === null ? null : items);

  const [live, setLive] = useState('');
  const [drag, setDrag] = useState<DragView | null>(null);
  const memory = useRef<DragMemory | null>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const handles = useRef(new Map<string, HTMLButtonElement>());
  /** Блок, ручке которого надо вернуть фокус после перестановки с клавиатуры (перенос узла в списке фокус сбрасывает). */
  const refocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (refocus.current === null) return;
    handles.current.get(refocus.current)?.focus();
    refocus.current = null;
  });

  const apply = useCallback(
    (next: HomeItem[] | null) => {
      const nextText = next === null ? null : stringifyHome(next);
      setPending({ items: next, text: nextText });
      store.settings.update({ home: nextText }).catch((e: unknown) => {
        console.error('Не удалось сохранить раскладку главной:', e);
        setPending(null);
        toast.error('Не удалось сохранить раскладку. Попробуйте ещё раз.');
      });
    },
    [store, toast],
  );

  /** Крупная перемена (готовый набор, сброс): применяем сразу и даём «Отменить». */
  const applyWithUndo = (next: HomeItem[] | null, message: string) => {
    const before = current;
    apply(next);
    toast.success(message, { durationMs: 7000, action: { label: 'Отменить', onClick: () => apply(before) } });
  };

  const pickPreset = (id: HomePresetId) => {
    if (id === preset) return;
    applyWithUndo(presetHome(id, items), `Главная: набор «${HOME_PRESETS.find((p) => p.id === id)?.title ?? ''}»`);
  };

  const done = () => {
    // пришли по ссылке из приложения — возвращаемся, как «Назад»; открыли адрес напрямую — заменяем его главной
    if ((location.state as { homeEdit?: boolean } | null)?.homeEdit) navigate(-1);
    else navigate('/', { replace: true });
  };

  const moveByKey = (slot: HomeSlot, delta: number) => {
    const order = shown.map((s) => s.block.id);
    const to = order.indexOf(slot.block.id) + delta;
    if (to < 0 || to >= order.length) return;
    refocus.current = slot.block.id;
    apply(shiftShown(items, slot.block.id, delta));
    setLive(`«${slot.block.title}»: место ${to + 1} из ${order.length}`);
  };

  const onHandleKey = (e: KeyboardEvent, slot: HomeSlot) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    moveByKey(slot, e.key === 'ArrowUp' ? -1 : 1);
  };

  // ───────────────────────── перетаскивание ─────────────────────────

  /** Пересчёт по последнему положению указателя: сдвиг блока и место, куда он встанет. */
  const track = () => {
    const m = memory.current;
    if (!m) return;
    const dy = m.clientY + window.scrollY - m.startY;
    const center = m.mids[m.from]! + dy;
    let to = m.from;
    // вниз: блок занимает место строки, середину которой прошёл его нижний край; вверх — верхний
    for (let j = m.from + 1; j < m.mids.length && m.mids[j]! < center + m.height / 2; j++) to = j;
    for (let j = m.from - 1; j >= 0 && m.mids[j]! > center - m.height / 2; j--) to = j;
    m.to = to;
    setDrag({ id: m.id, from: m.from, to, dy, height: m.height });
  };

  /** У края экрана список едет сам, пока блок держат. */
  const autoScroll = () => {
    const m = memory.current;
    if (!m) return;
    const y = m.clientY;
    const bottom = window.innerHeight - EDGE_BOTTOM;
    const speed = y < EDGE_TOP ? -Math.min(18, (EDGE_TOP - y) / 4 + 2) : y > bottom ? Math.min(18, (y - bottom) / 4 + 2) : 0;
    if (speed === 0) {
      m.raf = null;
      return;
    }
    window.scrollBy(0, speed);
    track();
    m.raf = requestAnimationFrame(autoScroll);
  };

  const onGrab = (e: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const ids: string[] = shown.map((s) => s.block.id);
    const from = ids.indexOf(id);
    const rects = ids.map((i) => rows.current.get(i)?.getBoundingClientRect());
    if (from < 0 || rects.some((r) => !r)) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const height = rects[from]!.height;
    memory.current = {
      id,
      ids,
      from,
      to: from,
      startY: e.clientY + window.scrollY,
      mids: rects.map((r) => r!.top + r!.height / 2 + window.scrollY),
      height,
      clientY: e.clientY,
      raf: null,
    };
    setDrag({ id, from, to: from, dy: 0, height });
  };

  const onDragMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const m = memory.current;
    if (!m) return;
    m.clientY = e.clientY;
    track();
    if (m.raf === null) m.raf = requestAnimationFrame(autoScroll);
  };

  const onRelease = (commit: boolean) => {
    const m = memory.current;
    if (!m) return;
    if (m.raf !== null) cancelAnimationFrame(m.raf);
    memory.current = null;
    setDrag(null);
    if (!commit || m.to === m.from) return;
    const order = [...m.ids];
    order.splice(m.to, 0, ...order.splice(m.from, 1));
    apply(reorderShown(items, order));
    setLive(`«${slots.find((s) => s.block.id === m.id)?.block.title ?? ''}»: место ${m.to + 1} из ${order.length}`);
  };

  // ушли со страницы, не отпустив блок: кадр прокрутки не должен остаться висеть
  useEffect(
    () => () => {
      if (memory.current?.raf != null) cancelAnimationFrame(memory.current.raf);
    },
    [],
  );

  /** Сдвиг строки, пока блок тащат: сам блок едет за пальцем, соседи между старым и новым местом расступаются на его высоту. */
  const shift = (index: number, id: string): number => {
    if (!drag) return 0;
    if (id === drag.id) return drag.dy;
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return -drag.height;
    if (drag.to < drag.from && index >= drag.to && index < drag.from) return drag.height;
    return 0;
  };

  return (
    <>
      <PageHeader
        title="Настройка главной"
        subtitle="Что показывать на главной и в каком порядке"
        actions={
          <Button onClick={done} data-testid="home-edit-done">
            Готово
          </Button>
        }
      />
      <p aria-live="polite" className="sr-only">
        {live}
      </p>

      <section aria-labelledby="home-edit-presets" className="mb-5">
        <SectionHeader id="home-edit-presets">Готовые наборы</SectionHeader>
        <div className="scroll-x-quiet -mx-4 flex gap-2 px-4 pb-1 md:mx-0 md:flex-wrap md:px-0" role="group" aria-label="Готовые наборы">
          {HOME_PRESETS.map((p) => {
            const active = p.id === preset;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={active}
                onClick={() => pickPreset(p.id)}
                className={cn(
                  'press flex min-h-[56px] shrink-0 flex-col items-start justify-center rounded-2xl border px-3.5 py-1.5 text-left transition-colors',
                  active ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-surface hover:bg-surface-2',
                )}
              >
                <span className="text-sm font-semibold">{p.title}</span>
                <span className={cn('text-xs', active ? 'text-brand/80' : 'text-muted')}>{p.hint}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="home-edit-shown" className="mb-5">
        <SectionHeader id="home-edit-shown" action={<span className="text-sm text-muted">{shown.length}</span>}>
          На главной
        </SectionHeader>
        <p id="home-edit-help" className="mb-2 px-1 text-sm text-muted">
          Перетащите блок за ручку слева, чтобы поменять порядок. Выключатель убирает блок с главной.
        </p>
        {shown.length === 0 ? (
          <Card>
            <p className="text-muted">Все блоки скрыты. Включите нужные ниже или выберите готовый набор.</p>
          </Card>
        ) : (
          <Card padding="none" className={cn(drag ? 'overflow-visible' : 'overflow-hidden')}>
            <ul className="select-none" aria-label="Блоки на главной" data-testid="home-edit-shown">
              {shown.map((slot, index) => {
                const { block } = slot;
                const dragging = drag?.id === block.id;
                const dy = shift(index, block.id);
                const size = sizeOf(slot);
                return (
                  <li
                    key={block.id}
                    ref={(el) => {
                      if (el) rows.current.set(block.id, el);
                      else rows.current.delete(block.id);
                    }}
                    data-testid={`home-edit-row-${block.id}`}
                    data-dragging={dragging || undefined}
                    style={dy !== 0 || dragging ? { transform: `translateY(${dy}px)${dragging ? ' scale(1.02)' : ''}` } : undefined}
                    className={cn(
                      'relative border-b border-border last:border-b-0',
                      drag && !dragging && 'transition-transform duration-200 ease-out',
                      dragging && 'z-10 rounded-2xl border-b-0 bg-surface shadow-float ring-1 ring-brand/30',
                    )}
                  >
                    <div className="flex items-center gap-1 py-2 pl-1 pr-2">
                      <button
                        type="button"
                        ref={(el) => {
                          if (el) handles.current.set(block.id, el);
                          else handles.current.delete(block.id);
                        }}
                        aria-label={`Переместить: ${block.title}`}
                        aria-describedby="home-edit-keys"
                        onPointerDown={(e) => onGrab(e, block.id)}
                        onPointerMove={onDragMove}
                        onPointerUp={() => onRelease(true)}
                        onPointerCancel={() => onRelease(false)}
                        onLostPointerCapture={() => onRelease(false)}
                        onKeyDown={(e) => onHandleKey(e, slot)}
                        className={cn(
                          'flex h-11 w-11 shrink-0 touch-none items-center justify-center rounded-xl text-muted hover:bg-surface-2 hover:text-text',
                          dragging ? 'cursor-grabbing text-brand' : 'cursor-grab',
                        )}
                      >
                        <Grip />
                      </button>
                      <Glyph value={`i:${block.icon}`} color={block.color} size={36} />
                      <span className="ml-1.5 flex min-w-0 flex-1 flex-col">
                        <BlockText slot={slot} />
                      </span>
                      <Switch checked label={`Показывать на главной: ${block.title}`} onChange={() => apply(setShown(items, block.id, false))} />
                    </div>
                    {/* у компактных карточек половина бывает только от 560 px: на телефоне выбора нет, там они всегда во всю ширину */}
                    {block.half !== 'never' && (
                      <div className={cn('pb-2 pl-[6.125rem] pr-3', block.half === 'wide' && 'hidden min-[560px]:block')}>
                        <div role="radiogroup" aria-label={`Ширина: ${block.title}`} className="flex gap-1.5">
                          {(['full', 'half'] as const).map((s) => (
                            <button
                              key={s}
                              type="button"
                              role="radio"
                              aria-checked={size === s}
                              onClick={() => size !== s && apply(setSize(items, block.id, s))}
                              className={cn(
                                'min-h-[44px] rounded-full border px-3 text-sm font-semibold transition-colors',
                                size === s ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:text-text',
                              )}
                            >
                              {SIZE_LABEL[s]}
                            </button>
                          ))}
                        </div>
                        {block.half === 'wide' && size === 'half' && <p className="mt-1 text-xs text-muted">На телефоне блок остаётся во всю ширину.</p>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
        <p id="home-edit-keys" className="sr-only">
          Стрелки вверх и вниз меняют место блока.
        </p>
      </section>

      {hidden.length > 0 && (
        <section aria-labelledby="home-edit-hidden" className="mb-5">
          <SectionHeader id="home-edit-hidden" action={<span className="text-sm text-muted">{hidden.length}</span>}>
            Можно добавить
          </SectionHeader>
          <Card padding="none" className="overflow-hidden">
            <ul className="divide-y divide-border" aria-label="Скрытые блоки" data-testid="home-edit-hidden">
              {hidden.map((slot) => (
                <li key={slot.block.id} data-testid={`home-edit-row-${slot.block.id}`} className="flex items-center gap-3 py-2 pl-4 pr-2">
                  <Glyph value={`i:${slot.block.icon}`} color={slot.block.color} size={36} className="opacity-70" />
                  <BlockText slot={slot} />
                  <Switch checked={false} label={`Показывать на главной: ${slot.block.title}`} onChange={() => apply(setShown(items, slot.block.id, true))} />
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      <div className="flex flex-wrap gap-2 pb-2">
        <Button size="lg" className="min-w-[9rem] flex-1" onClick={done}>
          Готово
        </Button>
        {current !== null && (
          <Button variant="ghost" size="lg" className="min-w-[9rem] flex-1" onClick={() => applyWithUndo(null, 'Главная снова стандартная')}>
            Сбросить
          </Button>
        )}
      </div>
      <p className="px-1 pb-2 text-sm text-muted">Раскладка сохраняется сама и появляется на всех ваших устройствах.</p>
    </>
  );
}
