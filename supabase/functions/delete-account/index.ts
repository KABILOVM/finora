/**
 * Edge Function «delete-account»: безвозвратно удаляет аккаунт того, кто вызвал, вместе со всеми его данными в облаке.
 * Нужна, потому что у приложения нет права удалять строки и пользователей (политик DELETE нет, см. schema.sql): удалить пользователя
 * в auth может только сервисная роль. Таблицы с user_id → auth.users объявлены «on delete cascade», поэтому вместе с пользователем
 * уходят его кошельки, категории, операции, бюджеты, долги, платежи и подписки на напоминания.
 * Секреты: SUPABASE_URL, SUPABASE_ANON_KEY и SUPABASE_SERVICE_ROLE_KEY выдаёт сама платформа функций, добавлять ничего не нужно.
 * Защита: пользователя определяет сервер по токену (не по телу запроса), а в теле нужно прислать ТУ ЖЕ почту (защита от случайного вызова).
 */
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info', 'access-control-allow-methods': 'POST, OPTIONS' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' } });

async function userOf(req: Request): Promise<{ id: string; email: string } | null> {
  const auth = req.headers.get('authorization') ?? '', base = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, ''), anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!/^Bearer\s+\S+/i.test(auth) || !base || !anon) return null;
  try {
    const res = await fetch(`${base}/auth/v1/user`, { headers: { apikey: anon, authorization: auth, accept: 'application/json' } });
    const body = res.ok ? ((await res.json()) as { id?: unknown; email?: unknown }) : {};
    return typeof body.id === 'string' && body.id !== '' && typeof body.email === 'string' ? { id: body.id, email: body.email.trim().toLowerCase() } : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method' });
  const base = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, ''), service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!base || !service) return json(500, { ok: false, error: 'not_configured' });
  const user = await userOf(req);
  if (!user) return json(401, { ok: false, error: 'unauthorized' });
  let confirm = '';
  try {
    const b = (await req.json()) as { confirmEmail?: unknown };
    if (typeof b.confirmEmail === 'string') confirm = b.confirmEmail.trim().toLowerCase();
  } catch {
    return json(400, { ok: false, error: 'bad_request' });
  }
  if (confirm === '' || confirm !== user.email) return json(400, { ok: false, error: 'email_mismatch' });
  try {
    const res = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
      method: 'DELETE',
      headers: { apikey: service, authorization: `Bearer ${service}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok && res.status !== 404) throw new Error(`auth ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return json(200, { ok: true });
  } catch (e) {
    console.error('delete-account:', e instanceof Error ? e.message : e);
    return json(502, { ok: false, error: 'upstream' });
  }
});
