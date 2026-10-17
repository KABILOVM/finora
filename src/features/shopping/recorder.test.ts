import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecorderError, policyBlocksMicrophone, recordingSupported, startRecorder } from './recorder';

class FakeRecorder {
  static types = ['audio/mp4'];
  static data = [new Blob(['abc'])];
  static isTypeSupported = (t: string) => FakeRecorder.types.includes(t);
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(
    public stream: unknown,
    opts?: { mimeType?: string },
  ) {
    this.mimeType = opts?.mimeType ?? '';
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    for (const data of FakeRecorder.data) this.ondataavailable?.({ data });
    queueMicrotask(() => this.onstop?.());
  }
}

const track = () => ({ stop: vi.fn() });
function mic(getUserMedia: () => Promise<unknown>, nav: Record<string, unknown> = {}) {
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia }, ...nav });
  vi.stubGlobal('MediaRecorder', FakeRecorder);
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeRecorder.types = ['audio/mp4'];
  FakeRecorder.data = [new Blob(['abc'])];
});

describe('запись голоса', () => {
  it('поддержка: нужны и микрофон, и MediaRecorder', () => {
    vi.stubGlobal('navigator', {});
    expect(recordingSupported()).toBe(false);
    mic(async () => ({}));
    expect(recordingSupported()).toBe(true);
  });

  it('браузер без записи — понятная ошибка', async () => {
    vi.stubGlobal('navigator', {});
    await expect(startRecorder(() => {})).rejects.toBeInstanceOf(RecorderError);
  });

  it.each([
    ['NotAllowedError', /Нет доступа к микрофону/],
    ['NotFoundError', /Микрофон не найден/],
    ['NotReadableError', /занят/],
    ['AbortError', /Не удалось включить/],
  ])('отказ %s → человеческий текст', async (name, text) => {
    mic(async () => {
      throw Object.assign(new Error('x'), { name });
    });
    await expect(startRecorder(() => {})).rejects.toThrow(text);
  });

  it.each([
    ['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 0, /Safari → Микрофон/],
    ['iPad (называет себя Mac)', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5, /Safari → Микрофон/],
    ['Android', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126.0 Mobile', 5, /настройках браузера/],
  ])('отказ в доступе на %s: подсказка про нужные настройки', async (_, userAgent, maxTouchPoints, hint) => {
    mic(
      async () => {
        throw Object.assign(new Error('x'), { name: 'NotAllowedError' });
      },
      { userAgent, maxTouchPoints },
    );
    const err = startRecorder(() => {});
    await expect(err).rejects.toThrow(/^Нет доступа к микрофону/);
    await expect(err).rejects.toThrow(hint);
  });

  it('микрофон запрещён заголовком сайта (Permissions-Policy): getUserMedia не зовём, текст честный, без совета про Safari', async () => {
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [track()] }));
    mic(getUserMedia, { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });
    Object.defineProperty(document, 'featurePolicy', { value: { allowsFeature: (f: string) => f !== 'microphone' }, configurable: true });
    try {
      expect(policyBlocksMicrophone()).toBe(true);
      await expect(startRecorder(() => {})).rejects.toThrow(new RecorderError('Микрофон отключён настройками сайта.'));
      expect(getUserMedia).not.toHaveBeenCalled();
    } finally {
      delete (document as unknown as { featurePolicy?: unknown }).featurePolicy;
    }
  });

  it('заголовок сайта разрешает микрофон (или браузер не говорит) — запись идёт как обычно', async () => {
    expect(policyBlocksMicrophone()).toBe(false);
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [track()] }));
    mic(getUserMedia);
    Object.defineProperty(document, 'permissionsPolicy', { value: { allowsFeature: (f: string) => f === 'microphone' }, configurable: true });
    try {
      expect(policyBlocksMicrophone()).toBe(false);
      const rec = await startRecorder(() => {});
      expect(getUserMedia).toHaveBeenCalledOnce();
      rec.cancel();
    } finally {
      delete (document as unknown as { permissionsPolicy?: unknown }).permissionsPolicy;
    }
  });

  it('пишет, останавливает, отпускает микрофон и отдаёт запись в формате iPhone (mp4)', async () => {
    const t = track();
    mic(async () => ({ getTracks: () => [t] }));
    const rec = await startRecorder(() => {});
    const r = await rec.stop();
    expect(r.mime).toBe('audio/mp4');
    expect(r.blob.size).toBe(3);
    expect(t.stop).toHaveBeenCalled();
  });

  it('если mp4 нет, берёт webm (Android, компьютер)', async () => {
    FakeRecorder.types = ['audio/webm;codecs=opus'];
    mic(async () => ({ getTracks: () => [track()] }));
    const rec = await startRecorder(() => {});
    expect((await rec.stop()).mime).toBe('audio/webm;codecs=opus');
  });

  it('пустая запись — ошибка, а не отправка пустого файла', async () => {
    FakeRecorder.data = [];
    const t = track();
    mic(async () => ({ getTracks: () => [t] }));
    const rec = await startRecorder(() => {});
    await expect(rec.stop()).rejects.toThrow(/Ничего не записалось/);
    expect(t.stop).toHaveBeenCalled();
  });

  it('отмена выключает микрофон и ничего не возвращает', async () => {
    const t = track();
    mic(async () => ({ getTracks: () => [t] }));
    const rec = await startRecorder(() => {});
    rec.cancel();
    expect(t.stop).toHaveBeenCalled();
    rec.cancel();
  });
});
