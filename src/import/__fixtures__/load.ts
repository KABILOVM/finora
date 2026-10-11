import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeBytes } from '../decode';

/** Читает вымышленный образец из этой папки (тесты запускаются из корня проекта). */
export function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(process.cwd(), 'src', 'import', '__fixtures__', name)));
}

/** Текст образца так, как его прочитает приложение (BOM убран, кодировка определена). */
export function fixtureText(name: string): string {
  return decodeBytes(fixtureBytes(name)).text;
}
