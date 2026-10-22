import { getDefaultClient } from '@/auth/supabaseClient';
import { normalizeAiReceipt, type ReceiptContext, type ReceiptDraft } from '@/features/receipt/receiptAi';
import { AiListError, invokeAi, toBase64, type Invoker } from '@/features/shopping/aiList';

export const PARSE_RECEIPT_FUNCTION = 'parse-receipt';

/** Длинная сторона фото после сжатия, пикселей: чек читается, а файл остаётся в несколько сотен килобайт. */
export const MAX_RECEIPT_EDGE = 1600;
/** Фото, которое нельзя сжать (браузер не умеет), отправляется как есть, но не больше этого. */
export const MAX_ORIGINAL_BYTES = 4_500_000;
const MIMES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

export interface PreparedImage {
  base64: string;
  mime: string;
}

/**
 * Готовит фото к отправке: уменьшает до MAX_RECEIPT_EDGE по длинной стороне и сохраняет JPEG (с учётом поворота снимка). Если браузер не
 * умеет (старый, нет createImageBitmap), отправляет оригинал — когда он подходит по типу и размеру.
 */
export async function prepareReceiptImage(file: Blob): Promise<PreparedImage> {
  try {
    if (typeof createImageBitmap === 'function' && typeof document !== 'undefined') {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const scale = Math.min(1, MAX_RECEIPT_EDGE / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bmp.width * scale));
      canvas.height = Math.max(1, Math.round(bmp.height * scale));
      const g = canvas.getContext('2d');
      if (g) {
        g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        bmp.close?.();
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
        if (blob) return { base64: await toBase64(blob), mime: 'image/jpeg' };
      }
    }
  } catch (e) {
    console.error('Фото чека не сжалось, пробуем отправить как есть:', e);
  }
  const mime = file.type.split(';')[0]!.trim().toLowerCase();
  if (!MIMES.includes(mime)) throw new AiListError('Это не фотография: выберите снимок чека (JPEG, PNG, WebP или HEIC).');
  if (file.size > MAX_ORIGINAL_BYTES) throw new AiListError('Фото слишком большое. Снимите чек ближе и без лишнего вокруг.');
  try {
    return { base64: await toBase64(file), mime };
  } catch {
    throw new AiListError('Не удалось прочитать фото. Повторите.');
  }
}

/** Что уходит на сервер: фото, названия категорий расходов и сегодняшняя дата (чтобы дополнить год). */
export async function parseReceiptWithAi(
  image: PreparedImage,
  ctx: ReceiptContext,
  firstRid = 1,
  client: Invoker | null = getDefaultClient(),
): Promise<ReceiptDraft> {
  const data = await invokeAi(client, PARSE_RECEIPT_FUNCTION, { image: image.base64, mime: image.mime, categories: ctx.categories.map((c) => c.name), today: ctx.today }, 'чека');
  return normalizeAiReceipt(data, ctx, firstRid);
}
