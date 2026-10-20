import { useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Notice } from '@/components/Notice';
import { SectionHeader } from '@/components/SectionHeader';
import type { ImportPlan, IssueCode, RowIssue, SkippedRow } from '@/import/types';
import { ISSUE_LABELS, rowsWord, SKIP_LABELS } from './importText';

/** Столько строк «Нужно проверить» показывается списком без группировки; больше — собираются по причине. */
export const REVIEW_FLAT_MAX = 8;
/** Сколько строк видно в одной группе, пока её не раскрыли. */
export const REVIEW_GROUP_SHOWN = 5;
const LINES_SHOWN = 12;

function ReviewRow({ r }: { r: RowIssue }) {
  return (
    <li className="py-2">
      <span className="font-medium">Строка {r.line}</span>
      {r.summary && <span className="text-sm text-muted"> · {r.summary}</span>}
      <span className="block text-sm">{r.message}</span>
    </li>
  );
}

function ReviewGroup({ code, rows }: { code: IssueCode; rows: readonly RowIssue[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, REVIEW_GROUP_SHOWN);
  const label = ISSUE_LABELS[code];
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <h3 className="font-semibold">
        {label} · {rows.length}
      </h3>
      <ul className="divide-y divide-border" aria-label={`Строки: ${label}`}>
        {shown.map((r) => (
          <ReviewRow key={`${r.line}-${r.code}`} r={r} />
        ))}
      </ul>
      {rows.length > REVIEW_GROUP_SHOWN && (
        <Button variant="ghost" fullWidth aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? 'Свернуть' : `Показать все ${rows.length}`}
        </Button>
      )}
    </li>
  );
}

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

/** Предупреждения плана: обрезанные заметки, категории, которые придут «без категории», операции, признанные уже имеющимися. */
export function NotesBlock({ notes }: { notes: readonly string[] }) {
  if (notes.length === 0) return null;
  return (
    <section aria-labelledby="notes-h" className="flex flex-col gap-2">
      <SectionHeader id="notes-h" className="mb-0">
        Обратите внимание
      </SectionHeader>
      <Notice tone="warning" role="note">
        <ul className="list-disc space-y-1 pl-5 text-text">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Notice>
    </section>
  );
}

/**
 * Строки, которые не будут добавлены и требуют решения человека. Строк немного — один список по порядку файла; много (выгрузка с
 * сотней одинаковых ошибок) — группы по причине, в каждой первые пять и «Показать все N». Ничего не отрезается молча.
 */
export function ReviewBlock({ review }: { review: readonly RowIssue[] }) {
  const groups = useMemo(() => {
    const by = new Map<IssueCode, RowIssue[]>();
    for (const r of review) {
      const list = by.get(r.code);
      if (list) list.push(r);
      else by.set(r.code, [r]);
    }
    return [...by.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [review]);
  if (review.length === 0) return null;
  return (
    <section aria-labelledby="review-h" className="flex flex-col gap-2">
      <SectionHeader id="review-h" className="mb-0">
        Нужно проверить ({review.length})
      </SectionHeader>
      <Card className="flex flex-col gap-2">
        <p className="text-sm text-muted">
          Эти строки не будут добавлены: мы не стали гадать. Исправьте их в файле и загрузите файл ещё раз — добавленное повторно не добавится.
        </p>
        {review.length <= REVIEW_FLAT_MAX ? (
          <ul className="divide-y divide-border" aria-label="Строки, которые нужно проверить">
            {review.map((r) => (
              <ReviewRow key={`${r.line}-${r.code}`} r={r} />
            ))}
          </ul>
        ) : (
          <ul className="divide-y divide-border" aria-label="Строки, которые нужно проверить, по причинам">
            {groups.map(([code, rows]) => (
              <ReviewGroup key={code} code={code} rows={rows} />
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

/** Строки, в которых нечего добавлять (нет даты, нулевая сумма), по группам с номерами строк. */
export function SkippedBlock({ skipped }: { skipped: ImportPlan['skipped'] }) {
  const groups = useMemo(() => {
    const by = new Map<SkippedRow['code'], SkippedRow[]>();
    for (const s of skipped) {
      const list = by.get(s.code);
      if (list) list.push(s);
      else by.set(s.code, [s]);
    }
    return [...by.entries()];
  }, [skipped]);
  if (skipped.length === 0) return null;
  return (
    <section aria-labelledby="skipped-h" className="flex flex-col gap-2">
      <SectionHeader id="skipped-h" className="mb-0">
        Пропущено ({skipped.length})
      </SectionHeader>
      <Card>
        <p className="text-sm text-muted">В этих строках нечего добавлять.</p>
        <ul className="divide-y divide-border">
          {groups.map(([code, rows]) => (
            <SkippedGroup key={code} code={code} rows={rows} />
          ))}
        </ul>
      </Card>
    </section>
  );
}
