import { Button } from '@/components/Button';
import { Field, inputClasses } from '@/components/Field';
import { Notice } from '@/components/Notice';
import { cn } from '@/lib/cn';
import { DENIED_HELP, explainSupport } from '@/push/subscription';
import { useReminders, type RemindersModel } from '@/push/useReminders';
import { ToggleRow } from '@/components/ToggleRow';
import { SettingsSection } from './SettingsSection';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number): string => `${String(h).padStart(2, '0')}:00`;

const NOTICE_CLASS = { ok: 'text-income', error: 'text-danger', info: 'text-text' } as const;

/** Раздел «Напоминания»: push-уведомления о платежах и долгах (включение, время, что напоминать, проверка). */
export function RemindersSection() {
  const m = useReminders();
  return (
    <SettingsSection title="Напоминания">
      <Body m={m} />
    </SettingsSection>
  );
}

function Body({ m }: { m: RemindersModel }) {
  switch (m.phase) {
    case 'no-cloud':
      return (
        <>
          <p>
            <strong className="font-semibold">Напоминания работают только при входе в облако.</strong>
          </p>
          <p className="text-muted">Напоминания присылает сервер, поэтому нужен вход в облако. Сейчас Sumoima хранит данные только на этом устройстве.</p>
        </>
      );
    case 'not-configured':
      return (
        <p>
          Напоминания пока не настроены владельцем приложения. Когда они будут готовы, здесь появится кнопка «Включить напоминания».
        </p>
      );
    case 'unsupported':
      return <p>{explainSupport(m.support)}</p>;
    case 'loading':
      return (
        <p role="status" className="text-muted">
          Проверяем настройки…
        </p>
      );
    case 'load-failed':
      return (
        <Notice
          tone="danger"
          action={
            <Button variant="secondary" icon="refresh" onClick={m.reload}>
              Повторить
            </Button>
          }
        >
          {m.loadError ?? 'Не удалось получить настройки напоминаний.'}
        </Notice>
      );
    case 'ready':
      return <Ready m={m} />;
  }
}

function Ready({ m }: { m: RemindersModel }) {
  const enabled = m.settings?.enabled === true;
  const busy = m.busy !== null;
  const shown = m.settings ? { ...m.settings, ...(m.pending ?? {}) } : null;

  let status: { text: string; cls: string };
  if (enabled && m.deviceOn) status = { text: 'Напоминания включены на этом устройстве.', cls: 'text-income' };
  else if (enabled) status = { text: 'Напоминания включены для вашего аккаунта, но не на этом устройстве.', cls: 'text-text' };
  else status = { text: 'Напоминания выключены.', cls: 'text-text' };

  return (
    <>
      <div role="status" aria-live="polite" className="flex flex-col gap-1">
        <p className={cn('text-lg font-semibold', status.cls)}>{status.text}</p>
        {!enabled && (
          <p className="text-muted">Sumoima напомнит о платежах по расписанию и о сроках возврата долгов, даже если приложение закрыто.</p>
        )}
        {m.notice && <p className={cn('font-medium', NOTICE_CLASS[m.notice.tone])}>{m.notice.text}</p>}
      </div>

      {!m.deviceOn && m.permission === 'denied' && <p className="text-sm text-muted">{DENIED_HELP}</p>}
      {!m.deviceOn && m.permission !== 'denied' && (
        <Button loading={m.busy === 'enable'} disabled={busy} onClick={m.enable}>
          {enabled ? 'Включить на этом устройстве' : 'Включить напоминания'}
        </Button>
      )}

      {enabled && shown && (
        <div className="flex flex-col gap-3 border-t border-border pt-3" aria-busy={m.busy === 'save' || undefined}>
          <Field
            id="reminder-hour"
            label="В какое время напоминать (ваше местное время)"
            hint={`Часовой пояс берётся с устройства: ${shown.timezone}.`}
          >
            <select
              id="reminder-hour"
              value={shown.hourLocal}
              disabled={busy}
              onChange={(e) => m.save({ hourLocal: Number(e.target.value) })}
              className={`${inputClasses(false)} min-h-[48px]`}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </Field>
          <ToggleRow
            label="Платежи по расписанию"
            hint="Напомним, когда подходит срок регулярного платежа."
            checked={shown.remindPayments}
            disabled={busy}
            onChange={(v) => m.save({ remindPayments: v })}
          />
          <ToggleRow
            label="Долги и сроки возврата"
            hint="Напомним, когда приближается срок возврата долга."
            checked={shown.remindDebts}
            disabled={busy}
            onChange={(v) => m.save({ remindDebts: v })}
          />
          <ToggleRow
            label="Каждый вечер напомнить внести траты, если за день ничего не внесено"
            hint="Придёт в то же время, что выбрано выше: чтобы напоминание пришло вечером, выберите вечерний час."
            checked={shown.remindDaily}
            disabled={busy}
            onChange={(v) => m.save({ remindDaily: v })}
          />
          <ToggleRow
            label="Лимиты бюджета"
            hint="Напомним, когда расходы месяца дошли до 70% или 90% лимита или превысили его. Суммы в уведомление не попадают."
            checked={shown.remindBudgets}
            disabled={busy}
            onChange={(v) => m.save({ remindBudgets: v })}
          />
          <ToggleRow
            label="Показывать названия в уведомлении"
            hint="Выключено: в уведомлении только общие слова и числа. Включено: ещё названия платежей, имена и названия лимитов, и их увидят на заблокированном экране. Суммы не пишутся никогда."
            checked={shown.showDetails}
            disabled={busy}
            onChange={(v) => m.save({ showDetails: v })}
          />
          <div className="flex flex-col gap-1.5">
            <Button variant="secondary" icon="check" loading={m.busy === 'test'} disabled={busy} onClick={m.test}>
              Проверить уведомление
            </Button>
            <p className="text-sm text-muted">Пробное сообщение придёт на все ваши устройства, где напоминания включены.</p>
          </div>
        </div>
      )}

      {m.deviceOn && (
        <Button variant="ghost" loading={m.busy === 'disable'} disabled={busy} onClick={m.disable}>
          Выключить на этом устройстве
        </Button>
      )}
    </>
  );
}
