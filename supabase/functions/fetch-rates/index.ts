/**
 * Edge Function «fetch-rates»: раз в сутки забирает курсы валют и кладёт их в public.exchange_rates,
 * откуда их читают все устройства (src/rates/server.ts). Файл САМОДОСТАТОЧЕН: его целиком вставляют в редактор
 * Edge Functions (Supabase → Edge Functions → Create function → fetch-rates), относительных импортов нет.
 *
 * !!! ФОРМАТ НЕ ПРОВЕРЕН НА ЖИВОМ ИСТОЧНИКЕ — разбор составлен по предположению !!!
 * Ответы https://www.nbt.tj/en/kurs/export_xml.php и currency-api при написании были недоступны (сеть закрыта).
 * Парсеры терпимы к разным раскладкам, но после первого запуска ОБЯЗАТЕЛЬНО посмотри ответ функции и строку в
 * exchange_rates: нет ли предупреждений (warnings), есть ли TJS, верна ли дата as_of, сходятся ли курсы с сайтом банка.
 * Блоки между маркерами SHARED:* — дословные копии из src/rates/*.ts (проверяет тест src/rates/edge.test.ts).
 *
 * КАК РАЗВЕРНУТЬ
 *  1. Вставь файл в Edge Function с именем fetch-rates. В настройках функции ОТКЛЮЧИ «Verify JWT» (или деплой с
 *     флагом --no-verify-jwt): секрет расписания — не JWT, защита ниже (Authorization: Bearer <CRON_SECRET>).
 *  2. Edge Functions → Secrets: добавь CRON_SECRET (длинная случайная строка БЕЗ пробелов, не меньше 32 символов).
 *     SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY платформа подставляет сама; в коде ключей нет и быть не должно.
 *     Необязательно: NBT_URL — если реальный адрес выгрузки другой (менять код не придётся).
 *  3. Проверка вручную (подставь свои значения):
 *       curl -i -X POST https://<PROJECT_REF>.supabase.co/functions/v1/fetch-rates -H "Authorization: Bearer <CRON_SECRET>"
 *     без заголовка или с чужим секретом ответ 401. Успех: 200 и {"ok":true,"source":"nbt","asOf":"...",...}.
 *
 * КАК ЗАПУСКАТЬ РАЗ В СУТКИ (вариант с pg_cron + pg_net; в этой среде НЕ запускалось — проверь у себя)
 *  Database → Extensions: включи pg_cron и pg_net. Затем в SQL Editor:
 *    select vault.create_secret('<тот же CRON_SECRET>', 'cron_secret');
 *    select cron.schedule('fetch-rates-daily', '30 5 * * *', $$
 *      select net.http_post(
 *        url := 'https://<PROJECT_REF>.supabase.co/functions/v1/fetch-rates',
 *        headers := jsonb_build_object('Content-Type', 'application/json',
 *          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
 *        body := '{}'::jsonb);
 *    $$);
 *  Время cron — UTC: 05:30 UTC = 10:30 в Душанбе. Запасной вариант без pg_cron: любой внешний планировщик
 *  (cron-job.org, GitHub Actions по расписанию), делающий тот же curl. Повторный запуск за тот же день безопасен
 *  (upsert по as_of + source), поэтому планировщик можно запускать и чаще.
 *
 * ЧТО ДЕЛАЕТ: берёт курсы НБТ; если не вышло (сеть, HTML вместо XML, мусор, скачок >50% к прошлой записи) — пробует
 * currency-api; результат проверяет и upsert-ит. Подозрительные данные в таблицу НЕ попадают, функция отвечает 502.
 * Скачок >50% у валюты, которой нет в списке приложения (ARS, крипто-монеты), убирает из записи только её саму
 * (поле excluded в ответе); скачок любой валюты из списка приложения отвергает всю таблицу.
 */

// deno-lint-ignore no-explicit-any
declare const Deno: any;

// Локальные копии доменных типов (src/domain/types.ts): здесь нельзя ничего импортировать.
type IsoDate = string;
type IsoDateTime = string;
type CurrencyCode = string;
interface RateTable {
  asOf: IsoDate;
  pivot: CurrencyCode;
  perUnit: Record<CurrencyCode, number>;
  source: string;
  fetchedAt: IsoDateTime;
}
type ParsedRateTable = RateTable & { warnings: string[] };

// <<< SHARED:util
/** Допустимый диапазон «единиц опорной валюты за 1 единицу». Всё за пределами — мусор, а не курс. */
export const MIN_PER_UNIT = 1e-9;
export const MAX_PER_UNIT = 1e9;
/** Дата курса может опережать сегодняшнюю UTC-дату не больше чем на столько суток (часовые пояса, курс «на завтра»). */
export const FUTURE_TOLERANCE_DAYS = 1;
export const MAX_BODY_CHARS = 5_000_000;
export const MAX_WARNINGS = 30;

export class RateParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateParseError';
  }
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Курс: конечное число в разумных пределах. NaN, Infinity, 0, отрицательные и «огромные» — нет. */
export function isRateValue(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= MIN_PER_UNIT && n <= MAX_PER_UNIT;
}

