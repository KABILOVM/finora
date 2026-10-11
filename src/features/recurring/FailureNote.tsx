import type { AutoPostFailure } from '@/recurring/autoPostState';

/** Пометка под платежом, который не провёлся сам: причина по-русски. Данные платежа при этом не менялись. */
export function FailureNote({ failure }: { failure: AutoPostFailure }) {
  if (failure.kind === 'no-rate') {
    return (
      <p role="status" className="mt-1 text-sm font-medium text-warning">
        Не проведён сам: {failure.message}. Проведите платёж вручную.
      </p>
    );
  }
  return (
    <p role="alert" className="mt-1 text-sm font-medium text-danger">
      Не удалось провести: {failure.message}
    </p>
  );
}
