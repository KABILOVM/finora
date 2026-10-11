import { ImportFileError } from './types';

export type Encoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1251';

export interface Decoded {
  text: string;
  encoding: Encoding;
}

const NOT_TEXT =
  'Это не текстовый файл. Выгрузите операции именно в формате CSV (не Excel и не архив) и выберите этот файл.';

function isBinary(bytes: Uint8Array): boolean {
  // zip-архив (в том числе Excel .xlsx) начинается с «PK»; в обычном тексте нулевых байтов не бывает
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return true;
  const n = Math.min(bytes.length, 4096);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

/**
 * Байты файла → текст. Порядок: метка порядка байтов (BOM) UTF-8 / UTF-16; иначе строгий UTF-8;
 * если байты не похожи на UTF-8 (так выглядит старая русская кодировка Windows-1251 из Excel) — Windows-1251.
 * Ничего не угадываем молча: бинарный файл отвергается понятным текстом.
 */
export function decodeBytes(bytes: Uint8Array): Decoded {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
  }
  if (isBinary(bytes)) throw new ImportFileError(NOT_TEXT);
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    // не UTF-8
  }
  try {
    return { text: new TextDecoder('windows-1251').decode(bytes), encoding: 'windows-1251' };
  } catch {
    throw new ImportFileError('Не удалось определить кодировку файла. Сохраните его в кодировке UTF-8 и попробуйте ещё раз.');
  }
}
