/** Edge Function «parse-shopping»: список покупок из текста или записи голоса через Gemini. Секрет: GEMINI_API_KEY (необязательно GEMINI_MODEL). Подробности в README. */
const MAX_TEXT = 2000, MAX_AUDIO = 4_000_000, MAX_ITEMS = 100, PER_MINUTE = 20;
const MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-3.8-flash';
const MIMES: Record<string, string> = { 'audio/mp4': 'audio/mp4', 'audio/x-m4a': 'audio/mp4', 'audio/aac': 'audio/aac', 'audio/webm': 'audio/webm', 'audio/ogg': 'audio/ogg', 'audio/mpeg': 'audio/mpeg', 'audio/wav': 'audio/wav' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info', 'access-control-allow-methods': 'POST, OPTIONS' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' } });
const PROMPT = `Ты разбираешь список покупок, который человек продиктовал голосом или набрал. Речь распознана автоматически: знаков препинания обычно нет, бывают ошибки.
Верни позиции списка. Правила:
- Каждый товар — отдельная позиция. «мука масло сливочное сахар» → «мука», «масло сливочное», «сахар». Прилагательное остаётся с товаром.
- name: название в именительном падеже, как пишут в списке покупок (молоко, яблоки, хлеб), по-русски, с маленькой буквы, без количества и слов «купить», «надо». Не придумывай товары, которых не называли.
- qty: число в единице unit. «2 литра» → 2, «полтора кило» → 1.5, «300 грамм» → 0.3 (unit kg), «500 мл» → 0.5 (unit l), «пара» → 2, «дюжина» → 12. Если количество не названо — 1.
- unit: «kg» для веса, «l» для жидкости в литрах, «pcs» для штук, пачек, бутылок, банок и когда единица не названа.
- Если название похоже на одно из известных человеку (known), пиши его в том же виде. Если товаров нет, верни пустой список.
- Если дана аудиозапись, прослушай её и в transcript запиши дословную расшифровку по-русски (со знаками препинания), затем разбери по тем же правилам. Для текста transcript не нужен.`;
const item = { type: 'OBJECT', properties: { name: { type: 'STRING' }, qty: { type: 'NUMBER' }, unit: { type: 'STRING', enum: ['pcs', 'kg', 'l'] } }, required: ['name', 'qty', 'unit'] };
const SCHEMA = { type: 'OBJECT', propertyOrdering: ['transcript', 'items'], properties: { transcript: { type: 'STRING' }, items: { type: 'ARRAY', items: item } }, required: ['items'] };
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
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method' });
  const key = Deno.env.get('GEMINI_API_KEY') ?? '';
  if (!key) return json(500, { ok: false, error: 'not_configured' });
  const user = await userOf(req);
  if (!user) return json(401, { ok: false, error: 'unauthorized' });
  if (limited(user, Date.now())) return json(429, { ok: false, error: 'rate_limited' });
  let text = '', audio = '', mime = '', known: string[] = [];
  try {
    const b = (await req.json()) as { text?: unknown; audio?: unknown; mime?: unknown; known?: unknown };
    if (typeof b.text === 'string') text = b.text.trim();
    if (typeof b.audio === 'string') audio = b.audio;
    if (typeof b.mime === 'string') mime = MIMES[b.mime.split(';')[0]!.trim().toLowerCase()] ?? '';
    if (Array.isArray(b.known)) known = b.known.filter((k): k is string => typeof k === 'string').map((k) => k.slice(0, 80)).slice(0, 200);
  } catch {
    return json(400, { ok: false, error: 'bad_request' });
  }
  if (audio !== '') {
    if (audio.length > MAX_AUDIO) return json(400, { ok: false, error: 'too_long' });
    if (mime === '' || !/^[A-Za-z0-9+/=]+$/.test(audio)) return json(400, { ok: false, error: 'bad_request' });
  } else if (text === '') return json(200, { ok: true, items: [] });
  else if (text.length > MAX_TEXT) return json(400, { ok: false, error: 'too_long' });
  const head = `${PROMPT}\n\nknown: ${JSON.stringify(known)}\n\n`;
  const parts = audio !== '' ? [{ text: `${head}Аудиозапись:` }, { inlineData: { mimeType: mime, data: audio } }] : [{ text: `${head}Текст:\n${text}` }];
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 } }),
      signal: AbortSignal.timeout(40_000),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const parsed = JSON.parse(data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '') as { items?: unknown; transcript?: unknown };
    const items = (Array.isArray(parsed.items) ? parsed.items : []).slice(0, MAX_ITEMS);
    const transcript = audio !== '' && typeof parsed.transcript === 'string' ? parsed.transcript.trim().slice(0, MAX_TEXT) : undefined;
    return json(200, { ok: true, items, transcript });
  } catch (e) {
    console.error('parse-shopping:', e instanceof Error ? e.message : e);
    return json(502, { ok: false, error: 'upstream' });
  }
});
