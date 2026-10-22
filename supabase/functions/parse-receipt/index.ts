/** Edge Function «parse-receipt»: позиции чека по фотографии через Gemini. Секрет: GEMINI_API_KEY (общий с parse-expenses и parse-shopping). Подробности в README. */
const MAX_IMAGE = 7_000_000, MAX_ITEMS = 120, PER_MINUTE = 6;
const MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash';
const MIMES: Record<string, string> = { 'image/jpeg': 'image/jpeg', 'image/jpg': 'image/jpeg', 'image/png': 'image/png', 'image/webp': 'image/webp', 'image/heic': 'image/heic', 'image/heif': 'image/heif' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info', 'access-control-allow-methods': 'POST, OPTIONS' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' } });
const PROMPT = `Ты читаешь фотографию кассового чека (магазин, кафе, аптека) и возвращаешь его позиции. Чек может быть на русском, таджикском или английском, помят или снят под углом.
Правила:
- merchant: название магазина или заведения, как на чеке; нет — пустая строка.
- date: дата покупки ГГГГ-ММ-ДД; не видна — пустая строка. Год из двух цифр дополни до 20ГГ.
- total: итоговая сумма к оплате числом; не видна — 0.
- items: каждая товарная позиция — отдельная запись. Не включай итог, налог, скидку отдельной строкой, сдачу, способ оплаты, номер чека.
- name: название товара коротко и понятно по-русски («Молоко 2,5%», «Хлеб белый»); аббревиатуры и английские названия расшифруй, если уверен.
- qty: количество числом (вес в кг, объём в л, штуки); нет — 1. unit: "kg", "l" или "pcs" (штуки; по умолчанию).
- price: сумма за ВСЮ позицию (qty × цена за единицу, с учётом скидки на позицию), числом в валюте чека. Это не цена за единицу.
- category: название категории из categories, которая подходит позиции лучше всего; если ни одна не подходит — короткое название новой категории (1–2 слова); если неясно — пустая строка.
- Если часть чека не читается, не выдумывай: пропусти строку.`;
const item = { type: 'OBJECT', properties: { name: { type: 'STRING' }, qty: { type: 'NUMBER' }, unit: { type: 'STRING', enum: ['pcs', 'kg', 'l'] }, price: { type: 'NUMBER' }, category: { type: 'STRING' } }, required: ['name', 'qty', 'unit', 'price', 'category'] };
const SCHEMA = { type: 'OBJECT', propertyOrdering: ['merchant', 'date', 'total', 'items'], properties: { merchant: { type: 'STRING' }, date: { type: 'STRING' }, total: { type: 'NUMBER' }, items: { type: 'ARRAY', items: item } }, required: ['merchant', 'date', 'total', 'items'] };
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
  let image = '', mime = '', categories: string[] = [], today = '';
  try {
    const b = (await req.json()) as Record<string, unknown>;
    if (typeof b.image === 'string') image = b.image;
    if (typeof b.mime === 'string') mime = MIMES[b.mime.split(';')[0]!.trim().toLowerCase()] ?? '';
    if (typeof b.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.today)) today = b.today;
    categories = strs(b.categories, 200);
  } catch {
    return json(400, { ok: false, error: 'bad_request' });
  }
  if (image === '' || mime === '' || !/^[A-Za-z0-9+/=]+$/.test(image)) return json(400, { ok: false, error: 'bad_request' });
  if (image.length > MAX_IMAGE) return json(400, { ok: false, error: 'too_long' });
  const head = `${PROMPT}\n\ntoday: ${today}\ncategories: ${JSON.stringify(categories)}\n\nФото чека:`;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [{ text: head }, { inlineData: { mimeType: mime, data: image } }] }], generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 } }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const parsed = JSON.parse(data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '') as { merchant?: unknown; date?: unknown; total?: unknown; items?: unknown };
    const items = (Array.isArray(parsed.items) ? parsed.items : []).slice(0, MAX_ITEMS);
    return json(200, { ok: true, merchant: parsed.merchant, date: parsed.date, total: parsed.total, items });
  } catch (e) {
    console.error('parse-receipt:', e instanceof Error ? e.message : e);
    return json(502, { ok: false, error: 'upstream' });
  }
});
