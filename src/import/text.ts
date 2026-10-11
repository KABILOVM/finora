/**
 * Очистка текста из чужого файла. База и сервер не принимают нулевой символ и «одинокие» половинки суррогатных пар,
 * а переводы строк, табуляции и невидимые символы только портят заметки и названия.
 */

const INVISIBLE = '\\u00AD\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF';
const EDGE = new RegExp(`^[\\s${INVISIBLE}]+|[\\s${INVISIBLE}]+$`, 'g');
// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]+', 'g');

/** Убирает «одинокие» половинки суррогатных пар (обрезанные смайлики). Целые пары остаются. */
export function stripLoneSurrogates(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += s[i]! + s[i + 1]!;
        i++;
      }
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue;
    out += s[i]!;
  }
  return out;
}

/** Текст в одну строку: без управляющих и невидимых символов по краям, пробелы схлопнуты, NFC. */
export function sanitizeText(raw: string): string {
  let s = stripLoneSurrogates(raw).replace(CONTROL, ' ');
  s = s.normalize('NFC');
  s = s.replace(/[ \t\u00a0\u2000-\u200a\u202f\u205f\u3000]+/g, ' ');
  return s.replace(EDGE, '');
}

/** Обрезает до max знаков (по UTF-16, как считает база), не разрывая смайлик. mark — добавить «…» в конце. */
export function truncateText(s: string, max: number, mark: boolean): { text: string; cut: boolean } {
  if (s.length <= max) return { text: s, cut: false };
  let end = mark ? max - 1 : max;
  const last = s.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end--; // не оставляем «голову» пары без «хвоста»
  const head = s.slice(0, end).replace(EDGE, '');
  return { text: mark ? `${head}…` : head, cut: true };
}

/** Ключ для сравнения названий: без регистра и лишних пробелов («Нал» и «нал » — одно и то же). */
export function nameKey(name: string): string {
  return sanitizeText(name).toLocaleLowerCase('ru');
}
