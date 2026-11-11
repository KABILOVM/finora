import { describe, expect, it } from 'vitest';
import { HOME_MAX_CHARS, HOME_MAX_ITEMS, parseHome, readHome, stringifyHome } from './homeLayout';

describe('раскладка «Главной»: чтение и запись', () => {
  it('читает блоки по порядку: скрытые и ширина остаются при блоке', () => {
    const text = '{"v":1,"items":[{"id":"hero"},{"id":"rates","size":"half"},{"id":"weather","off":true},{"id":"debts","off":true,"size":"full"}]}';
    expect(parseHome(text)).toEqual([{ id: 'hero' }, { id: 'rates', size: 'half' }, { id: 'weather', off: true }, { id: 'debts', off: true, size: 'full' }]);
  });

  it('канонический текст: порядок ключей один, лишние поля отброшены, повторная запись ничего не меняет', () => {
    const loose = JSON.stringify({ items: [{ size: 'half', off: true, id: 'rates', extra: 1 }], v: 1 });
    const canon = stringifyHome(parseHome(loose)!);
    expect(canon).toBe('{"v":1,"items":[{"id":"rates","off":true,"size":"half"}]}');
    expect(stringifyHome(parseHome(canon)!)).toBe(canon);
  });

  it('незнакомый блок (от более нового приложения) — не ошибка: он остаётся в записи', () => {
    expect(parseHome('{"v":1,"items":[{"id":"hero"},{"id":"future-block"}]}')).toEqual([{ id: 'hero' }, { id: 'future-block' }]);
  });

  it('нет записи — null; непонятная запись читается мягко как null', () => {
    expect(parseHome(null)).toBeNull();
    expect(parseHome(undefined)).toBeNull();
    expect(parseHome('{"v":2,"items":[{"id":"hero"}]}')).toBeNull();
    expect(parseHome('мусор')).toBeNull();
  });

  it.each([
    ['не текст', 5, 'ожидался текст'],
    ['не JSON', '{', 'это не JSON'],
    ['null вместо объекта', 'null', 'неизвестная версия записи'],
    ['другая версия', '{"v":2,"items":[{"id":"hero"}]}', 'неизвестная версия записи'],
    ['items не список', '{"v":1,"items":{}}', 'блоков должно быть'],
    ['пустой список', '{"v":1,"items":[]}', 'блоков должно быть'],
    ['блок — не объект', '{"v":1,"items":["hero"]}', 'некорректный идентификатор'],
    ['идентификатор с заглавной', '{"v":1,"items":[{"id":"Hero"}]}', 'некорректный идентификатор'],
    ['идентификатор длиннее 24 знаков', `{"v":1,"items":[{"id":"${'a'.repeat(25)}"}]}`, 'некорректный идентификатор'],
    ['повтор', '{"v":1,"items":[{"id":"hero"},{"id":"hero"}]}', 'блоки повторяются'],
    ['off не true', '{"v":1,"items":[{"id":"hero","off":false}]}', 'скрыт'],
    ['неизвестная ширина', '{"v":1,"items":[{"id":"hero","size":"third"}]}', 'некорректная ширина'],
  ])('отвергает: %s', (_n, text, error) => {
    const r = readHome(text);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.error).toContain(error);
  });

  it('границы: не больше 48 блоков и не длиннее 4000 знаков', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `b${i}` }));
    expect(parseHome(stringifyHome(many(HOME_MAX_ITEMS)))).toHaveLength(HOME_MAX_ITEMS);
    expect(() => stringifyHome(many(HOME_MAX_ITEMS + 1))).toThrow(RangeError);
    expect(readHome(' '.repeat(HOME_MAX_CHARS + 1))).toEqual({ ok: false, error: `длиннее ${HOME_MAX_CHARS} знаков` });
    // самая длинная допустимая запись помещается в серверный предел
    const longest = Array.from({ length: HOME_MAX_ITEMS }, (_, i) => ({ id: `${'x'.repeat(22)}${String(i).padStart(2, '0')}`, off: true as const, size: 'half' as const }));
    expect(stringifyHome(longest).length).toBeLessThanOrEqual(HOME_MAX_CHARS);
  });

  it('stringifyHome не пропускает мусор', () => {
    expect(() => stringifyHome([])).toThrow(/Главная/);
    expect(() => stringifyHome([{ id: 'hero' }, { id: 'hero' }])).toThrow(/повторяются/);
    expect(() => stringifyHome([{ id: 'hero', size: 'big' as never }])).toThrow(/ширина/);
  });
});
