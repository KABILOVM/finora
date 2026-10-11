import { Card } from '@/components/Card';
import type { ImportPlan, SkippedRow } from '@/import/types';
import { rowsWord, SKIP_LABELS } from './importText';

const REVIEW_SHOWN = 30;
const LINES_SHOWN = 12;

function SkippedGroup({ code, rows }: { code: SkippedRow['code']; rows: readonly SkippedRow[] }) {
  const lines = rows.slice(0, LINES_SHOWN).map((r) => r.line);
  const more = rows.length - lines.length;
  return (
    <li className="py-2">
      <span className="font-medium">{SKIP_LABELS[code]}:</span> {rows.length} {rowsWord(rows.length)}
      <span className="block text-sm text-muted">
        Строки файла: {lines.join(', ')}
        {more > 0 ? ` и ещё ${more}` : ''}
      </span>
    </li>
  );
}

/** Что не будет добавлено: «нужно проверить» с причинами, «пропущено» по группам, предупреждения плана. */
export function IssuesBlock({ plan }: { plan: ImportPlan }) {
  const review = plan.review;
  const shown = review.slice(0, REVIEW_SHOWN);
  const groups = new Map<SkippedRow['code'], SkippedRow[]>();
  for (const s of plan.skipped) groups.set(s.code, [...(groups.get(s.code) ?? []), s]);
  if (review.length === 0 && plan.skipped.length === 0 && plan.notes.length === 0) return null;
  return (
    <>
      {plan.notes.length > 0 && (
        <section aria-labelledby="notes-h" className="flex flex-col gap-2">
          <h2 id="notes-h" className="px-1 text-sm font-bold uppercase tracking-wide text-muted">
            Обратите внимание
          </h2>
          <Card>
            <ul className="list-disc space-y-1 pl-5">
              {plan.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </Card>
        </section>
      )}
      {review.length > 0 && (
        <section aria-labelledby="review-h" className="flex flex-col gap-2">
          <h2 id="review-h" className="px-1 text-sm font-bold uppercase tracking-wide text-muted">
            Нужно проверить ({review.length})
          </h2>
          <Card className="flex flex-col gap-2">
            <p className="text-sm text-muted">
              Эти строки не будут добавлены: мы не стали гадать. Исправьте их в файле и загрузите файл ещё раз — добавленное повторно не добавится.
            </p>
            <ul className="divide-y divide-border" aria-label="Строки, которые нужно проверить">
              {shown.map((r) => (
                <li key={`${r.line}-${r.code}`} className="py-2">
                  <span className="font-medium">Строка {r.line}</span>
                  {r.summary && <span className="text-sm text-muted"> · {r.summary}</span>}
                  <span className="block text-sm">{r.message}</span>
                </li>
              ))}
            </ul>
            {review.length > shown.length && <p className="text-sm text-muted">и ещё {review.length - shown.length}</p>}
          </Card>
        </section>
      )}
      {plan.skipped.length > 0 && (
        <section aria-labelledby="skipped-h" className="flex flex-col gap-2">
          <h2 id="skipped-h" className="px-1 text-sm font-bold uppercase tracking-wide text-muted">
            Пропущено ({plan.skipped.length})
          </h2>
          <Card>
            <p className="text-sm text-muted">В этих строках нечего добавлять.</p>
            <ul className="divide-y divide-border">
              {[...groups.entries()].map(([code, rows]) => (
                <SkippedGroup key={code} code={code} rows={rows} />
              ))}
            </ul>
          </Card>
        </section>
      )}
    </>
  );
}
