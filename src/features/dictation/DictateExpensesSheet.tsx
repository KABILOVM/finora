import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { TextArea } from '@/components/Field';
import { Sheet } from '@/components/Sheet';
import { MAX_EXPENSES_TEXT, type DictContext, type DraftExpense } from '@/domain/expensesAi';
import type { LocalRow, Wallet } from '@/domain/types';
import { pluralRu } from '@/lib/plural';
import { RecordPanel } from '@/features/shopping/RecordPanel';
import { type ActiveRecorder, type Recording, type StartRecorder, recordingSupported, startRecorder } from '@/features/shopping/recorder';
import type { AiExpensesResult } from './aiExpenses';
import { DraftExpensesEditor } from './DraftExpensesEditor';
import type { SaveResult } from './saveExpenses';

export interface DictateExpensesSheetProps {
  wallets: readonly LocalRow<Wallet>[];
  categories: readonly { id: string; name: string }[];
  defaultWalletId: string;
  today: string;
  /** Разобрать набранный текст (облачная функция с ИИ). Бросает Error с понятным текстом. */
  parse: (text: string, ctx: DictContext, firstRid: number) => Promise<AiExpensesResult>;
  /** Отправить запись голоса: сервер слушает её и возвращает расшифровку и расходы. */
  listen: (rec: Recording, ctx: DictContext, firstRid: number) => Promise<AiExpensesResult>;
  /** Проверить строки без записи: rid → ошибка. */
  validate: (drafts: readonly DraftExpense[]) => Map<number, string>;
  /** Сохранить строки; возвращает, что сохранено и где остановились. */
  save: (drafts: readonly DraftExpense[]) => Promise<SaveResult>;
  startRecording?: StartRecorder;
  canRecord?: boolean;
  /** Закрыть окно. saved — сколько расходов сохранено. */
  onClose: (saved: number) => void;
}

/** Дольше запись не нужна: рассказ о расходах за день укладывается в несколько минут. */
const MAX_SECONDS = 240;

/**
 * «Продиктовать расходы»: человек рассказывает о расходах (или набирает текст), ИИ делает список расходов со счётом, категорией,
 * датой, заметкой и комиссией. Список можно поправить; «Сохранить» записывает каждую строку отдельным расходом.
 */