export function isoDateOf(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

function validYmd(y: number, m: number, d: number): IsoDate | null {
  if (!(y >= 1990 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 'DD.MM.YYYY', 'YYYY-MM-DD' (и с '/', '-', время после даты) → 'YYYY-MM-DD'; несуществующая дата → null. */
export function normalizeDate(raw: string): IsoDate | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:$|[T\s])/.exec(s);
  if (m) return validYmd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})(?:$|[T\s])/.exec(s);
  if (m) return validYmd(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return validYmd(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Сколько календарных суток от `from` до `to` (отрицательно, если `to` раньше). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function isFutureDate(asOf: IsoDate, now: Date): boolean {
  return asOf > addDays(isoDateOf(now), FUTURE_TOLERANCE_DAYS);
}

/**
 * Число из текста: '10,9', '10.9', '1 234,5', '1,234.56', '1.234,56'. Минус, буквы, степени ('1e5') → null.
 * Единственный разделитель считается десятичным ('1,234' = 1.234); несколько одинаковых — тысячами ('1,234,567').
 * Это не проверка диапазона: 0 вернётся как 0, границы проверяет isRateValue.
 */
export function parseDecimal(raw: string): number | null {
  if (typeof raw !== 'string') return null;
  let s = raw.replace(/[\s  ']/g, '');
  if (s === '' || !/^[0-9.,]+$/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const decDot = lastDot > lastComma;
    const parts = s.split(decDot ? '.' : ',');
    if (parts.length !== 2) return null;
    const intPart = parts[0] ?? '';
    const grouped = decDot ? /^\d{1,3}(?:,\d{3})+$/ : /^\d{1,3}(?:\.\d{3})+$/;
    if (!/^\d+$/.test(intPart) && !grouped.test(intPart)) return null;
    s = `${intPart.replace(/[.,]/g, '')}.${parts[1] ?? ''}`;
  } else if (lastDot >= 0 || lastComma >= 0) {
    const parts = s.split(lastDot >= 0 ? '.' : ',');
    if (parts.length > 2) {
      const lead = (parts[0] ?? '').length;
      if (!parts.slice(1).every((p) => p.length === 3) || lead < 1 || lead > 3) return null;
      s = parts.join('');
    } else {
      s = parts.join('.');
    }
  }
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Номинал («курс за N единиц») — всегда ЦЕЛОЕ число единиц, поэтому разделитель в нём — только разделитель тысяч:
 * '10', '1 000', '1,000', '1.000', '1,000,000' → 10, 1000, 1000, 1000, 1000000; хвост из нулей ('1.0', '1,00') отбрасывается.
 * Дробный ('0,5', '1,5'), нулевой, со знаком или с буквами → null (запись отбрасывают, а не угадывают масштаб:
 * ошибка в 1000 раз молча испортила бы все суммы).
 */
export function parseNominal(raw: string): number | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/[\s']/g, '');
  let digits: string;
  if (/^\d+$/.test(s)) digits = s;
  else if (/^[1-9]\d{0,2}(?:,\d{3})+$/.test(s) || /^[1-9]\d{0,2}(?:\.\d{3})+$/.test(s)) digits = s.replace(/[.,]/g, '');
  else if (/^\d+[.,]0+$/.test(s)) digits = s.slice(0, s.search(/[.,]/));
  else return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Байты ответа → текст. Порядок: BOM, charset из Content-Type, encoding из <?xml ...?>, иначе UTF-8. */
export function decodeBody(buf: ArrayBuffer | Uint8Array, contentType?: string | null): string {
  const bytes = ArrayBuffer.isView(buf) ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : new Uint8Array(buf);
  const decode = (label: string): string | null => {
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      return null; // неизвестная кодировка
    }
  };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return decode('utf-16le') ?? '';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return decode('utf-16be') ?? '';
  let label = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType ?? '')?.[1];
  if (!label) {
    const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 200));
    label = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([\w.:-]+)["']/i.exec(head)?.[1];
  }
  return (label ? decode(label) : null) ?? decode('utf-8') ?? '';
}

/** Не даёт списку предупреждений разрастись: первые MAX_WARNINGS и строка «…и ещё N». */
export function boundWarnings(list: readonly string[]): string[] {
  if (list.length <= MAX_WARNINGS) return [...list];
  return [...list.slice(0, MAX_WARNINGS), `…и ещё ${list.length - MAX_WARNINGS}`];
}
// SHARED:util >>>

// <<< SHARED:nbt
interface XNode {
  name: string;
  attrs: Map<string, string>;
  children: XNode[];
  text: string;
}

const MAX_XML_DEPTH = 64;
/** Настоящий ответ — сотни элементов; десятки тысяч значат мусор или атаку, а память браузера не резиновая. */
const MAX_XML_NODES = 100_000;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Только пять стандартных сущностей и числовые коды. Пользовательские <!ENTITY> НЕ раскрываем (защита от «бомб»). */
function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole: string, body: string) => {
    if (body.startsWith('#')) {
      const cp = body.charAt(1).toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      const ok = Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff);
      return ok ? String.fromCodePoint(cp) : '';
    }
    return ENTITIES[body] ?? whole;
  });
}

