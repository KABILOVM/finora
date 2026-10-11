import { useState } from 'react';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useStore, ValidationError } from '@/db';
import { pluralRu } from '@/lib/plural';
import { useAppEnv } from './env';
import { markLocalDataHandled, transferLocalData, useLocalData } from './localData';

type View = { kind: 'offer' } | { kind: 'busy' } | { kind: 'done'; added: number } | { kind: 'error'; message: string } | { kind: 'hidden' };

/**
 * Плашка «Есть записи, сделанные без входа». Появляется, когда на устройстве вели учёт без облака, а потом облако подключили:
 * в аккаунте этих записей нет, и без плашки они выглядели бы пропавшими. Предлагает перенести их в аккаунт.
 */
export function LocalDataNotice() {
  const { count } = useLocalData();
  const { deps } = useAppEnv();
  const store = useStore();
  const [view, setView] = useState<View>({ kind: 'offer' });

  if (view.kind === 'hidden' || (count <= 0 && view.kind === 'offer')) return null;

  const transfer = async () => {
    if (view.kind === 'busy') return;
    setView({ kind: 'busy' });
    try {
      const r = await transferLocalData(deps, store);
      await markLocalDataHandled(store);
      setView({ kind: 'done', added: r.added });
    } catch (e) {
      console.error('Не удалось перенести записи локального режима:', e);
      const why = e instanceof ValidationError ? ` ${e.message}.` : '';
      setView({ kind: 'error', message: `Не удалось перенести записи.${why} Ничего не изменилось, можно попробовать ещё раз.` });
    }
  };

  const skip = async () => {
    await markLocalDataHandled(store);
    setView({ kind: 'hidden' });
  };

  const n = `${count} ${pluralRu(count, 'запись', 'записи', 'записей')}`;
  return (
    <div role="note" data-testid="local-data-notice" className="mb-2 flex flex-col gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-[14px] leading-snug">
      <div className="flex items-start gap-2">
        <Icon name="info" size={18} className="mt-0.5 shrink-0 text-warning" />
        {view.kind === 'done' ? (
          <p role="status" className="min-w-0 flex-1">
            <strong className="font-semibold">Готово.</strong> Записи, сделанные без входа, перенесены в аккаунт (добавлено: {view.added}). Они отправятся в облако.
          </p>
        ) : (
          <p className="min-w-0 flex-1">
            <strong className="font-semibold">Есть записи, сделанные без входа ({n}).</strong> Они остались на этом устройстве, но в аккаунте их
            нет. Перенести их в аккаунт? Если не переносить, открыть их из приложения будет нельзя.
          </p>
        )}
      </div>
      {view.kind === 'error' && (
        <p role="alert" className="font-medium text-danger">
          {view.message}
        </p>
      )}
      {view.kind !== 'done' && (
        <div className="flex flex-wrap gap-2">
          <Button loading={view.kind === 'busy'} onClick={() => void transfer()}>
            Перенести в аккаунт
          </Button>
          <Button variant="secondary" disabled={view.kind === 'busy'} onClick={() => void skip()}>
            Не переносить
          </Button>
        </div>
      )}
    </div>
  );
}