export function DictateExpensesSheet({
  wallets,
  categories,
  defaultWalletId,
  today,
  parse,
  listen,
  validate,
  save,
  startRecording = startRecorder,
  canRecord = recordingSupported(),
  onClose,
}: DictateExpensesSheetProps) {
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<DraftExpense[] | null>(null);
  const [errors, setErrors] = useState<ReadonlyMap<number, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'starting' | 'recording' | 'listening'>('idle');
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<ActiveRecorder | null>(null);
  const busy = useRef(false);
  const nextRid = useRef(1);
  const savedCount = useRef(0);
  const tooLong = text.length > MAX_EXPENSES_TEXT;
  const ctx = useMemo<DictContext>(
    () => ({
      wallets: wallets.map((w) => ({ id: w.id, name: w.name, currency: w.currency })),
      categories,
      defaultWalletId,
      today: today as DictContext['today'],
    }),
    [wallets, categories, defaultWalletId, today],
  );

  const accept = (r: AiExpensesResult) => {
    nextRid.current += r.drafts.length;
    setErrors(new Map());
    setDrafts(r.drafts);
  };
  const fail = (e: unknown, fallback: string) => setError(e instanceof Error && e.message ? e.message : fallback);

  const run = async () => {
    if (busy.current || text.trim() === '' || tooLong) return;
    busy.current = true;
    setParsing(true);
    setError(null);
    try {
      accept(await parse(text, ctx, nextRid.current));
    } catch (e) {
      fail(e, 'Не удалось разобрать расходы. Попробуйте ещё раз.');
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
      const r = await listen(await rec.stop(), ctx, nextRid.current);
      if (r.transcript) setText(r.transcript);
      accept(r);
    } catch (e) {
      fail(e, 'Не удалось разобрать запись. Попробуйте ещё раз.');
    } finally {
      setPhase('idle');
    }
  };

  const startMic = async () => {
    if (busy.current || phase !== 'idle') return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    setPhase('starting');
    setError(null);
    try {
      recorder.current = await startRecording(setLevel);
      setSeconds(0);
      setDrafts(null);
      setPhase('recording');
    } catch (e) {
      fail(e, 'Не удалось включить микрофон.');
      setPhase('idle');
    }
  };

  const cancelRecording = () => {
    recorder.current?.cancel();
    recorder.current = null;
    setPhase('idle');
  };

  useEffect(() => {
    if (phase !== 'recording') return;
    const t = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);
  useEffect(() => {
    if (phase === 'recording' && seconds >= MAX_SECONDS) void stopRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds, phase]);
  useEffect(() => () => recorder.current?.cancel(), []);

  const saveAll = async () => {
    if (busy.current || !drafts || drafts.length === 0) return;
    const problems = validate(drafts);
    setErrors(problems);
    if (problems.size > 0) {
      setError(`Исправьте ${problems.size} ${pluralRu(problems.size, 'строку', 'строки', 'строк')}: ошибки отмечены красным.`);
      return;
    }
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const r = await save(drafts);
      savedCount.current += r.saved.length;
      const left = drafts.filter((d) => !r.saved.includes(d.rid));
      if (!r.failed && left.length === 0) return onClose(savedCount.current);
      setDrafts(left);
      if (r.failed) {
        setErrors(new Map([[r.failed.rid, r.failed.message]]));
        setError(`Сохранено ${savedCount.current}, остальные не удалось: ${r.failed.message}`);
      }
    } catch (e) {
      fail(e, 'Не удалось сохранить расходы. Попробуйте ещё раз.');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const ready = drafts !== null && drafts.length > 0;

  return (
    <Sheet
      open
      onClose={() => onClose(savedCount.current)}
      dismissible={!saving && !parsing && phase !== 'listening'}
      title="Продиктовать расходы"
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
            <Button size="lg" fullWidth loading={saving} onClick={() => void saveAll()}>
              {`Сохранить ${drafts.length} ${pluralRu(drafts.length, 'расход', 'расхода', 'расходов')}`}
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
            label="Что потратили"
            hint="Нажмите «Продиктовать» и расскажите как удобно: «такси двадцать пять сомони, продукты в Корзинке триста картой Алиф, комиссия пять». Или наберите текст"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setDrafts(null);
              setError(null);
            }}
            error={tooLong ? `Слишком длинно: не больше ${MAX_EXPENSES_TEXT} символов` : undefined}
            rows={4}
            autoComplete="off"
            data-autofocus
          />
        </div>
        {canRecord && phase !== 'recording' && (
          <Button variant="secondary" icon="mic" loading={phase === 'starting'} disabled={phase === 'listening' || parsing || saving} onClick={() => void startMic()}>
            Продиктовать
          </Button>
        )}
        {drafts !== null && drafts.length === 0 && (
          <p role="status" className="text-sm text-muted">
            Не нашёл расходов. Назовите, на что и сколько потратили: «такси двадцать пять».
          </p>
        )}
        {ready && (
          <section aria-label="Что будет сохранено" data-testid="parsed-expenses">
            <h3 className="mb-1 text-sm font-semibold text-muted">Будет сохранено · нажмите расход, чтобы поправить</h3>
            <DraftExpensesEditor
              drafts={drafts}
              onChange={(next) => setDrafts(next.length > 0 ? next : null)}
              wallets={wallets}
              categories={categories}
              today={today}
              errors={errors}
            />
            <p className="mt-2 text-sm text-muted">Неверно распознано? Поправьте текст выше и нажмите «Разобрать» снова — правки в списке при этом сбросятся.</p>
          </section>
        )}
      </div>
    </Sheet>
  );
}
