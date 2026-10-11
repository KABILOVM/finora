/**
 * Идентификаторы.
 *  - newId() — случайный UUID v4 для обычных записей;
 *  - uuidV5() / defaultId() — ДЕТЕРМИНИРОВАННЫЕ id для затравки: два устройства одного пользователя
 *    получают одни и те же id стартовых категорий и кошелька, поэтому дублей не будет.
 */

/** Фиксированное «пространство имён» Finora. НИКОГДА не менять: от него зависят id стартовых записей у всех устройств. */
export const FINORA_NAMESPACE = 'b3f5c1de-7a42-4d6e-9c1f-5e0a2d8b7f41';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function formatUuid(b: Uint8Array): string {
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** UUID v4. Запасной путь нужен, когда crypto.randomUUID недоступен (например, страница открыта по http в локальной сети). */
export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  return formatUuid(b);
}

function parseUuid(uuid: string): Uint8Array {
  if (!isUuid(uuid)) throw new TypeError(`Некорректный UUID: ${String(uuid)}`);
  const h = uuid.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const rotl = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;

/** SHA-1 на чистом JS — запасной путь, когда crypto.subtle нет (небезопасный контекст). Результат обязан совпадать с crypto.subtle. */
function sha1Fallback(data: Uint8Array): Uint8Array {
  const total = ((data.length + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(total);
  buf.set(data);
  buf[data.length] = 0x80;
  const view = new DataView(buf.buffer);
  const bits = data.length * 8;
  view.setUint32(total - 8, Math.floor(bits / 0x100000000));
  view.setUint32(total - 4, bits >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Array<number>(80).fill(0);

  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + (f >>> 0) + e + k + w[i]!) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((v, i) => ov.setUint32(i * 4, v));
  return out;
}

async function sha1(data: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle && typeof subtle.digest === 'function') {
    try {
      // копия в «чистый» ArrayBuffer: типы TS не любят Uint8Array поверх ArrayBufferLike
      return new Uint8Array(await subtle.digest('SHA-1', new Uint8Array(data)));
    } catch {
      // идём в запасной путь
    }
  }
  return sha1Fallback(data);
}

/** UUID v5 (RFC 4122): SHA-1 от «пространство имён + имя». Одинаковые входы дают одинаковый результат на любом устройстве. */
export async function uuidV5(namespaceUuid: string, name: string): Promise<string> {
  const ns = parseUuid(namespaceUuid);
  const nameBytes = new TextEncoder().encode(name);
  const input = new Uint8Array(ns.length + nameBytes.length);
  input.set(ns);
  input.set(nameBytes, ns.length);
  const digest = (await sha1(input)).slice(0, 16);
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x50;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  return formatUuid(digest);
}

/** Детерминированный id стартовой записи: defaultId(userId, 'category:food'). Slug — вечный, его нельзя переименовывать. */
export function defaultId(userId: string, slug: string): Promise<string> {
  return uuidV5(FINORA_NAMESPACE, `${userId}:${slug}`);
}