const isSpace = (c: string): boolean => c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f';
const normKey = (s: string): string => s.toLowerCase().replace(/[\s_\-:.]/g, '');
const localName = (s: string): string => s.slice(s.lastIndexOf(':') + 1).toLowerCase();

/** Разбор открывающего тега, начинающегося в позиции lt. Не падает на кривой разметке. */
function readStartTag(xml: string, lt: number) {
  const n = xml.length;
  let i = lt + 1;
  while (i < n && !isSpace(xml.charAt(i)) && xml.charAt(i) !== '/' && xml.charAt(i) !== '>') i++;
  const name = localName(xml.slice(lt + 1, i));
  const attrs = new Map<string, string>();
  let selfClosing = false;
  while (i < n) {
    const ch = xml.charAt(i);
    if (ch === '>') {
      i++;
      break;
    }
    if (ch === '/') {
      if (xml.charAt(i + 1) === '>') {
        selfClosing = true;
        i += 2;
        break;
      }
      i++;
      continue;
    }
    if (isSpace(ch)) {
      i++;
      continue;
    }
    const keyStart = i;
    while (i < n && !isSpace(xml.charAt(i)) && !'=/>'.includes(xml.charAt(i))) i++;
    const key = normKey(localName(xml.slice(keyStart, i))); // префикс пространства имён (n:Date) отбрасываем
    while (i < n && isSpace(xml.charAt(i))) i++;
    let value = '';
    if (xml.charAt(i) === '=') {
      i++;
      while (i < n && isSpace(xml.charAt(i))) i++;
      const q = xml.charAt(i);
      if (q === '"' || q === "'") {
        const close = xml.indexOf(q, i + 1);
        value = xml.slice(i + 1, close < 0 ? n : close);
        i = close < 0 ? n : close + 1;
      } else {
        const valueStart = i;
        while (i < n && !isSpace(xml.charAt(i)) && xml.charAt(i) !== '>') i++;
        value = xml.slice(valueStart, i);
      }
    }
    if (key !== '' && !attrs.has(key)) attrs.set(key, decodeEntities(value));
  }
  return { name, attrs, selfClosing, end: i };
}

/** Пропускает <!DOCTYPE ...> (в том числе с [внутренним подмножеством]) и прочие <!...>. */
function skipDeclaration(xml: string, lt: number): number {
  let depth = 0;
  for (let i = lt + 2; i < xml.length; i++) {
    const c = xml.charAt(i);
    if (c === '[') depth++;
    else if (c === ']') depth = Math.max(0, depth - 1);
    else if (c === '>' && depth === 0) return i + 1;
  }
  return xml.length;
}

/** Маленький сканер вместо DOMParser: одинаков в браузере, Node и Deno. Терпит незакрытые и лишние теги. */
function scanXml(xml: string): XNode {
  const root: XNode = { name: '#root', attrs: new Map(), children: [], text: '' };
  const stack: XNode[] = [root];
  const n = xml.length;
  let i = 0;
  let nodes = 0;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    const top = stack[stack.length - 1] ?? root;
    if (lt < 0) {
      top.text += decodeEntities(xml.slice(i));
      break;
    }
    if (lt > i) top.text += decodeEntities(xml.slice(i, lt));
    if (xml.startsWith('<!--', lt)) {
      const e = xml.indexOf('-->', lt + 4);
      i = e < 0 ? n : e + 3;
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const e = xml.indexOf(']]>', lt + 9);
      top.text += xml.slice(lt + 9, e < 0 ? n : e);
      i = e < 0 ? n : e + 3;
    } else if (xml.startsWith('<?', lt)) {
      const e = xml.indexOf('?>', lt + 2);
      i = e < 0 ? n : e + 2;
    } else if (xml.startsWith('<!', lt)) {
      i = skipDeclaration(xml, lt);
    } else if (xml.charAt(lt + 1) === '/') {
      const gt = xml.indexOf('>', lt + 2);
      const name = localName(xml.slice(lt + 2, gt < 0 ? n : gt).trim());
      for (let k = stack.length - 1; k >= 1; k--) {
        if (stack[k]?.name === name) {
          stack.length = k;
          break;
        }
      }
      i = gt < 0 ? n : gt + 1;
    } else if (!/[A-Za-z_:]/.test(xml.charAt(lt + 1))) {
      top.text += '<'; // одинокий «<» внутри текста
      i = lt + 1;
    } else {
      if (++nodes > MAX_XML_NODES) throw new RateParseError('Слишком много элементов в XML');
      const tag = readStartTag(xml, lt);
      const node: XNode = { name: tag.name, attrs: tag.attrs, children: [], text: '' };
      top.children.push(node);
      if (!tag.selfClosing) {
        stack.push(node);
        if (stack.length > MAX_XML_DEPTH) throw new RateParseError('Слишком глубокая вложенность XML');
      }
      i = tag.end;
    }
  }
  return root;
}

