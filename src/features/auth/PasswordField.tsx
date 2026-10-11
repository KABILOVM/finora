import type { InputHTMLAttributes } from 'react';
import { Field, fieldErrorId, fieldHintId, inputClasses } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { cn } from '@/lib/cn';

export interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> {
  label: string;
  id: string;
  /** Показывать пароль буквами. */
  shown: boolean;
  /** Есть — внутри поля справа появляется «глазок»; нет — поле просто следует за shown (второй пароль при регистрации). */
  onToggleShown?: () => void;
  error?: string | null;
  hint?: string;
}

/** Поле пароля с «глазком» внутри: нажал — пароль виден, ещё раз — скрыт. Кнопка 44×44 и подписана для скринридера. */
export function PasswordField({ label, id, shown, onToggleShown, error, hint, className, ...rest }: PasswordFieldProps) {
  const describedBy = error ? fieldErrorId(id) : hint ? fieldHintId(id) : undefined;
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <div className="relative">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(inputClasses(!!error), 'min-h-[48px]', onToggleShown && 'pr-12', className)}
          {...rest}
        />
        {onToggleShown && (
          <button
            type="button"
            onClick={onToggleShown}
            aria-pressed={shown}
            aria-label={shown ? 'Скрыть пароль' : 'Показать пароль'}
            title={shown ? 'Скрыть пароль' : 'Показать пароль'}
            disabled={rest.disabled}
            className="absolute right-1 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/20 disabled:opacity-60"
          >
            <Icon name={shown ? 'eye-off' : 'eye'} size={22} />
          </button>
        )}
      </div>
    </Field>
  );
}
