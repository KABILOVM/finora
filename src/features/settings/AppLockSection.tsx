import { useId, useRef, useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/Button';
import { Segmented, type SegmentOption } from '@/components/Segmented';
import { Switch } from '@/components/Switch';
import { Notice } from '@/components/Notice';
import { clearLock, DEFAULT_GRACE, updateGrace, writeLock, type GraceSeconds } from '@/lock/lockStore';
import { useLockState, useLockSupport } from '@/lock/useLockState';
import { createLockCredential, LOCK_FAILURE_TEXT, onIosBrowserTab, SUPPORT_TEXT, verifyLock } from '@/lock/webauthn';
import { SettingsSection } from './SettingsSection';

const GRACE_OPTIONS: readonly SegmentOption<`${GraceSeconds}`>[] = [
  { value: '0', label: 'Сразу' },
  { value: '60', label: 'Через 1 мин' },
  { value: '300', label: 'Через 5 мин' },
];

type Note = { tone: 'ok' | 'error'; text: string } | null;

/**
 * Блокировка приложения по Face ID / отпечатку («замок на экран»).
 * Включение: сначала создаётся ключ (появится системный запрос). Выключение: СНАЧАЛА нужно подтверждение, иначе чужой человек
 * с разблокированным телефоном мог бы снять замок одним нажатием. Настройка хранится на этом устройстве, отдельно для каждого пользователя.
 */
export function AppLockSection() {
  const auth = useAuth();
  const user = auth.user;
  if (!user) return null;
  return <AppLockBody userId={user.id} cloud={auth.cloud} />;
}

function AppLockBody({ userId, cloud }: { userId: string; cloud: boolean }) {
  const support = useLockSupport();
  const state = useLockState(userId);
  const [busy, setBusy] = useState<'enable' | 'disable' | null>(null);
  const [note, setNote] = useState<Note>(null);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const labelId = useId();

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const checking = support === 'checking';
  const unsupportedReason = support !== 'checking' && !support.supported ? support.reason : null;
  const supported = support !== 'checking' && support.supported;
  const on = state.kind === 'on';
  const broken = state.kind === 'broken';

  const guarded = async (kind: 'enable' | 'disable', action: () => Promise<Note>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    setNote(null);
    try {
      const result = await action();
      if (alive.current) setNote(result);
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(null);
    }
  };

  const enable = () =>
    guarded('enable', async () => {
      const created = await createLockCredential({ id: userId });
      if (!created.ok) {
        return { tone: 'error', text: created.reason === 'declined' ? 'Не подтверждено. Замок не включён.' : LOCK_FAILURE_TEXT[created.reason] };
      }
      const saved = writeLock(userId, { credentialId: created.credentialId, enabledAt: new Date().toISOString(), graceSeconds: DEFAULT_GRACE });
      if (!saved) return { tone: 'error', text: 'Не удалось сохранить настройку на этом устройстве. Замок не включён.' };
      return { tone: 'ok', text: 'Замок включён.' };
    });

  const disable = () =>
    guarded('disable', async () => {
      if (state.kind !== 'on') return null;
      // Сначала подтверждение: снять замок может только тот, кто его открывает.
      const checked = await verifyLock(state.setting.credentialId);
      if (!checked.ok) {
        return { tone: 'error', text: checked.reason === 'declined' ? 'Не подтверждено. Замок остался включённым.' : LOCK_FAILURE_TEXT[checked.reason] };
      }
      if (!clearLock(userId)) return { tone: 'error', text: 'Не удалось сохранить настройку на этом устройстве. Замок остался включённым.' };
      return { tone: 'ok', text: 'Замок выключен.' };
    });

  /** Повреждённую запись снять нельзя подтверждением (ключа в ней нет): сбрасываем её, чтобы можно было включить заново. */
  const reset = () => {
    setNote(clearLock(userId) ? { tone: 'ok', text: 'Запись о замке сброшена. Можно включить его заново.' } : { tone: 'error', text: LOCK_FAILURE_TEXT.failed });
  };

  const changeGrace = (value: `${GraceSeconds}`) => {
    const grace = Number(value) as GraceSeconds;
    if (!updateGrace(userId, grace)) setNote({ tone: 'error', text: 'Не удалось сохранить настройку на этом устройстве.' });
    else setNote(null);
  };

  const toggle = () => {
    if (on) void disable();
    else void enable();
  };

  // Строка состояния всегда занимает место: «Проверяем…» не сдвигает то, что ниже.
  let status: string;
  if (checking) status = 'Проверяем…';
  else if (broken) status = 'Замок включён, но запись о нём на этом устройстве повреждена.';
  else if (busy === 'enable') status = 'Ждём подтверждения на устройстве…';
  else if (busy === 'disable') status = 'Подтвердите, чтобы выключить замок…';
  else if (unsupportedReason !== null) status = SUPPORT_TEXT[unsupportedReason];
  else status = on ? 'Включён.' : 'Выключен. При включении телефон попросит Face ID или отпечаток.';

  return (
    <SettingsSection title="Блокировка приложения">
      <div className="flex items-center justify-between gap-3">
        <span id={labelId} className="min-w-0 text-base font-semibold">
          Открывать по Face ID / отпечатку
        </span>
        <Switch
          checked={on || broken}
          disabled={checking || busy !== null || broken || (!supported && !on)}
          busy={busy !== null}
          labelledBy={labelId}
          onChange={toggle}
        />
      </div>

      {/* aria-live, а не role="status": на странице настроек не должно быть лишних «статусов» (по ним ищут отчёты других разделов) */}
      <p aria-live="polite" className="min-h-[1.5rem] text-muted">
        {status}
      </p>

      {broken && (
        <Button variant="secondary" onClick={reset}>
          Сбросить замок
        </Button>
      )}

      {note && (
        // «alert» только у ошибки; результат читается вежливо (aria-live), но не как «status»: лишних статусов на странице настроек быть не должно
        <Notice tone={note.tone === 'error' ? 'danger' : 'info'} role={note.tone === 'error' ? 'alert' : 'note'} live={note.tone === 'error' ? undefined : 'polite'} className={note.tone === 'error' ? undefined : 'font-medium !text-brand'}>
          {note.text}
        </Notice>
      )}

      {on && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Закрывать</span>
          <Segmented
            options={GRACE_OPTIONS}
            value={`${state.setting.graceSeconds}`}
            onChange={changeGrace}
            ariaLabel="Когда закрывать приложение"
          />
          <p className="text-sm text-muted">Столько приложение можно не открывать, прежде чем оно снова попросит подтверждение.</p>
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-border pt-3 text-sm text-muted">
        <p>
          Это «замок на экран»: он защищает, если кто-то взял ваш уже разблокированный телефон. Данные на устройстве он не шифрует и
          вход по почте не заменяет.
        </p>
        <p>
          {cloud
            ? 'Если Face ID не сработает, на закрытом экране есть «Не получается? Выйти и войти заново»: записи на устройстве сохранятся.'
            : 'Без входа в облако проверить личность иначе нечем, поэтому на закрытом экране есть «Не получается? Снять замок». Он защищает от случайного взгляда, а не от того, кто решил взломать.'}
        </p>
        {supported && onIosBrowserTab() && (
          <p>Замок хранится отдельно в браузере и в приложении с экрана «Домой»: включайте его там, где пользуетесь Sumoima.</p>
        )}
      </div>
    </SettingsSection>
  );
}