// Имена полей (после normKey) в порядке предпочтения. Это ПРЕДПОЛОЖЕНИЯ о разметке, см. шапку файла.
const CODE_KEYS = ['charcode', 'isocode', 'code', 'iso', 'currencycode', 'currency', 'ccy', 'cur', 'curr'];
const VALUE_KEYS = ['value', 'rate', 'kurs', 'officialrate', 'official', 'val', 'курс'];
const NOMINAL_KEYS = ['nominal', 'scale', 'units', 'unit', 'quantity', 'номинал'];
const DATE_KEYS = ['date', 'valdate', 'asof', 'ondate', 'ratedate', 'дата'];

/** Поля элемента: его атрибуты + текст дочерних элементов-«листьев». Первое значение имени побеждает. */
function fieldsOf(node: XNode): Map<string, string> {
  const f = new Map<string, string>(node.attrs);
  for (const c of node.children) {
    const key = normKey(c.name);
    if (c.children.length === 0 && !f.has(key)) f.set(key, c.text.trim());
  }
  return f;
}

function pickFirst(f: Map<string, string>, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = f.get(k);
    if (v !== undefined) return v;
  }
  return undefined;
}

function pickCode(f: Map<string, string>): string | undefined {
  for (const k of CODE_KEYS) {
    const v = f.get(k)?.trim();
    if (v !== undefined && /^[A-Za-z]{3}$/.test(v)) return v.toUpperCase();
  }
  return undefined;
}

interface RawRecord {
  code: string;
  valueRaw: string;
  nominalRaw: string | undefined;
}

interface Collected {
  records: RawRecord[];
  dates: string[];
  warnings: string[];
}

function visit(node: XNode, out: Collected): void {
  const f = fieldsOf(node);
  const dateRaw = pickFirst(f, DATE_KEYS);
  if (dateRaw !== undefined) out.dates.push(dateRaw);
  const valueRaw = pickFirst(f, VALUE_KEYS);
  if (valueRaw !== undefined) {
    const code = pickCode(f);
    if (code !== undefined) {
      out.records.push({ code, valueRaw, nominalRaw: pickFirst(f, NOMINAL_KEYS) });
      return; // внутрь записи не заходим
    }
    const anyCode = (pickFirst(f, CODE_KEYS) ?? '').trim();
    if (anyCode !== '') {
      out.warnings.push(`Пропущена запись с кодом «${anyCode.slice(0, 20)}»: нужен буквенный код из 3 букв`);
      return;
    }
  }
  for (const c of node.children) visit(c, out);
}

/**
 * XML Нацбанка → RateTable (pivot 'TJS', perUnit[TJS] = 1, perUnit[X] = Value / Nominal).
 * Бросает RateParseError: пустой ответ, HTML вместо XML, нет даты или дата из будущего, нет ни одного корректного курса.
 * Мусорные записи (ноль, минус, не число, дубли кодов) отбрасываются и описываются в `warnings`; при дубле берётся первая запись.
 */
export function parseNbtXml(xml: string, now: Date = new Date()): ParsedRateTable {
  if (typeof xml !== 'string') throw new RateParseError('Ожидался текст XML');
  const text = xml.replace(/^﻿/, '');
  if (text.trim() === '') throw new RateParseError('Пустой ответ');
  if (text.length > MAX_BODY_CHARS) throw new RateParseError('Ответ слишком большой');
  if (/<!doctype\s+html|<html[\s>]/i.test(text.slice(0, 3000))) {
    throw new RateParseError('Получен HTML, а не XML (страница ошибки, блокировка или перенаправление)');
  }
  const root = scanXml(text);
  if (root.children.length === 0) throw new RateParseError('Ответ не похож на XML');

  const found: Collected = { records: [], dates: [], warnings: [] };
  visit(root, found);
  const warnings = found.warnings;
  if (found.records.length === 0) {
    throw new RateParseError(`Не найдено ни одного курса${warnings[0] ? `: ${warnings[0]}` : ''}`);
  }

  const dates = new Set<string>();
  let badDate: string | undefined;
  for (const raw of found.dates) {
    const d = normalizeDate(raw);
    if (d) dates.add(d);
    else badDate ??= raw;
  }
  if (dates.size === 0) {
    throw new RateParseError(badDate === undefined ? 'В ответе нет даты курсов' : `Не удалось разобрать дату «${badDate.slice(0, 30)}»`);
  }
  if (dates.size > 1) throw new RateParseError(`В ответе несколько разных дат курсов: ${[...dates].sort().join(', ')}`);
  const asOf = [...dates][0] as string;
  if (isFutureDate(asOf, now)) throw new RateParseError(`Дата курсов ${asOf} из будущего`);

  const taken = new Map<string, number>();
  const seen = new Set<string>();
  for (const r of found.records) {
    if (r.code === 'TJS') continue; // опорная валюта, её курс всегда 1
    if (seen.has(r.code)) {
      warnings.push(`Дубль ${r.code}: повторная запись проигнорирована, взята первая`);
      continue;
    }
    seen.add(r.code);
    const value = parseDecimal(r.valueRaw);
    if (value === null || !(value > 0)) {
      warnings.push(`${r.code}: некорректное значение «${r.valueRaw.slice(0, 30)}», запись отброшена`);
      continue;
    }
    const nominal = r.nominalRaw === undefined ? 1 : parseNominal(r.nominalRaw); // номинал — целое: '10,000' это 10000, а не 10
    if (nominal === null || !(nominal > 0)) {
      warnings.push(`${r.code}: некорректный Nominal «${(r.nominalRaw ?? '').slice(0, 30)}», запись отброшена`);
      continue;
    }
    const perUnit = value / nominal;
    if (!isRateValue(perUnit)) {
      warnings.push(`${r.code}: курс ${perUnit} вне допустимых границ, запись отброшена`);
      continue;
    }
    taken.set(r.code, perUnit);
  }
  if (taken.size === 0) {
    throw new RateParseError(`Не найдено ни одного корректного курса${warnings[0] ? `: ${warnings[0]}` : ''}`);
  }
  const perUnit: Record<string, number> = { TJS: 1 };
  for (const code of [...taken.keys()].sort()) perUnit[code] = taken.get(code) as number;
  return { asOf, pivot: 'TJS', perUnit, source: 'nbt', fetchedAt: now.toISOString(), warnings: boundWarnings(warnings) };
}
// SHARED:nbt >>>

