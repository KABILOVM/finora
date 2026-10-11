import { MAX_PATH_LENGTH } from '../navigate';

/** Пути, которые обязаны проходить (то, что шлёт сервер: '/recurring', '/debts/<id>', '/'). */
export const GOOD_PATHS = ['/', '/recurring', '/debts/3f2b8c1e-aaaa-4bbb-8ccc-0123456789ab', '/transactions?x=1', '/settings/categories', "/a-b_c.d~e%20f@g!h$i&j'k(l)m*n+o,p;q=r"];
/** Вредные и странные адреса: все должны превращаться в '/'. */
export const BAD_PATHS: unknown[] = [
  '//evil.com',
  '//evil.com/path',
  '///x',
  'javascript:alert(1)',
  '/javascript:alert(1)',
  'https://evil.example/',
  'http://evil',
  '\\evil',
  '/\\evil',
  '/a\\b',
  '/path\nwith-newline',
  '/path\r',
  '/p\tq',
  '/a b',
  ' /leading-space',
  '/trail ',
  '/x#frag',
  '/кириллица',
  '/\u0000',
  '/‮',
  'relative/path',
  '',
  '#',
  '/' + 'a'.repeat(MAX_PATH_LENGTH),
  null,
  undefined,
  42,
  {},
  [],
  ['/ok'],
  true,
];
