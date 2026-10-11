import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { useSettings, useStore } from '@/db';
import { ImportFileError, type ImportPlan, type WalletChoice } from '@/import/types';
import { buildPlan } from '@/import/plan';
import { runImport, type ImportProgress, type ImportReport } from '@/import/runImport';
import { useRates } from '@/rates/hooks';
import { DoneStep } from './DoneStep';
import { PickStep } from './PickStep';
import { PreviewStep } from './PreviewStep';
import { parseRateInput, rateToText } from './rateInput';
import { loadImportFile, type ImportSession } from './readFile';
import { RunStep } from './RunStep';

type Stage =
  | { name: 'pick' }
  | { name: 'reading'; fileName: string }
  | { name: 'preview'; session: ImportSession }
  | { name: 'running'; session: ImportSession; progress: ImportProgress; stopping: boolean }
  | { name: 'done'; report: ImportReport };

const SUBTITLE: Record<Stage['name'], string> = {
  pick: 'Перенос истории операций из файла',
  reading: 'Читаем файл',
  preview: 'Проверьте, что будет добавлено',
  running: 'Идёт импорт',
  done: 'Готово',
};

/** Курсы из текстов полей: непонятный текст — «курса нет». */
function ratesOf(texts: Readonly<Record<string, string>>): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const [cur, text] of Object.entries(texts)) out[cur] = parseRateInput(text);
  return out;
}

/**
 * Импорт из Zenmoney (CSV): 1) выбор файла, 2) предпросмотр (счётчики, курсы, сопоставление), 3) подтверждение, 4) итог.
 * Всё считается на устройстве. Запись идемпотентна (id операций выводятся из строк файла): повторная загрузка того же файла
 * ничего не дублирует и не затирает. Закрытие экрана во время записи останавливает её на границе порции.
 */
