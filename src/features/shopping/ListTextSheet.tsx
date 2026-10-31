import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { TextArea } from '@/components/Field';
import { Sheet } from '@/components/Sheet';
import { MAX_AI_TEXT, type ParsedItem } from '@/domain/shoppingAi';
import { bindItem, type CatalogEntry } from '@/domain/shoppingCatalog';
import type { CurrencyCode, Minor } from '@/domain/types';
import { pluralRu } from '@/lib/plural';
import type { AiListResult } from './aiList';
import { ParsedItemsEditor, type EditableItem } from './ParsedItemsEditor';
import { RecordPanel } from './RecordPanel';
import { type ActiveRecorder, type Recording, type StartRecorder, recordingSupported, startRecorder } from './recorder';

export interface ListTextSheetProps {
  /** Названия из списка и прошлых покупок: ИИ пишет известные товары в том же виде. */
  known: readonly string[];
  /** Каталог (что уже вносили): название и единица подтягиваются оттуда, в правке — подсказки. */
  catalog: readonly CatalogEntry[];
  /** Память цен: по ней у каждой позиции видна примерная цена. */
  memory: ReadonlyMap<string, Minor>;
  currency: CurrencyCode;
  /** Разобрать текст на позиции (облачная функция с ИИ). Бросает Error с понятным текстом. */
  parse: (text: string, known: readonly string[]) => Promise<ParsedItem[]>;
  /** Отправить запись голоса: сервер слушает её, возвращает расшифровку и позиции. */
  listen: (rec: Recording, known: readonly string[]) => Promise<AiListResult>;
  /** Запись с микрофона (в тестах подменяется). */
  startRecording?: StartRecorder;
  /** Есть ли у браузера запись голоса (в тестах подменяется). */
  canRecord?: boolean;
  /** Добавить позиции по порядку. Бросает — окно остаётся и показывает ошибку. */
  onAdd: (items: ParsedItem[]) => Promise<void>;
  onClose: () => void;
}

/** Дольше запись не нужна: список из десятков товаров укладывается в минуту. */
const MAX_SECONDS = 60;

/**
 * «Добавить списком»: человек диктует (значок микрофона на клавиатуре телефона) или набирает весь список одним текстом,
 * ИИ разбирает его на позиции (domain/shoppingAi.ts). Результат виден ДО добавления: лишнее можно убрать, текст — поправить и разобрать заново.
 */
