/** Edge Function «parse-expenses»: расходы, доходы и переводы из текста или записи голоса через Gemini. Секрет: GEMINI_API_KEY (как у parse-shopping). Подробности в README. */
const MAX_TEXT = 4000, MAX_AUDIO = 9_000_000, MAX_ITEMS = 60, PER_MINUTE = 10;
const MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash';
const MIMES: Record<string, string> = { 'audio/mp4': 'audio/mp4', 'audio/x-m4a': 'audio/mp4', 'audio/aac': 'audio/aac', 'audio/webm': 'audio/webm', 'audio/ogg': 'audio/ogg', 'audio/mpeg': 'audio/mpeg', 'audio/wav': 'audio/wav' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info', 'access-control-allow-methods': 'POST, OPTIONS' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' } });
const PROMPT = `Ты разбираешь рассказ человека о его деньгах за день (голос или текст): расходы, доходы и переводы между своими счетами. Речь распознана автоматически: бывают ошибки и нет знаков препинания.
Верни список операций. Правила:
- Каждая операция — отдельная запись. kind: "expense" — покупка или платёж (по умолчанию); "income" — человек получил деньги («получил зарплату», «пришли пять тысяч», «подарили», «вернули за билеты»); "transfer" — перевод между СВОИМИ счетами («перевёл с карты на наличные», «снял в банкомате тысячу» — с карты на наличные, «положил на карту»). Долги (одолжил, дал в долг, вернул долг) и обмен валюты не включай.
- title: короткое название по-русски («Такси», «Зарплата», «Снятие наличных»). amount: сумма числом в валюте счёта («пятьсот» → 500, «двенадцать пятьдесят» → 12.5, «две тысячи» → 2000). Нет суммы — 0.
- wallet: точное название счёта из wallets, если человек его назвал («картой Алиф», «наличными»); иначе пустая строка. Для дохода это счёт, на который пришли деньги; для перевода — счёт, ОТКУДА переведено. Не выдумывай счета.
- toWallet: только для перевода — точное название счёта из wallets, КУДА переведено; иначе пустая строка.
- category: для расхода — название категории из categories, которая подходит лучше всего; для дохода — из incomeCategories; если ни одна не подходит — короткое название новой категории (1–2 слова); если неясно — пустая строка. Для перевода — пустая строка.
- fee: комиссия числом, если названа («комиссия 5 сомони» → 5), иначе 0; в amount комиссия не входит. У дохода комиссии нет.
- date: ГГГГ-ММ-ДД. «Вчера», «в понедельник», «третьего числа» считай от today. Не названа — пустая строка.
- note: заметка, которую человек продиктовал к операции (детали, с кем, зачем), иначе пустая строка. Не дублируй title.
- Если дана аудиозапись, прослушай её и в transcript запиши дословную расшифровку по-русски, затем разбери по тем же правилам.`;
const item = { type: 'OBJECT', properties: { kind: { type: 'STRING', enum: ['expense', 'income', 'transfer'] }, title: { type: 'STRING' }, amount: { type: 'NUMBER' }, wallet: { type: 'STRING' }, toWallet: { type: 'STRING' }, category: { type: 'STRING' }, fee: { type: 'NUMBER' }, date: { type: 'STRING' }, note: { type: 'STRING' } }, required: ['kind', 'title', 'amount', 'wallet', 'toWallet', 'category', 'fee', 'date', 'note'] };
const SCHEMA = { type: 'OBJECT', propertyOrdering: ['transcript', 'expenses'], properties: { transcript: { type: 'STRING' }, expenses: { type: 'ARRAY', items: item } }, required: ['expenses'] };
const hits = new Map<string, number[]>();
function limited(user: string, now: number): boolean {
  const list = (hits.get(user) ?? []).filter((t) => now - t < 60_000);
  const over = list.length >= PER_MINUTE;
  if (!over) list.push(now);
  hits.set(user, list);
  if (hits.size > 5000) hits.clear();
  return over;
}
async function userOf(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? '', base = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, ''), anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!/^Bearer\s+\S+/i.test(auth) || !base || !anon) return null;
  try {
    const res = await fetch(`${base}/auth/v1/user`, { headers: { apikey: anon, authorization: auth, accept: 'application/json' } });
    const body = res.ok ? ((await res.json()) as { id?: unknown }) : {};
    return typeof body.id === 'string' && body.id !== '' ? body.id : null;
  } catch {
    return null;
  }
}
const strs = (v: unknown, n: number): string[] => (Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string').map((k) => k.slice(0, 80)).slice(0, n) : []);
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method' });
  const key = Deno.env.get('GEMINI_API_KEY') ?? '';
  if (!key) return json(500, { ok: false, error: 'not_configured' });
  const user = await userOf(req);
  if (!user) return json(401, { ok: false, error: 'unauthorized' });
  if (limited(user, Date.now())) return json(429, { ok: false, error: 'rate_limited' });
  let text = '', audio = '', mime = '', wallets: string[] = [], categories: string[] = [], incomeCategories: string[] = [], today = '';
  try {
    const b = (await req.json()) as Record<string, unknown>;
    if (typeof b.text === 'string') text = b.text.trim();
    if (typeof b.audio === 'string') audio = b.audio;
    if (typeof b.mime === 'string') mime = MIMES[b.mime.split(';')[0]!.trim().toLowerCase()] ?? '';
    if (typeof b.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.today)) today = b.today;
    wallets = strs(b.wallets, 50); categories = strs(b.categories, 200); incomeCategories = strs(b.incomeCategories, 100);
  } catch {
    return json(400, { ok: false, error: 'bad_request' });
  }
  if (audio !== '') {
    if (audio.length > MAX_AUDIO) return json(400, { ok: false, error: 'too_long' });
    if (mime === '' || !/^[A-Za-z0-9+/=]+$/.test(audio)) return json(400, { ok: false, error: 'bad_request' });
  } else if (text === '') return json(200, { ok: true, expenses: [] });
  else if (text.length > MAX_TEXT) return json(400, { ok: false, error: 'too_long' });
  const head = `${PROMPT}\n\ntoday: ${today}\nwallets: ${JSON.stringify(wallets)}\ncategories: ${JSON.stringify(categories)}\nincomeCategories: ${JSON.stringify(incomeCategories)}\n\n`;
  const parts = audio !== '' ? [{ text: `${head}Аудиозапись:` }, { inlineData: { mimeType: mime, data: audio } }] : [{ text: `${head}Текст:\n${text}` }];
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 } }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const parsed = JSON.parse(data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '') as { expenses?: unknown; transcript?: unknown };
    const expenses = (Array.isArray(parsed.expenses) ? parsed.expenses : []).slice(0, MAX_ITEMS);
    const transcript = audio !== '' && typeof parsed.transcript === 'string' ? parsed.transcript.trim().slice(0, MAX_TEXT) : undefined;
    return json(200, { ok: true, expenses, transcript });
  } catch (e) {
    console.error('parse-expenses:', e instanceof Error ? e.message : e);
    return json(502, { ok: false, error: 'upstream' });
  }
});
