/*
 * Иконки таджикских банков и сервисов (Эсхата, Амонатбонк, Tcell, Somon…) для значков категорий и кошельков.
 * Иконки — готовые картинки (обычно значок приложения из Google Play), а не векторы, поэтому лежат файлами в public/tj/<id>.png:
 * они попадают в офлайн-кэш приложения вместе со всем остальным, без интернета работают.
 *
 * Как добавить иконку:
 *   1. Положите квадратный PNG в public/tj/ под именем из списка TJ ниже (например, eskhata.png). Значок приложения из Play — 512×512, подходит.
 *   2. npm i --no-save sharp && node scripts/gen-tj-services.cjs
 *      Скрипт проверяет файлы (PNG, квадрат, не мельче 96 px), сам уменьшает большие до 192 px (достаточно для экранов 3×),
 *      жмёт до ≤ 40 КБ и пишет src/components/tjData.ts — только про сервисы, у которых есть файл. Нет файла — сервиса в выборе нет.
 *   3. Закоммитьте public/tj/*.png и src/components/tjData.ts.
 * Чтобы добавить новый банк или сервис: допишите строку в TJ и положите файл. id — a-z и 0-9, до 30 символов («s:id» влезает в поле icon).
 * Названия и значки — товарные знаки их владельцев; в приложении они нужны только чтобы узнать банк или сервис.
 * Параметры для проверок: --dir <папка с PNG> --out <куда писать tjData.ts>.
 */
const fs = require('fs');
const path = require('path');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const DIR = arg('--dir', 'public/tj');
const OUT = arg('--out', 'src/components/tjData.ts');

const SIDE = 192; // сторона готовой иконки, px
const MIN_SIDE = 96;
const MAX_BYTES = 40_000;

// Группы — в том порядке, в каком они показаны в выборе значка (раньше остальных сервисов).
const GROUPS = [
  ['tjbank', 'Банки Таджикистана'],
  ['tjpay', 'Сервисы Таджикистана'],
];

/*
 * [id, название, группа, слова для подсказки значка по названию категории]
 * Слова — в нижнем регистре, целым словом или парой слов («душанбе сити»); id и название ищутся сами.
 * Список можно держать щедрым: сервисы без файла просто не показываются.
 * Значки взяты у главных приложений в Google Play (название приложения — в комментарии справа).
 */
const TJ = [
  ['alifbank', 'Алиф', 'tjbank', ['alif', 'алиф банк', 'alif mobi', 'алиф моби']], // Alif: платежи и переводы (tj.alif.mobi)
  ['dcbank', 'Душанбе Сити Банк', 'tjbank', ['dc', 'dc next', 'душанбе сити']], // DC Next (tj.dc.next1)
  ['eskhata', 'Эсхата', 'tjbank', ['eskhata', 'эсхата банк', 'эсхата онлайн']], // Эсхата Онлайн (com.eskhata.online)
  ['amonatbonk', 'Амонатбонк', 'tjbank', ['амонатбанк', 'amonatbank', 'амонат']], // Амонат мобайл (tj.itservice.amonatbonk)
  ['orienbank', 'Ориёнбонк', 'tjbank', ['ориёнбанк', 'ориенбанк', 'oriyonbonk', 'oriyon']], // Oriyon 24 (tj.oriyonbonk)
  ['spitamen', 'Спитамен Банк', 'tjbank', ['спитамен']], // Spitamen Pay (com.bank.spitamen.pay.spitamenpay)
  ['ssb', 'Саноатсодиротбонк', 'tjbank', ['ссб', 'ssb', 'sanoatsodirotbonk']], // ССБ Мобайл (tj.itservice.ssb)
  ['arvand', 'Банк Арванд', 'tjbank', ['арванд']], // Арванд (tj.itservice.arvand)
  ['imon', 'Имон Интернешнл', 'tjbank', []], // IMONLINE (tj.imcon.wallet.imon.prod)
  ['ibt', 'Международный банк Таджикистана', 'tjbank', ['ibt']], // IBT 24 (tj.ibt.app)
  ['matin', 'Матин', 'tjbank', []], // Матин (tj.itservice.matin)
  ['cbt', 'Коммерцбанк Таджикистана', 'tjbank', ['коммерцбанк', 'favri']], // Favri (tj.itservice.cbt)
  ['icb', 'Инвестиционно-кредитный банк Таджикистана', 'tjbank', ['icb', 'икб']], // ICB Mobile (tj.fmfb.mobile)
  ['dbt', 'Бонки рушд', 'tjbank', ['банк развития']], // Бонки рушд, Банк развития Таджикистана (tj.dbt.pay)
  ['freedom', 'Freedom Bank', 'tjbank', []], // Freedom Tajikistan (tj.freedombank.app)
  ['humo', 'Хумо', 'tjbank', ['humo']], // Humo Online (tj.humo.online)
  ['tcell', 'Tcell', 'tjpay', ['тселл', 'тсел']], // Мой Tcell (tj.tcell.odp)
  ['megafontj', 'МегаФон Таджикистан', 'tjpay', ['мегафон', 'megafon']], // в Google Play для Таджикистана приложения нет: файл кладут вручную
  ['babilon', 'Babilon-M', 'tjpay', ['вавилон', 'бабилон']], // MyBabilon (com.babilon.mybabilon)
  ['zetmobile', 'Zet-Mobile', 'tjpay', ['zet', 'зет']], // ZET-MOBILE (com.zet.ZET_MOBILE_app)
  ['tojiktelecom', 'Таджиктелеком', 'tjpay', ['tojiktelecom']], // Tojiktelecom (tj.ttl.mytelecom)
  ['oson', 'OSON', 'tjpay', ['осон']], // OSON: Денежные переводы (com.intervale.ibt)
  ['somon', 'Somon.tj', 'tjpay', ['somon', 'сомон']], // Somon Объявления (tj.somon.somontj)
  ['somonair', 'Somon Air', 'tjpay', ['сомон эйр']], // Somon Air (com.somonair.app)
  ['andozi', 'Андози ман', 'tjpay', ['andozi', 'андози']], // Андози ман, налоговая (tj.tax.my_tax)
];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Размер PNG из заголовка IHDR (без внешних пакетов). */
function pngSize(buf, name) {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`${name}: это не PNG (нужен настоящий PNG, а не переименованный файл другого вида)`);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