// <<< SHARED:api
/**
 * JSON currency-api → RateTable. `json` — объект или JSON-строка, `base` — код базовой валюты ответа ('usd').
 * Бросает RateParseError: не JSON, нет даты / раздела base, дата из будущего, нет ни одного корректного курса.
 */
export function parseCurrencyApiJson(json: unknown, base: string, now: Date = new Date()): ParsedRateTable {
  const baseCode = typeof base === 'string' ? base.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(baseCode)) throw new RateParseError('Некорректная базовая валюта ответа');
  let data: unknown = json;
  if (typeof data === 'string') {
    if (data.length > MAX_BODY_CHARS) throw new RateParseError('Ответ слишком большой');
    try {
      data = JSON.parse(data.replace(/^﻿/, ''));
    } catch {
      throw new RateParseError('Ответ не является JSON');
    }
  }
  if (!isPlainObject(data)) throw new RateParseError('Ответ не является JSON-объектом');
  const asOf = typeof data.date === 'string' ? normalizeDate(data.date) : null;
  if (asOf === null) throw new RateParseError('В ответе нет корректной даты курсов');
  if (isFutureDate(asOf, now)) throw new RateParseError(`Дата курсов ${asOf} из будущего`);
  const section = data[baseCode.toLowerCase()] ?? data[baseCode];
  if (!isPlainObject(section)) throw new RateParseError(`В ответе нет раздела «${baseCode.toLowerCase()}»`);

  const warnings: string[] = [];
  const units = new Map<string, number>(); // код → единиц этой валюты за 1 базовую
  for (const [key, raw] of Object.entries(section)) {
    const code = key.toUpperCase();
    if (!/^[A-Z]{3}$/.test(code) || code === baseCode) continue; // 1inch, ... — не валюты; сама база — не курс
    if (units.has(code)) {
      warnings.push(`Дубль ${code}: повторная запись проигнорирована, взята первая`);
      continue;
    }
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseDecimal(raw) : null;
    if (!isRateValue(value)) {
      warnings.push(`${code}: некорректное значение, запись отброшена`);
      continue;
    }
    units.set(code, value);
  }

  const tjsPerBase = baseCode === 'TJS' ? 1 : units.get('TJS');
  const pivot = tjsPerBase === undefined ? baseCode : 'TJS';
  if (tjsPerBase === undefined) {
    warnings.push(`В ответе нет tjs: курсы приведены к ${baseCode}, пересчёт в сомони по ним невозможен`);
  }
  const factor = pivot === 'TJS' ? (tjsPerBase as number) : 1; // сколько единиц pivot в 1 единице базовой валюты
  const perUnit: Record<string, number> = { [pivot]: 1 };
  if (baseCode !== pivot) perUnit[baseCode] = factor;
  for (const code of [...units.keys()].sort()) {
    if (code === pivot) continue;
    const v = factor / (units.get(code) as number);
    if (!isRateValue(v)) {
      warnings.push(`${code}: курс ${v} вне допустимых границ, запись отброшена`);
      continue;
    }
    perUnit[code] = v;
  }
  if (Object.keys(perUnit).length < 2) throw new RateParseError('Не найдено ни одного корректного курса');
  return { asOf, pivot, perUnit, source: 'api', fetchedAt: now.toISOString(), warnings: boundWarnings(warnings) };
}
// SHARED:api >>>