export default function ImportPage() {
  const store = useStore();
  const settings = useSettings();
  const { getRate } = useRates();
  const base = settings?.baseCurrency;

  const [stage, setStage] = useState<Stage>({ name: 'pick' });
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, WalletChoice>>({});
  const [rateTexts, setRateTexts] = useState<Record<string, string>>({});

  // Живые кошельки и категории ВМЕСТЕ с удалёнными и архивными: нужны, чтобы заметить конфликт с id прошлого импорта.
  const dbRows = useLiveQuery(async () => ({ wallets: await store.db.wallets.toArray(), categories: await store.db.categories.toArray() }), [store]);

  const alive = useRef(true);
  const run = useRef<AbortController | null>(null);
  const loading = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      run.current?.abort(); // экран закрыли: останавливаем запись на границе порции, записанное остаётся целым
    };
  }, []);

  const session = stage.name === 'preview' ? stage.session : null;
  const deferredChoices = useDeferredValue(choices);
  const deferredTexts = useDeferredValue(rateTexts);

  const makePlan = useCallback(
    (walletChoices: Record<string, WalletChoice>, texts: Record<string, string>): ImportPlan | null => {
      if (!session || !base || !dbRows) return null;
      return buildPlan({
        parsed: session.parsed,
        ids: session.ids,
        baseCurrency: base,
        wallets: dbRows.wallets,
        categories: dbRows.categories,
        existing: session.existing,
        walletChoices,
        rates: ratesOf(texts),
      });
    },
    [session, base, dbRows],
  );
  // Для экрана план строится «с запозданием» (набор текста в поле курса не тормозит на больших файлах)
  const plan = useMemo(() => makePlan(deferredChoices, deferredTexts), [makePlan, deferredChoices, deferredTexts]);

  const onFile = useCallback(
    async (file: File) => {
      if (loading.current || !base) return;
      loading.current = true;
      setError(null);
      setStage({ name: 'reading', fileName: file.name });
      try {
        const s = await loadImportFile(store, file);
        if (!alive.current) return;
        // Курс по умолчанию — текущий (если он есть). Человек его видит в поле и может поменять.
        const foreign = new Set<string>();
        for (const row of s.parsed.rows) for (const side of [row.outcome, row.income]) if (side && side.account.currency !== base) foreign.add(side.account.currency);
        const texts: Record<string, string> = {};
        for (const cur of foreign) {
          const found = getRate(cur, base);
          texts[cur] = found ? rateToText(found.rate) : '';
        }
        setChoices({});
        setRateTexts(texts);
        setStage({ name: 'preview', session: s });
      } catch (e) {
        if (!alive.current) return;
        if (e instanceof ImportFileError) setError(e.message);
        else {
          console.error('Импорт: не удалось прочитать файл', e);
          setError('Не удалось прочитать файл. Попробуйте ещё раз или выберите другой файл.');
        }
        setStage({ name: 'pick' });
      } finally {
        loading.current = false;
      }
    },
    [store, base, getRate],
  );

  const start = useCallback(async () => {
    if (!session || run.current) return; // повторное нажатие во время записи игнорируется
    // Пишем ровно то, что человек выбрал и набрал к этому моменту (экранный план мог отстать на кадр)
    const plan = makePlan(choices, rateTexts);
    if (!plan) return;
    const ctl = new AbortController();
    run.current = ctl;
    setError(null);
    setStage({ name: 'running', session, progress: { phase: 'wallets', done: 0, total: plan.counts.add }, stopping: false });
    try {
      const report = await runImport(store, plan, {
        signal: ctl.signal,
        onProgress: (progress) => {
          if (alive.current) setStage((s) => (s.name === 'running' ? { ...s, progress } : s));
        },
      });
      if (alive.current) setStage({ name: 'done', report });
    } catch (e) {
      console.error('Импорт: сбой записи', e);
      if (alive.current) {
        setError('Импорт прервался из-за ошибки. Уже записанное осталось целым; загрузите файл ещё раз, и импорт продолжится без повторов.');
        setStage({ name: 'pick' });
      }
    } finally {
      run.current = null;
    }
  }, [makePlan, session, store, choices, rateTexts]);

  const stop = useCallback(() => {
    run.current?.abort();
    setStage((s) => (s.name === 'running' ? { ...s, stopping: true } : s));
  }, []);

  const again = useCallback(() => {
    setError(null);
    setChoices({});
    setRateTexts({});
    setStage({ name: 'pick' });
  }, []);

  return (
    <>
      <PageHeader title="Импорт из Zenmoney" subtitle={SUBTITLE[stage.name]} />
      {(settings === undefined || dbRows === undefined) && (
        <p role="status" className="py-10 text-center text-muted">
          Загрузка…
        </p>
      )}
      {settings === null && (
        <p role="alert" className="rounded-xl bg-danger/10 p-3 font-medium text-danger">
          Настройки ещё не созданы: дождитесь первой загрузки данных и откройте импорт снова.
        </p>
      )}
      {base && dbRows && (
        <>
          {stage.name === 'pick' && <PickStep onFile={(f) => void onFile(f)} error={error} />}
          {stage.name === 'reading' && (
            <p role="status" className="py-10 text-center text-muted">
              Читаем файл «{stage.fileName}»…
            </p>
          )}
          {stage.name === 'preview' && plan && (
            <PreviewStep
              plan={plan}
              fileName={stage.session.fileName}
              rateTexts={rateTexts}
              onRate={(cur, text) => setRateTexts((t) => ({ ...t, [cur]: text }))}
              onChoose={(key, choice) => setChoices((c) => ({ ...c, [key]: choice }))}
              onBack={again}
              onStart={() => void start()}
              error={error}
            />
          )}
          {stage.name === 'running' && <RunStep progress={stage.progress} stopping={stage.stopping} onStop={stop} />}
          {stage.name === 'done' && <DoneStep report={stage.report} onAgain={again} />}
        </>
      )}
    </>
  );
}
