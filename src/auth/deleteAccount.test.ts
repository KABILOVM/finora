import { describe, expect, it, vi } from 'vitest';
import { deleteAccountOnServer, DeleteAccountError } from './deleteAccount';

const clientWith = (res: unknown | (() => never)) => ({
  functions: { invoke: vi.fn(async () => (typeof res === 'function' ? (res as () => never)() : res)) },
});
const err = (status: number, name = 'FunctionsHttpError') => ({ data: null, error: { name, context: { status } } });

describe('deleteAccountOnServer', () => {
  it('ok: true — готово, на сервер уходит почта', async () => {
    const c = clientWith({ data: { ok: true }, error: null });
    await expect(deleteAccountOnServer('a@b.c', c as never)).resolves.toBeUndefined();
    expect(c.functions.invoke).toHaveBeenCalledWith('delete-account', { body: { confirmEmail: 'a@b.c' } });
  });

  it.each([
    [401, /Войдите в аккаунт заново/],
    [400, /Почта не совпала/],
    [404, /delete-account/],
    [500, /не настроено на сервере/],
    [502, /Ничего не удалено/],
  ])('статус %i — понятный текст, а не «ошибка»', async (status, text) => {
    await expect(deleteAccountOnServer('a@b.c', clientWith(err(status)) as never)).rejects.toThrow(text);
  });

  it('нет сети и неожиданный ответ — ошибка с текстом, ничего не удалено', async () => {
    await expect(deleteAccountOnServer('a@b.c', clientWith(err(0, 'FunctionsFetchError')) as never)).rejects.toThrow(/Нет связи/);
    await expect(deleteAccountOnServer('a@b.c', clientWith(() => { throw new Error('x'); }) as never)).rejects.toThrow(/Нет связи/);
    await expect(deleteAccountOnServer('a@b.c', clientWith({ data: { ok: false }, error: null }) as never)).rejects.toBeInstanceOf(DeleteAccountError);
  });

  it('без облака — понятное сообщение', async () => {
    await expect(deleteAccountOnServer('a@b.c', null)).rejects.toThrow(/облачном режиме/);
  });
});
