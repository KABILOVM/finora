import { describe, expect, it, vi } from 'vitest';
import { AiListError, listenToListWithAi, MAX_AUDIO_BYTES, parseListWithAi } from './aiList';

const client = (result: { data: unknown; error: unknown } | Error) => {
  const invoke = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  return { invoke, c: { functions: { invoke } } as never };
};
const httpError = (status: number) => ({ name: 'FunctionsHttpError', context: { status } });

describe('parseListWithAi', () => {
  it('без облака — понятный отказ', async () => {
    await expect(parseListWithAi('молоко', [], null)).rejects.toThrow(/после входа/);
  });

  it('шлёт текст и известные названия, возвращает приведённые позиции', async () => {
    const { invoke, c } = client({ data: { ok: true, items: [{ name: 'молоко', qty: 2, unit: 'l' }] }, error: null });
    await expect(parseListWithAi('  молоко два литра ', ['Хлеб'], c)).resolves.toEqual([{ name: 'Молоко', qtyMilli: 2000, unit: 'l' }]);
    expect(invoke).toHaveBeenCalledWith('parse-shopping', { body: { text: 'молоко два литра', known: ['Хлеб'] } });
  });

  it('пустой текст не уходит на сервер; слишком длинный — отказ', async () => {
    const { invoke, c } = client({ data: { ok: true, items: [] }, error: null });
    expect(await parseListWithAi('   ', [], c)).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
    await expect(parseListWithAi('а'.repeat(2001), [], c)).rejects.toThrow(/Слишком длинный/);
  });

  it.each([
    [401, /Войдите в аккаунт/],
    [404, /ещё не установлен/],
    [429, /Слишком часто/],
    [500, /не настроен/],
    [502, /Не получилось/],
  ])('ошибка сервера %i → понятный текст', async (status, text) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { c } = client({ data: null, error: httpError(status) });
    await expect(parseListWithAi('молоко', [], c)).rejects.toThrow(text);
  });

  it('нет сети (и сбой запроса, и FunctionsFetchError) → «Нет связи»', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(parseListWithAi('м', [], client({ data: null, error: { name: 'FunctionsFetchError' } }).c)).rejects.toThrow(/Нет связи/);
    await expect(parseListWithAi('м', [], client(new TypeError('Failed to fetch')).c)).rejects.toThrow(/Нет связи/);
  });

  it('ответ без ok:true — ошибка, а не пустой список', async () => {
    const { c } = client({ data: { ok: false }, error: null });
    await expect(parseListWithAi('м', [], c)).rejects.toBeInstanceOf(AiListError);
  });
});

describe('listenToListWithAi (голос)', () => {
  const rec = (size = 4, mime = 'audio/mp4') => ({ blob: new Blob([new Uint8Array(size)], { type: mime }), mime });

  it('шлёт запись в base64 с форматом и известными названиями, возвращает расшифровку и позиции', async () => {
    const { invoke, c } = client({
      data: { ok: true, items: [{ name: 'молоко', qty: 2, unit: 'l' }], transcript: ' молоко два литра ' },
      error: null,
    });
    const r = await listenToListWithAi(rec(), ['Хлеб'], c);
    expect(r).toEqual({ items: [{ name: 'Молоко', qtyMilli: 2000, unit: 'l' }], transcript: 'молоко два литра' });
    expect(invoke).toHaveBeenCalledWith('parse-shopping', { body: { audio: 'AAAAAA==', mime: 'audio/mp4', known: ['Хлеб'] } });
  });

  it('без облака и со слишком длинной записью — понятный отказ, на сервер ничего не уходит', async () => {
    await expect(listenToListWithAi(rec(), [], null)).rejects.toThrow(/после входа/);
    const { invoke, c } = client({ data: { ok: true, items: [] }, error: null });
    await expect(listenToListWithAi(rec(MAX_AUDIO_BYTES + 1), [], c)).rejects.toThrow(/слишком длинная/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('ошибка сервера превращается в понятный текст', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { c } = client({ data: null, error: httpError(429) });
    await expect(listenToListWithAi(rec(), [], c)).rejects.toThrow(/Слишком часто/);
  });
});
