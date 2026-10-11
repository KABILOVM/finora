import { useState } from 'react';
import { Card } from '@/components/Card';
import { Glyph } from '@/components/Glyph';
import { Icon } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import { Wordmark } from '@/components/Wordmark';
import { cn } from '@/lib/cn';

export interface StartStepProps {
  onScratch: () => void;
  onZenmoney: () => void;
  onBackup: () => void;
  onSkip: () => void;
}

function Choice({ icon, color, title, text, onClick }: { icon: string; color: string; title: string; text: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-[88px] w-full items-center gap-3 rounded-3xl border border-border/70 bg-surface/75 p-4 text-left shadow-card backdrop-blur-xl',
        'transition duration-200 ease-spring hover:bg-surface-2 active:scale-[0.98]',
      )}
    >
      <Glyph value={icon} color={color} size={48} />
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-bold">{title}</span>
        <span className="block text-sm text-muted">{text}</span>
      </span>
      <Icon name="chevron" size={18} className="shrink-0 text-muted" />
    </button>
  );
}

/** Шаг 0 «Как начнём?»: перенести из другого приложения, создать с нуля, либо пропустить мастер. */
export function StartStep({ onScratch, onZenmoney, onBackup, onSkip }: StartStepProps) {
  const [moving, setMoving] = useState(false);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Настройка Finora"
      className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-bg text-text"
    >
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-4">
          <div className="flex flex-col items-center gap-2 text-center">
            <Logo size={56} />
            <Wordmark className="text-2xl" />
          </div>
          <div className="text-center">
            <h1 id="onb-start-title" tabIndex={-1} className="text-2xl font-bold tracking-tight outline-none">
              {moving ? 'Откуда переносим?' : 'Как начнём?'}
            </h1>
            <p className="mt-1 text-base text-muted">
              {moving ? 'Выберите, в каком виде у вас есть данные.' : 'Займёт пару минут. Всё можно будет поменять потом.'}
            </p>
          </div>

          {!moving ? (
            <div className="flex flex-col gap-3">
              <Choice icon="i:upload" color="#0891b2" title="Перенести из другого приложения" text="Уже вели учёт: загрузим файл" onClick={() => setMoving(true)} />
              <Choice icon="i:wallet" color="#16a34a" title="Создать с нуля" text="Выберем валюту, кошельки и категории" onClick={onScratch} />
            </div>
          ) : (
            <Card className="flex flex-col gap-2" padding="md">
              <Choice icon="i:box" color="#0891b2" title="Из Zenmoney (файл CSV)" text="Операции, счета и категории" onClick={onZenmoney} />
              <Choice icon="i:download" color="#7c3aed" title="Из своей копии Finora (JSON)" text="Файл, который вы сохраняли в Настройках" onClick={onBackup} />
              <button
                type="button"
                onClick={() => setMoving(false)}
                className="min-h-[44px] rounded-2xl text-base font-semibold text-brand hover:bg-brand/10"
              >
                Назад
              </button>
            </Card>
          )}
        </div>
      </div>
      <div className="shrink-0 px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1 text-center">
        <button
          type="button"
          onClick={onSkip}
          className="min-h-[44px] rounded-xl px-4 text-sm font-medium text-muted underline underline-offset-4 hover:text-text"
        >
          Пропустить, настрою сам
        </button>
      </div>
    </div>
  );
}
