import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface FieldProps {
  /** id поля ввода внутри (для <label for>). */
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  className?: string;
  children: ReactNode;
}

export const fieldHintId = (id: string) => `${id}-hint`;
export const fieldErrorId = (id: string) => `${id}-error`;

/** Подпись + подсказка + сообщение об ошибке вокруг любого поля. Само поле передаётся детьми и получает тот же id. */
export function Field({ id, label, hint, error, className, children }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-semibold text-text">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={fieldHintId(id)} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={fieldErrorId(id)} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Общий вид полей: ≥ 44px по высоте, шрифт 16px (иначе iOS приближает страницу), рамка с контрастом ≥ 3:1. */
export function inputClasses(invalid: boolean): string {
  return cn(
    'w-full rounded-xl border bg-surface px-3.5 text-base text-text placeholder:text-muted/80',
    'transition-colors focus:outline-none focus:ring-2 focus:ring-brand/40 disabled:opacity-60',
    invalid ? 'border-danger' : 'border-border-strong focus:border-brand',
  );
}

function describedBy(id: string, hint?: string, error?: string | null): string | undefined {
  if (error) return fieldErrorId(id);
  if (hint) return fieldHintId(id);
  return undefined;
}

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string | null;
  id?: string;
  wrapperClassName?: string;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { label, hint, error, id, wrapperClassName, className, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <Field id={inputId} label={label} hint={hint} error={error} className={wrapperClassName}>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(inputId, hint, error)}
        className={cn(inputClasses(!!error), 'min-h-[48px]', className)}
        {...rest}
      />
    </Field>
  );
});

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string | null;
  id?: string;
  wrapperClassName?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hint, error, id, wrapperClassName, className, rows = 3, ...rest },
  ref,
) {
  const auto = useId();
  const areaId = id ?? auto;
  return (
    <Field id={areaId} label={label} hint={hint} error={error} className={wrapperClassName}>
      <textarea
        ref={ref}
        id={areaId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(areaId, hint, error)}
        className={cn(inputClasses(!!error), 'min-h-[88px] resize-y py-3', className)}
        {...rest}
      />
    </Field>
  );
});