// <<< SHARED:sanity
export interface RateAssessment {
  ok: boolean;
  /**
   * Почему отказ. При ok=true непустой список — предупреждение: валюты из `excluded` скакнули, их надо убрать
   * из таблицы (withoutCodes) и не принимать, а остальные курсы таблицы принять.
   */
  reasons: string[];
  /** Только при ok=true и только если есть что убрать: коды валют (не из GUARDED_CURRENCIES) со скачком курса. */
  excluded?: string[];
}

/** Курс любой валюты не должен меняться больше чем на 50% относительно предыдущей сохранённой таблицы. */
export const MAX_RELATIVE_CHANGE = 0.5;

/**
 * Валюты, которые можно выбрать в приложении (копия CURRENCIES из domain/currency.ts, сверяется тестом).
 * Скачок такой валюты отвергает всю таблицу: по ней считаются деньги пользователя. Скачок любой другой (ARS, крипто-монета
 * из currency-api и т.п.) убирает из таблицы только её саму: иначе одна «взбесившаяся» экзотическая валюта навсегда
 * заморозила бы курсы USD и EUR.
 */
export const GUARDED_CURRENCIES: readonly string[] = ['TJS', 'USD', 'EUR', 'RUB', 'KZT', 'UZS', 'KGS', 'CNY', 'TRY', 'AED', 'GBP', 'KRW', 'JPY'];

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const fmt = (n: number): string => String(Number(n.toPrecision(6)));

/** Структура и значения: пусто = таблица пригодна к использованию. */
function tableProblems(t: unknown): string[] {
  if (!isPlainObject(t)) return ['Таблица курсов не является объектом'];
  const out: string[] = [];
  const pivot = t.pivot;
  if (typeof pivot !== 'string' || !/^[A-Z]{3}$/.test(pivot)) out.push('Некорректная опорная валюта');
  if (typeof t.asOf !== 'string' || normalizeDate(t.asOf) !== t.asOf) out.push('Некорректная дата курсов');
  if (typeof t.fetchedAt !== 'string' || Number.isNaN(Date.parse(t.fetchedAt))) out.push('Некорректное время получения курсов');
  const perUnit = t.perUnit;
  if (!isPlainObject(perUnit)) return [...out, 'Нет таблицы курсов perUnit'];
  if (typeof pivot === 'string' && perUnit[pivot] !== 1) out.push('Курс опорной валюты должен быть равен 1');
  const codes = Object.keys(perUnit);
  if (codes.length < 2) out.push('В таблице нет ни одного курса, кроме опорной валюты');
  for (const code of codes) {
    if (!/^[A-Z]{3}$/.test(code)) out.push(`Некорректный код валюты «${code.slice(0, 20)}»`);
    else if (!isRateValue(perUnit[code])) out.push(`Некорректное значение курса ${code}: ${String(perUnit[code]).slice(0, 30)}`);
  }
  return out;
}

interface Jump {
  code: string;
  text: string;
}

/** Сравнение с прошлой таблицей. Таблицы могут иметь разные pivot — тогда сравниваем курсы относительно общей валюты. */
function jumps(next: RateTable, prev: RateTable): { compared: number; found: Jump[] } {
  const common = Object.keys(next.perUnit).filter((c) => hasOwn(prev.perUnit, c));
  if (common.length < 2) return { compared: 0, found: [] }; // сравнивать нечего
  const ref =
    next.pivot === prev.pivot || hasOwn(prev.perUnit, next.pivot)
      ? next.pivot
      : hasOwn(next.perUnit, prev.pivot)
        ? prev.pivot
        : (common[0] as string);
  const nextRef = next.perUnit[ref] as number;
  const prevRef = prev.perUnit[ref] as number;
  const found: Jump[] = [];
  let compared = 0;
  for (const code of common) {
    if (code === ref) continue;
    compared++;
    const a = (next.perUnit[code] as number) / nextRef;
    const b = (prev.perUnit[code] as number) / prevRef;
    const change = (a - b) / b;
    if (Math.abs(change) > MAX_RELATIVE_CHANGE) {
      found.push({ code, text: `${code}: ${fmt(b)} → ${fmt(a)} (${change > 0 ? '+' : '−'}${Math.round(Math.abs(change) * 100)}%)` });
    }
  }
  return { compared, found };
}

/**
 * С какой из сохранённых таблиц (свежие первыми) сравнивать `next`: с самой свежей, где есть опорная валюта `next`.
 * Иначе масштаб относительно неё не проверить: свежая таблица без TJS «слепа» к ошибке в курсе сомони. Нет такой — самая свежая.
 */
export function pickComparable(next: unknown, candidates: readonly RateTable[]): RateTable | null {
  const pivot = isPlainObject(next) ? next.pivot : undefined;
  if (typeof pivot === 'string') {
    const hit = candidates.find((c) => isPlainObject(c) && isPlainObject(c.perUnit) && hasOwn(c.perUnit, pivot));
    if (hit) return hit;
  }
  return candidates[0] ?? null;
}

/** Копия таблицы без перечисленных валют (опорную не трогает). */
export function withoutCodes(table: RateTable, codes: readonly string[]): RateTable {
  const perUnit: Record<string, number> = {};
  for (const [code, v] of Object.entries(table.perUnit)) if (code === table.pivot || !codes.includes(code)) perUnit[code] = v;
  return { ...table, perUnit };
}