export function ListTextSheet({
  known,
  catalog,
  memory,
  currency,
  parse,
  listen,
  startRecording = startRecorder,
  canRecord = recordingSupported(),
  onAdd,
  onClose,
}: ListTextSheetProps) {
  const [text, setText] = useState('');
  const [items, setItems] = useState<EditableItem[] | null>(null);
  const nextRid = useRef(1);
  // Результат разбора: позиции привязываются к каталогу и получают номера строк.
  const accept = (list: ParsedItem[]) => setItems(list.map((i) => ({ ...bindItem(i, catalog), rid: nextRid.current++ })));
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [phase, setPhase] = useState<'idle' | 'starting' | 'recording' | 'listening'>('idle');
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<ActiveRecorder | null>(null);
  const tooLong = text.length > MAX_AI_TEXT;

  const run = async () => {
    if (busy.current || text.trim() === '' || tooLong) return;
    busy.current = true;
    setParsing(true);
    setError(null);
    try {
      accept(await parse(text, known));
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Не удалось разобрать список. Попробуйте ещё раз.');
    } finally {
      busy.current = false;
      setParsing(false);
    }
  };

  const stopRecording = async () => {
    const rec = recorder.current;
    if (!rec || phase !== 'recording') return;
    recorder.current = null;
    setPhase('listening');
    setError(null);
    try {
      const r = await listen(await rec.stop(), known);
      if (r.transcript) setText(r.transcript);
      accept(r.items);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Не удалось разобрать запись. Попробуйте ещё раз.');
    } finally {
      setPhase('idle');
    }
  };

  const startMic = async () => {
    if (busy.current || phase !== 'idle') return;
    // Клавиатура на время записи не нужна: она закрывала бы таймер и кнопку «Остановить».
    (document.activeElement as HTMLElement | null)?.blur?.();
    setPhase('starting');
    setError(null);
    try {
      recorder.current = await startRecording(setLevel);
      setSeconds(0);
      setItems(null);
      setPhase('recording');
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Не удалось включить микрофон.');
      setPhase('idle');
    }
  };

  const cancelRecording = () => {
    recorder.current?.cancel();
    recorder.current = null;
    setPhase('idle');
  };

  // Таймер записи; на пределе запись сама останавливается и уходит на разбор.
  useEffect(() => {
    if (phase !== 'recording') return;
    const t = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);
  useEffect(() => {
    if (phase === 'recording' && seconds >= MAX_SECONDS) void stopRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds, phase]);
  // Окно закрыли во время записи — микрофон выключаем.
  useEffect(() => () => recorder.current?.cancel(), []);

  const add = async () => {
    if (busy.current || !items || items.length === 0) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      await onAdd(items.map(({ name, qtyMilli, unit }) => ({ name, qtyMilli, unit })));
      onClose();
    } catch (e) {
      console.error('Не удалось добавить список:', e);
      setError(e instanceof Error && e.message ? e.message : 'Не удалось добавить список. Попробуйте ещё раз.');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const ready = items !== null && items.length > 0;

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!saving && !parsing && phase !== 'listening'}
      title="Добавить списком"
      footer={
        <div className="flex flex-col gap-2">
          {error && (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          )}
          {phase === 'recording' || phase === 'listening' ? (
            <Button size="lg" fullWidth loading={phase === 'listening'} onClick={() => void stopRecording()}>
              {phase === 'listening' ? 'Слушаю и разбираю…' : 'Остановить'}
            </Button>
          ) : ready ? (
            <Button size="lg" fullWidth loading={saving} onClick={() => void add()}>
              {`Добавить ${items.length} ${pluralRu(items.length, 'позицию', 'позиции', 'позиций')}`}
            </Button>
          ) : (
            <Button size="lg" fullWidth loading={parsing} disabled={text.trim() === '' || tooLong} onClick={() => void run()}>
              {parsing ? 'Разбираю…' : 'Разобрать'}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {phase === 'recording' && (
          <>
            <RecordPanel level={level} seconds={seconds} maxSeconds={MAX_SECONDS} />
            <Button variant="ghost" onClick={cancelRecording}>
              Отмена
            </Button>
          </>
        )}
        <div className={phase === 'recording' ? 'hidden' : undefined}>
          <TextArea
            label="Что купить"
            hint="Нажмите «Продиктовать» и скажите список как удобно, без запятых: «молоко два литра хлеб три булки яблоки полтора кило». Или наберите текст"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setItems(null);
              setError(null);
            }}
            error={tooLong ? `Слишком длинно: не больше ${MAX_AI_TEXT} символов` : undefined}
            rows={4}
            autoComplete="off"
            // На телефоне при записи голосом системная клавиатура не нужна: фокус на кнопку «Продиктовать».
            data-autofocus={canRecord ? undefined : true}
          />
        </div>
        {canRecord && phase !== 'recording' && (
          <Button
            variant="secondary"
            icon="mic"
            data-autofocus
            loading={phase === 'starting'}
            disabled={phase === 'listening' || parsing}
            onClick={() => void startMic()}
          >
            Продиктовать
          </Button>
        )}
        {items !== null && items.length === 0 && (
          <p role="status" className="text-sm text-muted">
            Не нашёл товаров. Назовите товар и, если нужно, количество: «молоко два литра».
          </p>
        )}
        {ready && (
          <section aria-label="Что будет добавлено" data-testid="parsed-items">
            <h3 className="mb-1 text-sm font-semibold text-muted">Будет добавлено · нажмите позицию, чтобы поправить</h3>
            <ParsedItemsEditor
              items={items}
              onChange={(next) => setItems(next.length > 0 ? next : null)}
              catalog={catalog}
              memory={memory}
              currency={currency}
            />
            <p className="mt-2 text-sm text-muted">Неверно распознано? Поправьте текст выше и нажмите «Разобрать» снова.</p>
          </section>
        )}
      </div>
    </Sheet>
  );
}
