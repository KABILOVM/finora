import { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { TextArea } from '@/components/Field';
import { IconButton } from '@/components/IconButton';
import { Sheet } from '@/components/Sheet';
import { itemTitle, UNIT_LABEL } from '@/domain/shopping';
import { MAX_AI_TEXT, type ParsedItem } from '@/domain/shoppingAi';
import { pluralRu } from '@/lib/plural';

export interface ListTextSheetProps {
  /** Названия из списка и прошлых покупок: ИИ пишет известные товары в том же виде. */
  known: readonly string[];
  /** Разобрать текст на позиции (облачная функция с ИИ). Бросает Error с понятным текстом. */
  parse: (text: string, known: readonly string[]) => Promise<ParsedItem[]>;
  /** Добавить позиции по порядку. Бросает — окно остаётся и показывает ошибку. */
  onAdd: (items: ParsedItem[]) => Promise<void>;
  onClose: () => void;
}

const amount = (i: ParsedItem): string =>
  i.unit === 'pcs' && i.qtyMilli === 1000 ? '1 шт' : itemTitle('', i.qtyMilli, i.unit).trim() || UNIT_LABEL[i.unit];

/**
 * «Добавить списком»: человек диктует (значок микрофона на клавиатуре телефона) или набирает весь список одним текстом,
 * ИИ разбирает его на позиции (domain/shoppingAi.ts). Результат виден ДО добавления: лишнее можно убрать, текст — поправить и разобрать заново.
 */
export function ListTextSheet({ known, parse, onAdd, onClose }: ListTextSheetProps) {
  const [text, setText] = useState('');
  const [items, setItems] = useState<ParsedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const tooLong = text.length > MAX_AI_TEXT;

  const run = async () => {
    if (busy.current || text.trim() === '' || tooLong) return;
    busy.current = true;
    setParsing(true);
    setError(null);
    try {
      setItems(await parse(text, known));
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Не удалось разобрать список. Попробуйте ещё раз.');
    } finally {
      busy.current = false;
      setParsing(false);
    }
  };

  const add = async () => {
    if (busy.current || !items || items.length === 0) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      await onAdd(items);
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
      dismissible={!saving && !parsing}
      title="Добавить списком"
      footer={
        <div className="flex flex-col gap-2">
          {error && (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          )}
          {ready ? (
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
        <TextArea
          label="Что купить"
          hint="Нажмите значок микрофона на клавиатуре и скажите список как удобно, без запятых: «молоко два литра хлеб три булки яблоки полтора кило»"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setItems(null);
            setError(null);
          }}
          error={tooLong ? `Слишком длинно: не больше ${MAX_AI_TEXT} символов` : undefined}
          rows={4}
          autoComplete="off"
          data-autofocus
        />
        {items !== null && items.length === 0 && (
          <p role="status" className="text-sm text-muted">
            Не нашёл товаров. Назовите товар и, если нужно, количество: «молоко два литра».
          </p>
        )}
        {ready && (
          <section aria-label="Что будет добавлено" data-testid="parsed-items">
            <h3 className="mb-1 text-sm font-semibold text-muted">Будет добавлено · проверьте</h3>
            <ul className="divide-y divide-border rounded-2xl bg-surface-2 pl-3 pr-1">
              {items.map((i, n) => (
                <li key={`${i.name}-${n}`} className="flex items-center justify-between gap-2 py-0.5">
                  <span className="min-w-0 flex-1 truncate font-medium">{i.name}</span>
                  <span className="shrink-0 text-muted">{amount(i)}</span>
                  <IconButton
                    icon="close"
                    iconSize={18}
                    label={`Убрать: ${i.name}`}
                    onClick={() =>
                      setItems((cur) => {
                        const next = cur ? cur.filter((_, k) => k !== n) : null;
                        return next && next.length > 0 ? next : null;
                      })
                    }
                  />
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm text-muted">Неверно? Поправьте текст выше и нажмите «Разобрать» снова.</p>
          </section>
        )}
      </div>
    </Sheet>
  );
}