async function main() {
  const ids = new Set();
  for (const [id, , group] of TJ) {
    if (!/^[a-z0-9]{1,30}$/.test(id)) throw new Error(`id «${id}»: только a-z и 0-9, до 30 символов`);
    if (ids.has(id)) throw new Error(`повтор id «${id}»`);
    ids.add(id);
    if (!GROUPS.some(([g]) => g === group)) throw new Error(`${id}: нет группы «${group}»`);
  }

  const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => !f.startsWith('.')) : [];
  const stray = files.filter((f) => !/\.png$/.test(f) || !ids.has(f.replace(/\.png$/, '')));
  if (stray.length > 0) {
    throw new Error(`в ${DIR} лишние файлы: ${stray.join(', ')}. Нужны только <id>.png из списка TJ (id маленькими латинскими буквами и цифрами).`);
  }

  let sharp = null;
  const found = [];
  for (const [id, name, group, keys] of TJ) {
    const file = path.join(DIR, `${id}.png`);
    if (!fs.existsSync(file)) {
      console.log(`  нет файла: ${id}.png (${name})`);
      continue;
    }
    let buf = fs.readFileSync(file);
    const { w, h } = pngSize(buf, `${id}.png`);
    if (Math.abs(w - h) > 2) throw new Error(`${id}.png: ${w}×${h} — иконка должна быть квадратной`);
    if (Math.min(w, h) < MIN_SIDE) throw new Error(`${id}.png: ${w}×${h} — слишком мелкая, нужно не меньше ${MIN_SIDE}×${MIN_SIDE}`);
    if (w > SIDE || buf.length > MAX_BYTES) {
      try {
        sharp = sharp ?? require('sharp');
      } catch {
        throw new Error(`${id}.png: ${w}×${h}, ${Math.round(buf.length / 1000)} КБ — нужно уменьшить до ${SIDE}×${SIDE}. Поставьте: npm i --no-save sharp — и запустите скрипт снова.`);
      }
      buf = await sharp(buf)
        .resize(Math.min(w, SIDE), Math.min(h, SIDE), { fit: 'cover' })
        .png({ palette: true, quality: 90, compressionLevel: 9, effort: 10 })
        .toBuffer();
      fs.writeFileSync(file, buf);
      console.log(`  ужато: ${id}.png → ${Math.min(w, SIDE)}×${Math.min(h, SIDE)}, ${Math.round(buf.length / 1000)} КБ`);
    }
    if (buf.length > MAX_BYTES) throw new Error(`${id}.png: ${Math.round(buf.length / 1000)} КБ даже после сжатия (предел ${MAX_BYTES / 1000} КБ): слишком детальная картинка`);
    found.push({ id, name, group, color: '#ffffff', img: `tj/${id}.png`, ...(keys.length ? { keys } : {}) });
    console.log(`  ok: ${id}.png (${name})`);
  }

  const text =
`/* Файл создан скриптом scripts/gen-tj-services.cjs — руками не править.
 * Таджикские банки и сервисы, у которых есть иконка в public/tj/<id>.png (значок приложения). Названия и значки — товарные знаки их владельцев. */
import type { ServiceMeta } from './serviceData';

export const TJ_GROUPS: readonly { id: string; label: string }[] = ${JSON.stringify(GROUPS.map(([id, label]) => ({ id, label })))};

export const TJ_SERVICES: readonly ServiceMeta[] = [
${found.map((m) => `  ${JSON.stringify(m)},`).join('\n')}
];
`;
  fs.writeFileSync(OUT, text);
  console.log(`${found.length} из ${TJ.length} иконок подключено → ${OUT}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