/**
 * Годится ли таблица `next` для сохранения. Отвергает: битую структуру; нечисловые, не конечные, нулевые,
 * отрицательные и «огромные» значения; скачок курса любой валюты из GUARDED_CURRENCIES больше чем на 50% относительно
 * `previous`; скачки у половины и более сравниваемых валют (так выглядит системная ошибка, например масштаба).
 * Скачок только у валют вне GUARDED_CURRENCIES не отвергает таблицу: ok=true и `excluded` — их надо убрать (withoutCodes).
 */
export function assessRateTable(next: RateTable, previous?: RateTable | null): RateAssessment {
  const bad = tableProblems(next);
  if (bad.length > 0) return { ok: false, reasons: boundWarnings(bad) };
  if (!previous || tableProblems(previous).length > 0) return { ok: true, reasons: [] };
  const { compared, found } = jumps(next, previous);
  if (found.length === 0) return { ok: true, reasons: [] };
  const reasons = boundWarnings(found.map((j) => j.text));
  if (found.some((j) => GUARDED_CURRENCIES.includes(j.code)) || found.length * 2 >= compared) return { ok: false, reasons };
  return { ok: true, reasons, excluded: found.map((j) => j.code) };
}
// SHARED:sanity >>>


// ====================== Только для сервера (на клиенте этого кода нет) ======================

export const NBT_URL = 'https://www.nbt.tj/en/kurs/export_xml.php';
/** Адреса из задания, НЕ ПРОВЕРЕНЫ. */
export const API_MIRRORS: readonly string[] = [
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
  'https://latest.currency-api.pages.dev/v1/currencies/usd.json',
];
const UPSTREAM_TIMEOUT_MS = 10_000;
const MAX_BYTES = MAX_BODY_CHARS * 2;

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** Зависимости handler; в бою все берутся из окружения Deno, в тестах подставляются. */
export interface HandlerDeps {
  env?: (name: string) => string | undefined;
  fetchImpl?: FetchFn;
  now?: () => Date;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function errorText(e: unknown): string {
  if (e instanceof Error) return (e.name === 'AbortError' ? 'нет ответа за 10 с' : e.message || e.name).slice(0, 300);
  return String(e).slice(0, 300);
}

/** Сравнение без раннего выхода: время не зависит от того, сколько символов совпало. */
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

/** true только для «Authorization: Bearer <secret>». Пустой secret не пускает никого. */
export function isAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  const m = /^Bearer\s+(\S+)$/i.exec((header ?? '').trim());
  return m !== null && safeEqual(m[1] ?? '', secret);
}

