/**
 * Edge Function «parse-shopping»: превращает продиктованный (или набранный) текст в список покупок через Gemini.
 * Приложение шлёт {text, known?} или {audio (base64), mime, known?} (запись голоса), получает {items: [{name, qty, unit}], transcript?}. Файл САМОДОСТАТОЧЕН: его целиком вставляют в редактор
 * Edge Functions (Supabase → Edge Functions → Create function → parse-shopping), относительных импортов нет.
 *
 * КАК РАЗВЕРНУТЬ
 *  1. Вставь файл в Edge Function с именем parse-shopping. «Verify JWT» можно отключить: токен пользователя функция проверяет сама
 *     (auth/v1/user), так что без входа в аккаунт ключ Gemini потратить нельзя.
 *  2. Edge Functions → Secrets: добавь GEMINI_API_KEY (ключ из Google AI Studio). Необязательно: GEMINI_MODEL — другая модель
 *     (по умолчанию gemini-3.8-flash). SUPABASE_URL и SUPABASE_ANON_KEY платформа подставляет сама. Ключей в коде нет и быть не должно.
 *  3. Проверка: войти в приложение → Покупки → «Добавить списком» → продиктовать «мука масло два литра молока» → «Разобрать».
 *
 * БЕЗОПАСНОСТЬ: нужен вход (токен проверяется на сервере авторизации); текст не длиннее 2000 символов, запись не больше ~3 МБ; не больше 20 запросов
 * в минуту на человека; в ответ уходит только разобранный список, ошибки Gemini наружу не пробрасываются.
 */

// deno-lint-ignore no-explicit-any
declare const Deno: any;

const MAX_TEXT = 2000;
/** Запись голоса в base64: около 3 МБ, это минуты речи в AAC/Opus. */
const MAX_AUDIO = 4_000_000;
const AUDIO_MIME: Record<string, string> = {
  'audio/mp4': 'audio/mp4',
  'audio/x-m4a': 'audio/mp4',
  'audio/aac': 'audio/aac',
  'audio/webm': 'audio/webm',
  'audio/ogg': 'audio/ogg',
  'audio/mpeg': 'audio/mpeg',
  'audio/wav': 'audio/wav',
};
const MAX_KNOWN = 200;
const MAX_ITEMS = 100;
const PER_MINUTE = 20;
const DEFAULT_MODEL = 'gemini-3.8-flash';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' } });

const PROMPT = `Ты разбираешь список покупок, который человек продиктовал голосом или набрал. Речь распознана автоматически: знаков препинания обычно нет, бывают ошибки.
Верни позиции списка.
Правила:
- Каждый товар — отдельная позиция. «мука масло сливочное сахар» → «мука», «масло сливочное», «сахар». Прилагательное остаётся с товаром.
- name: название товара в именительном падеже так, как его пишут в списке покупок (молоко, яблоки, хлеб), по-русски, с маленькой буквы, без количества и слов «купить», «надо». Не придумывай товары, которых не называли.
- qty: число в единице unit. «2 литра» → 2, «полтора кило» → 1.5, «300 грамм» → 0.3 (unit kg), «500 мл» → 0.5 (unit l), «пара» → 2, «дюжина» → 12. Если количество не названо — 1.
- unit: «kg» для веса, «l» для жидкости в литрах, «pcs» для штук, пачек, бутылок, банок и когда единица не названа.
- Если название похоже на одно из известных человеку (список known), пиши его в том же виде.
- Если в тексте нет товаров, верни пустой список.
- Если вместо текста дана аудиозапись, прослушай её и в transcript запиши дословную расшифровку по-русски (со знаками препинания), затем разбери её по тем же правилам. Для текста transcript не нужен.`;

const SCHEMA = {
  type: 'OBJECT',
  propertyOrdering: ['transcript', 'items'],
  properties: {
    transcript: { type: 'STRING' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          qty: { type: 'NUMBER' },
          unit: { type: 'STRING', enum: ['pcs', 'kg', 'l'] },
        },
        required: ['name', 'qty', 'unit'],
      },
    },
  },
  required: ['items'],
};

// Грубое ограничение частоты в памяти экземпляра функции: от случайного зацикливания, не от атаки.
const hits = new Map<string, number[]>();
function limited(user: string, now: number): boolean {
  const list = (hits.get(user) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= PER_MINUTE) {
    hits.set(user, list);
    return true;
  }
  list.push(now);
  hits.set(user, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

async function userOf(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? '';
  const base = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!/^Bearer\s+\S+/i.test(auth) || !base || !anon) return null;
  try {
    const res = await fetch(`${base}/auth/v1/user`, { headers: { apikey: anon, authorization: auth, accept: 'application/json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as { id?: unknown };
    return typeof body.id === 'string' && body.id !== '' ? body.id : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method' });

  const key = Deno.env.get('GEMINI_API_KEY') ?? '';
  if (!key) {
    console.error('parse-shopping: не задан секрет GEMINI_API_KEY');
    return json(500, { ok: false, error: 'not_configured' });
  }
  const user = await userOf(req);
  if (!user) return json(401, { ok: false, error: 'unauthorized' });
  if (limited(user, Date.now())) return json(429, { ok: false, error: 'rate_limited' });

  let text = '';
  let audio = '';
  let mime = '';
  let known: string[] = [];
  try {
    const body = (await req.json()) as { text?: unknown; audio?: unknown; mime?: unknown; known?: unknown };
    if (typeof body.text === 'string') text = body.text.trim();
    if (typeof body.audio === 'string') audio = body.audio;
    if (typeof body.mime === 'string') mime = AUDIO_MIME[body.mime.split(';')[0]!.trim().toLowerCase()] ?? '';
    if (Array.isArray(body.known)) known = body.known.filter((k): k is string => typeof k === 'string').map((k) => k.slice(0, 80)).slice(0, MAX_KNOWN);
  } catch {
    return json(400, { ok: false, error: 'bad_request' });
  }
  if (audio !== '') {
    if (audio.length > MAX_AUDIO) return json(400, { ok: false, error: 'too_long' });
    if (mime === '' || !/^[A-Za-z0-9+/=]+$/.test(audio)) return json(400, { ok: false, error: 'bad_request' });
  } else {
    if (text === '') return json(200, { ok: true, items: [] });
    if (text.length > MAX_TEXT) return json(400, { ok: false, error: 'too_long' });
  }

  const model = Deno.env.get('GEMINI_MODEL') || DEFAULT_MODEL;
  const head = `${PROMPT}\n\nknown: ${JSON.stringify(known)}\n\n`;
  const parts = audio !== '' ? [{ text: `${head}Аудиозапись:` }, { inlineData: { mimeType: mime, data: audio } }] : [{ text: `${head}Текст:\n${text}` }];
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 },
      }),
      signal: AbortSignal.timeout(40_000),
    });
    if (!res.ok) {
      console.error('parse-shopping: Gemini ответил', res.status, (await res.text()).slice(0, 300));
      return json(502, { ok: false, error: 'upstream' });
    }
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    const parsed = JSON.parse(raw) as { items?: unknown; transcript?: unknown };
    const items = (Array.isArray(parsed.items) ? parsed.items : []).slice(0, MAX_ITEMS);
    const transcript = audio !== '' && typeof parsed.transcript === 'string' ? parsed.transcript.trim().slice(0, MAX_TEXT) : undefined;
    return json(200, { ok: true, items, transcript });
  } catch (e) {
    console.error('parse-shopping: сбой', e instanceof Error ? e.message : e);
    return json(502, { ok: false, error: 'upstream' });
  }
});
