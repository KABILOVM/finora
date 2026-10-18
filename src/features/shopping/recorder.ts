/**
 * Запись голоса с микрофона для «Добавить списком». Формат выбирает сам браузер: iPhone пишет audio/mp4 (AAC), Android и компьютер — audio/webm (Opus);
 * оба принимает серверная функция parse-shopping. Уровень громкости (0…1) идёт в onLevel — по нему рисуется анимация записи.
 */
export interface Recording {
  blob: Blob;
  mime: string;
}

export interface ActiveRecorder {
  /** Остановить и получить запись. */
  stop(): Promise<Recording>;
  /** Остановить и выбросить запись. Не бросает. */
  cancel(): void;
}

export type StartRecorder = (onLevel: (level: number) => void) => Promise<ActiveRecorder>;

/** Ошибка с понятным человеку текстом. */
export class RecorderError extends Error {}

const MIME_CANDIDATES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

export function recordingSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
}

/**
 * Запрещает ли настройка сайта (заголовок Permissions-Policy, `microphone=()`) микрофон самой странице. Тогда браузер откажет
 * без вопроса, и разрешение в настройках телефона не поможет. Где браузер не отвечает — не знаем, false.
 */
export function policyBlocksMicrophone(): boolean {
  try {
    const doc = document as Document & {
      permissionsPolicy?: { allowsFeature(name: string): boolean };
      featurePolicy?: { allowsFeature(name: string): boolean };
    };
    const policy = doc.permissionsPolicy ?? doc.featurePolicy;
    if (!policy || typeof policy.allowsFeature !== 'function') return false;
    return policy.allowsFeature('microphone') === false;
  } catch {
    return false;
  }
}

/** iPhone/iPad (iPadOS называет себя Mac, но у него сенсорный экран). */
function onIos(): boolean {
  const ua = navigator.userAgent ?? '';
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
}

/** Другой браузер или встроенное окно приложения на iPhone: у них свой переключатель «Микрофон» в настройках iOS, не у Safari. */
const OTHER_IOS_BROWSER = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|FBAN|FBAV|Instagram|Line\/|YaBrowser|Telegram/;

function describe(e: unknown): RecorderError {
  const name = (e as { name?: unknown } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return new RecorderError(
      !onIos()
        ? 'Нет доступа к микрофону. Разрешите его в настройках браузера для этого сайта и повторите.'
        : OTHER_IOS_BROWSER.test(navigator.userAgent ?? '')
          ? 'Нет доступа к микрофону. Разрешите его в настройках телефона (Настройки → ваш браузер → Микрофон) и повторите.'
          : 'Нет доступа к микрофону. Разрешите его в настройках телефона (Safari → Микрофон) и повторите.',
    );
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return new RecorderError('Микрофон не найден.');
  if (name === 'NotReadableError') return new RecorderError('Микрофон занят другим приложением.');
  return new RecorderError('Не удалось включить микрофон.');
}

export const startRecorder: StartRecorder = async (onLevel) => {
  if (!recordingSupported())
    throw new RecorderError('Этот браузер не умеет записывать голос. Наберите список текстом или нажмите значок микрофона на клавиатуре.');
  // Запрет заголовком сайта: getUserMedia не зовём, иначе человек получит совет про настройки телефона, который не поможет.
  if (policyBlocksMicrophone()) throw new RecorderError('Микрофон отключён настройками сайта.');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    throw describe(e);
  }
  const type = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported?.(m));
  let rec: MediaRecorder;
  try {
    rec = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw describe(e);
  }
  const chunks: Blob[] = [];
  rec.ondataavailable = (ev) => {
    if (ev.data.size > 0) chunks.push(ev.data);
  };

  // Громкость для анимации. Если AudioContext недоступен, запись всё равно идёт, просто уровень будет нулевым.
  let ctx: AudioContext | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctx) {
      ctx = new Ctx();
      void ctx.resume?.();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      timer = setInterval(() => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        onLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
      }, 70);
    }
  } catch {
    ctx = null;
  }

  const release = () => {
    if (timer) clearInterval(timer);
    timer = null;
    stream.getTracks().forEach((t) => t.stop());
    void ctx?.close?.().catch(() => {});
    ctx = null;
    onLevel(0);
  };
  const finished = new Promise<void>((resolve) => {
    rec.onstop = () => resolve();
  });
  try {
    rec.start();
  } catch (e) {
    release();
    throw describe(e);
  }

  return {
    async stop() {
      if (rec.state !== 'inactive') rec.stop();
      await finished;
      release();
      const mime = rec.mimeType || type || 'audio/mp4';
      const blob = new Blob(chunks, { type: mime });
      if (blob.size === 0) throw new RecorderError('Ничего не записалось. Повторите.');
      return { blob, mime };
    },
    cancel() {
      try {
        if (rec.state !== 'inactive') {
          rec.onstop = null;
          rec.stop();
        }
      } catch {
        /* уже остановлена */
      }
      release();
    },
  };
};
