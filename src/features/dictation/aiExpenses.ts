import { getDefaultClient } from '@/auth/supabaseClient';
import { MAX_EXPENSES_TEXT, normalizeAiExpenses, type DictContext, type DraftExpense } from '@/domain/expensesAi';
import { AiListError, invokeAi, toBase64, type Invoker } from '@/features/shopping/aiList';
import type { Recording } from '@/features/shopping/recorder';

export const PARSE_EXPENSES_FUNCTION = 'parse-expenses';

/** Запись длиннее этого сервер не примет (9 000 000 знаков base64 ≈ 6,7 МБ — около 4 минут). */
export const MAX_EXPENSE_AUDIO_BYTES = 6_500_000;

export interface AiExpensesResult {
  drafts: DraftExpense[];
  /** Расшифровка записи (только для голоса). */
  transcript: string;
}

async function call(client: Invoker | null, body: Record<string, unknown>, ctx: DictContext, firstRid: number): Promise<AiExpensesResult> {
  const data = await invokeAi(client, PARSE_EXPENSES_FUNCTION, { ...body, ...lite(ctx) }, 'расходов');
  return {
    drafts: normalizeAiExpenses(data.expenses, ctx, firstRid),
    transcript: typeof data.transcript === 'string' ? data.transcript.trim() : '',
  };
}

/** Что уходит на сервер: только названия счетов и категорий и сегодняшняя дата. */
const lite = (ctx: DictContext) => ({
  wallets: ctx.wallets.map((w) => w.name),
  categories: ctx.categories.map((c) => c.name),
  today: ctx.today,
});

export async function parseExpensesWithAi(
  text: string,
  ctx: DictContext,
  firstRid = 1,
  client: Invoker | null = getDefaultClient(),
): Promise<AiExpensesResult> {
  const body = text.trim();
  if (body === '') return { drafts: [], transcript: '' };
  if (body.length > MAX_EXPENSES_TEXT) throw new AiListError(`Слишком длинный текст: не больше ${MAX_EXPENSES_TEXT} символов за раз.`);
  return call(client, { text: body }, ctx, firstRid);
}

export async function listenToExpensesWithAi(
  rec: Recording,
  ctx: DictContext,
  firstRid = 1,
  client: Invoker | null = getDefaultClient(),
): Promise<AiExpensesResult> {
  if (rec.blob.size > MAX_EXPENSE_AUDIO_BYTES) throw new AiListError('Запись слишком длинная. Продиктуйте расходы частями.');
  let audio: string;
  try {
    audio = await toBase64(rec.blob);
  } catch {
    throw new AiListError('Не удалось прочитать запись. Повторите.');
  }
  return call(client, { audio, mime: rec.mime }, ctx, firstRid);
}
