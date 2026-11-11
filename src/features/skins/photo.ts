import type { PhotoSlot } from '@/customSkin';

/** До какого размера уменьшается фото: фон — по длинной стороне, карточка «Всего» — ровно 2:1 (обрезка по центру). */
const BG_MAX = 1600;
const HERO_W = 1200;
const HERO_H = 600;

/** Разбирает файл как картинку: современным способом, а где его нет — через <img>. */
async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; done: () => void }> {
  if (typeof createImageBitmap === 'function') {
    // imageOrientation: фото с телефона часто лежит «на боку» и повёрнуто пометкой в файле — учитываем её
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, done: () => bitmap.close() };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Картинка не разобрана'));
      img.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/**
 * Готовит фото к хранению: уменьшает и пересохраняет в JPEG. Так в хранилище браузера уходит 100–300 КБ, а не снимок камеры на 5 МБ,
 * и из файла пропадают служебные данные (место и время съёмки). Отклоняется, если файл — не картинка.
 */
export async function fitPhoto(file: File, slot: PhotoSlot): Promise<Blob> {
  const { source, width, height, done } = await decode(file);
  try {
    if (width < 1 || height < 1) throw new Error('Пустая картинка');
    const canvas = document.createElement('canvas');
    let sx = 0;
    let sy = 0;
    let sw = width;
    let sh = height;
    if (slot === 'hero') {
      // обрезаем по центру до 2:1
      const want = HERO_W / HERO_H;
      if (width / height > want) {
        sw = Math.round(height * want);
        sx = Math.round((width - sw) / 2);
      } else {
        sh = Math.round(width / want);
        sy = Math.round((height - sh) / 2);
      }
      canvas.width = Math.min(HERO_W, sw);
      canvas.height = Math.round(canvas.width / want);
    } else {
      const scale = Math.min(1, BG_MAX / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Холст недоступен');
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Фото не сохранилось'))), 'image/jpeg', 0.82));
  } finally {
    done();
  }
}
