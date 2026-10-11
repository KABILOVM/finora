import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';

export interface PickStepProps {
  onFile: (file: File) => void;
  /** Что пошло не так с прошлым файлом (готовый текст для человека). */
  error: string | null;
  disabled?: boolean;
}

/** Шаг 1. Как выгрузить файл, выбор файла (нажатием или перетаскиванием), что с файлом происходит. */
export function PickStep({ onFile, error, disabled = false }: PickStepProps) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const el = e.target;
    const file = el.files?.[0];
    el.value = ''; // чтобы тот же файл можно было выбрать ещё раз
    if (file) onFile(file);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && !disabled) onFile(file);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-2">
        <h2 className="text-lg font-bold">Как выгрузить из Zenmoney</h2>
        <p>Выгрузите операции в CSV на сайте или в приложении Zenmoney, затем выберите файл ниже.</p>
        <p className="text-sm text-muted">
          Формат мы проверяли на образце. Если не получилось — напишите нам и пришлите файл, в котором суммы заменены вымышленными.
        </p>
      </Card>

      <Card
        className={`flex flex-col items-center gap-3 border-2 border-dashed text-center ${over ? 'border-brand bg-brand/5' : 'border-border-strong'}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-brand">
          <Icon name="upload" size={24} />
        </span>
        <Button size="lg" icon="upload" disabled={disabled} onClick={() => input.current?.click()}>
          Выбрать файл
        </Button>
        <p className="text-sm text-muted">Подойдёт файл .csv или .txt. На компьютере файл можно перетащить сюда.</p>
        <input
          ref={input}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          // не display:none: на iPhone вызов click() у полностью скрытого поля выбора файла срабатывает не всегда
          className="sr-only"
          tabIndex={-1}
          aria-label="Файл Zenmoney"
          onChange={onChange}
        />
      </Card>

      {error && (
        <p role="alert" className="rounded-xl bg-danger/10 p-3 font-medium text-danger">
          {error}
        </p>
      )}

      <p className="flex items-start gap-2 px-1 text-sm text-muted">
        <Icon name="lock" size={18} className="mt-0.5 shrink-0" />
        <span>Файл читается прямо на этом устройстве и никуда не отправляется, интернет для разбора не нужен.</span>
      </p>
      <p className="px-1 text-sm text-muted">
        Перед импортом можно сделать резервную копию:{' '}
        <Link to="/settings" className="font-semibold text-brand underline">
          Настройки → Резервная копия
        </Link>
        .
      </p>
    </div>
  );
}
