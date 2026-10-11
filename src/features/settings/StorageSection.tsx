import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { SettingsSection } from './SettingsSection';

type Persisted = 'unknown' | 'yes' | 'no' | 'unsupported';

/** Хранилище: защита данных от автоочистки браузером и предупреждение про iPhone. */
export function StorageSection() {
  const [persisted, setPersisted] = useState<Persisted>('unknown');
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let alive = true;
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
    if (!storage || typeof storage.persisted !== 'function') {
      setPersisted('unsupported');
      return undefined;
    }
    Promise.resolve(storage.persisted())
      .then((v) => alive && setPersisted(v ? 'yes' : 'no'))
      .catch(() => alive && setPersisted('unsupported'));
    return () => {
      alive = false;
    };
  }, []);

  const protect = async () => {
    const storage = navigator.storage;
    if (busy || !storage || typeof storage.persist !== 'function') return;
    setBusy(true);
    setDenied(false);
    try {
      const ok = await storage.persist();
      setPersisted(ok ? 'yes' : 'no');
      setDenied(!ok);
    } catch {
      setDenied(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection title="Хранилище">
      <p role="status">
        {persisted === 'yes' && (
          <span className="font-semibold text-income">Данные защищены: браузер не будет их удалять сам.</span>
        )}
        {persisted === 'no' && (
          <span className="font-semibold text-warning">Данные не защищены: при нехватке места браузер может их очистить.</span>
        )}
        {persisted === 'unknown' && <span className="text-muted">Проверяем…</span>}
        {persisted === 'unsupported' && <span className="text-muted">Этот браузер не сообщает, защищены ли данные.</span>}
      </p>
      {persisted === 'no' && (
        <Button variant="secondary" loading={busy} onClick={() => void protect()}>
          Защитить данные от очистки
        </Button>
      )}
      {denied && (
        <p role="alert" className="text-sm text-warning">
          Браузер не дал защиту. Это нормально для Safari: поставьте Finora на экран «Домой» и делайте резервные копии.
        </p>
      )}
      <p className="rounded-xl bg-warning/10 p-3 text-warning">
        Safari на iPhone может очистить данные сайта, который не открывали около недели. Поставьте Finora на экран «Домой» и
        регулярно делайте резервные копии.
      </p>
    </SettingsSection>
  );
}