async function timed<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fn(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function getBytes(fetchImpl: FetchFn, url: string, headers?: Record<string, string>) {
  return timed(async (signal) => {
    const res = await fetchImpl(url, { headers, signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES) throw new Error('Ответ слишком большой');
    return { bytes, contentType: res.headers.get('content-type') };
  });
}

async function loadNbt(fetchImpl: FetchFn, url: string, now: Date): Promise<ParsedRateTable> {
  const { bytes, contentType } = await getBytes(fetchImpl, url, { accept: 'application/xml, text/xml, */*' });
  return parseNbtXml(decodeBody(bytes, contentType), now);
}

async function loadApi(fetchImpl: FetchFn, now: Date): Promise<ParsedRateTable> {
  const problems: string[] = [];
  for (const url of API_MIRRORS) {
    try {
      const { bytes, contentType } = await getBytes(fetchImpl, url);
      return parseCurrencyApiJson(decodeBody(bytes, contentType), 'usd', now);
    } catch (e) {
      problems.push(`${url.split('/')[2] ?? url}: ${errorText(e)}`);
    }
  }
  throw new Error(`Все зеркала currency-api недоступны (${problems.join('; ')})`);
}

const dbHeaders = (key: string): Record<string, string> => ({ apikey: key, authorization: `Bearer ${key}` });

/**
 * Последние пригодные строки exchange_rates (свежие первыми) — для сравнения «скачок больше 50%».
 * Их несколько, потому что в самой свежей может не быть TJS (запасной источник без tjs), а сравнить масштаб сомони
 * надо с таблицей, где он есть (pickComparable). Бросает, если базу не удалось прочитать.
 */
async function loadPrevious(base: string, key: string, fetchImpl: FetchFn): Promise<RateTable[]> {
  const url = `${base}/rest/v1/exchange_rates?select=as_of,source,pivot,per_unit,fetched_at&order=as_of.desc&limit=5`;
  const { bytes } = await getBytes(fetchImpl, url, dbHeaders(key));
  let rows: unknown;
  try {
    rows = JSON.parse(decodeBody(bytes, 'application/json'));
  } catch {
    throw new Error('ответ exchange_rates не JSON');
  }
  if (!Array.isArray(rows)) throw new Error('ответ exchange_rates: ожидался массив строк');
  const out: RateTable[] = [];
  for (const row of rows as unknown[]) {
    if (!isPlainObject(row)) continue;
    const candidate = {
      asOf: row.as_of,
      pivot: row.pivot,
      perUnit: row.per_unit,
      source: 'server',
      fetchedAt: row.fetched_at,
    } as RateTable;
    if (assessRateTable(candidate).ok) out.push(candidate);
  }
  return out;
}

async function saveTable(base: string, key: string, fetchImpl: FetchFn, t: RateTable): Promise<void> {
  const row = { as_of: t.asOf, source: t.source, pivot: t.pivot, per_unit: t.perUnit, fetched_at: t.fetchedAt };
  await timed(async (signal) => {
    const res = await fetchImpl(`${base}/rest/v1/exchange_rates?on_conflict=as_of,source`, {
      method: 'POST',
      headers: { ...dbHeaders(key), 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([row]),
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  });
}

/**
 * Обработчик запроса. Порядок проверок: секрет настроен (иначе 500) → заголовок Authorization верен (иначе 401) →
 * метод POST (иначе 405) → окружение (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) → сбор курсов.
 */
export async function handler(req: Request, deps: HandlerDeps = {}): Promise<Response> {
  const env = deps.env ?? ((name: string) => Deno.env.get(name) as string | undefined);
  const secret = env('CRON_SECRET');
  if (!secret) {
    console.error('fetch-rates: CRON_SECRET не задан, все запросы отклоняются');
    return jsonResponse(500, { ok: false, error: 'not_configured' });
  }
  if (!isAuthorized(req.headers.get('authorization'), secret)) return jsonResponse(401, { ok: false, error: 'unauthorized' });
  if (req.method !== 'POST') return jsonResponse(405, { ok: false, error: 'method_not_allowed' });

  const base = (env('SUPABASE_URL') ?? '').replace(/\/+$/, '');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!/^https?:\/\/\S+$/.test(base) || serviceKey === '') {
    console.error('fetch-rates: нет SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY');
    return jsonResponse(500, { ok: false, error: 'not_configured' });
  }
  const fetchImpl: FetchFn = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const now = deps.now?.() ?? new Date();
  const scrub = (s: string): string => s.split(serviceKey).join('***').split(secret).join('***');

  let previous: RateTable[];
  try {
    previous = await loadPrevious(base, serviceKey, fetchImpl);
  } catch (e) {
    // не пишем «вслепую»: без прошлой записи нельзя отличить настоящий курс от скачка
    console.error('fetch-rates: не удалось прочитать exchange_rates', scrub(errorText(e)));
    return jsonResponse(502, { ok: false, error: 'db_read_failed', message: scrub(errorText(e)) });
  }

  const failures: { source: string; message: string }[] = [];
  let chosen: ParsedRateTable | null = null;
  let excluded: string[] = [];
  const loaders: [string, () => Promise<ParsedRateTable>][] = [
    ['nbt', () => loadNbt(fetchImpl, env('NBT_URL') || NBT_URL, now)],
    ['api', () => loadApi(fetchImpl, now)],
  ];
  for (const [id, load] of loaders) {
    try {
      const table = await load();
      const verdict = assessRateTable(table, pickComparable(table, previous));
      if (!verdict.ok) {
        failures.push({ source: id, message: `отклонено как подозрительное: ${verdict.reasons.join('; ')}` });
        continue;
      }
      if (verdict.excluded) {
        // скачок только у валют вне списка приложения: убираем их, остальные курсы принимаем
        excluded = verdict.excluded;
        chosen = { ...withoutCodes(table, excluded), warnings: [...table.warnings, `Не приняты из-за скачка курса: ${verdict.reasons.join('; ')}`] };
      } else {
        chosen = table;
      }
      break;
    } catch (e) {
      failures.push({ source: id, message: scrub(errorText(e)) });
    }
  }
  if (!chosen) {
    console.error('fetch-rates: курсы не получены', JSON.stringify(failures));
    return jsonResponse(502, { ok: false, error: 'no_valid_rates', failures });
  }

  const { warnings, ...table } = chosen;
  try {
    await saveTable(base, serviceKey, fetchImpl, table);
  } catch (e) {
    console.error('fetch-rates: не удалось записать exchange_rates', scrub(errorText(e)));
    return jsonResponse(502, { ok: false, error: 'db_write_failed', message: scrub(errorText(e)) });
  }
  console.log(`fetch-rates: ${table.source} ${table.asOf}, валют: ${Object.keys(table.perUnit).length}, предупреждений: ${warnings.length}`);
  return jsonResponse(200, {
    ok: true,
    source: table.source,
    asOf: table.asOf,
    pivot: table.pivot,
    currencies: Object.keys(table.perUnit).length,
    hasTjs: Object.prototype.hasOwnProperty.call(table.perUnit, 'TJS'),
    warnings,
    excluded,
    failures,
  });
}

// В тестах (Node/Vitest) Deno нет — файл просто импортируется, сервер не стартует.
if (typeof Deno !== 'undefined') {
  Deno.serve((req: Request) => handler(req));
}
