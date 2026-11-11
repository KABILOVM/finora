// Рисунки нарисованных образов (scripts/skin-art/new-skins.json): картинка на карточку «Всего» и значок для витрины.
// Запуск из корня репозитория: node scripts/skin-art/gen_scenes.mjs [образ …]   (без имён — все образы)
//   node scripts/skin-art/gen_scenes.mjs --sheet лист.png   — вместо файлов образов собрать один лист для просмотра
//
// Каждая сцена — векторный рисунок (SVG) на холсте 640×320, нарисованный здесь же, без материалов со стороны: поэтому у новых клубных
// образов нет гербов и фото, только цвета формы и свои рисунки. Рисунок стоит в правой нижней части холста (как «вырезы» у остальных
// образов, см. build.py): слева и сверху остаётся место под текст карточки. Браузер (Chromium из Playwright) рисует SVG на холсте и
// отдаёт webp:
//   src/assets/skins/art/<образ>-hero.webp   640×320, прозрачный фон
//   src/assets/skins/art/<образ>-thumb.webp  112×112, рисунок на фоне цвета карточки образа
// Цвета фона значка берутся из палитры образа (python3 scripts/skin-art/gen_new_skins.py --palettes).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(ROOT, 'src', 'assets', 'skins', 'art');
const SPEC = JSON.parse(readFileSync(join(HERE, 'new-skins.json'), 'utf8')).skins;
const PALETTES = JSON.parse(execFileSync('python3', [join(HERE, 'gen_new_skins.py'), '--palettes'], { encoding: 'utf8' }));

const W = 640;
const H = 320;

/* ───────────── помощники ───────────── */

const range = (n) => Array.from({ length: n }, (_, i) => i);
/** Пятиконечная звезда с центром (x, y) и радиусом r. */
const star = (x, y, r, fill, extra = '') => {
  const pts = range(10)
    .map((i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const k = i % 2 === 0 ? r : r * 0.42;
      return `${(x + Math.cos(a) * k).toFixed(1)},${(y + Math.sin(a) * k).toFixed(1)}`;
    })
    .join(' ');
  return `<polygon points="${pts}" fill="${fill}" ${extra}/>`;
};
/** Четырёхлучевая искра. */
const spark = (x, y, r, fill, o = 1) => `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="${fill}" opacity="${o}"/>`;
const dots = (list, fill, o = 1) => list.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" opacity="${o}"/>`).join('');

/* ───────────── сцены ───────────── */

const MOTIFS = {
  // Океан: солнце, дальние волны и большой гребень с пеной
  wave: (c) => `
    <circle cx="566" cy="112" r="34" fill="#ffe7a3" opacity=".92"/>
    <circle cx="566" cy="112" r="48" fill="#ffe7a3" opacity=".22"/>
    <path d="M352 262C392 222 430 226 462 252C494 278 528 274 560 246C592 220 622 226 640 238V320H352Z" fill="${c.s}" opacity=".55"/>
    <path d="M404 320C404 232 470 168 548 176C596 181 622 214 618 246C610 222 588 208 566 214C540 221 530 250 544 270C560 292 600 292 640 276V320Z" fill="${c.p}"/>
    <path d="M404 320C404 232 470 168 548 176C596 181 622 214 618 246C606 208 566 190 528 204C478 222 450 268 446 320Z" fill="#fff" opacity=".2"/>
    ${dots([[552, 178, 9], [574, 184, 8], [594, 196, 7], [610, 212, 6], [618, 230, 5], [532, 182, 7], [514, 190, 5]], '#fff', 0.95)}
    <path d="M372 300C410 282 440 284 470 298C500 312 540 312 580 298C606 290 626 292 640 296V320H372Z" fill="${c.l}" opacity=".75"/>`,

  // Лес: луна, холмы и ели в три ряда
  pines: (c) => {
    const tree = (x, base, h, fill) => {
      const w = h * 0.46;
      return `<rect x="${x - 3}" y="${base - 10}" width="6" height="14" fill="#5b3a1e"/>
        <polygon points="${x},${base - h} ${x - w * 0.55},${base - h * 0.55} ${x + w * 0.55},${base - h * 0.55}" fill="${fill}"/>
        <polygon points="${x},${base - h * 0.78} ${x - w * 0.78},${base - h * 0.28} ${x + w * 0.78},${base - h * 0.28}" fill="${fill}"/>
        <polygon points="${x},${base - h * 0.5} ${x - w},${base - 6} ${x + w},${base - 6}" fill="${fill}"/>`;
    };
    return `
    <circle cx="582" cy="104" r="26" fill="#f4f1d0" opacity=".95"/>
    <circle cx="592" cy="98" r="22" fill="${c.hero}" opacity=".35"/>
    <path d="M360 300C420 250 470 262 520 280C560 294 600 276 640 262V320H360Z" fill="#12381f" opacity=".85"/>
    ${tree(600, 286, 96, '#1c5a32')}${tree(548, 292, 124, '#237040')}${tree(470, 300, 100, '#1c5a32')}
    ${tree(508, 310, 150, '#2d8a50')}${tree(424, 312, 118, '#237040')}${tree(590, 314, 132, '#2d8a50')}
    ${dots([[450, 150, 2.5], [520, 120, 2], [608, 172, 2.5], [404, 196, 2]], c.l, 0.9)}`;
  },

  // Сакура: ветка с цветами и падающие лепестки
  blossom: () => {
    const flower = (x, y, r, fill = '#ffc2d6') =>
      range(5)
        .map((i) => {
          const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
          return `<circle cx="${(x + Math.cos(a) * r).toFixed(1)}" cy="${(y + Math.sin(a) * r).toFixed(1)}" r="${(r * 0.82).toFixed(1)}" fill="${fill}"/>`;
        })
        .join('') + `<circle cx="${x}" cy="${y}" r="${(r * 0.5).toFixed(1)}" fill="#ffe08a"/>`;
    return `
    <path d="M640 104C588 118 536 136 492 186C468 214 444 244 396 262" fill="none" stroke="#6b3f2a" stroke-width="8" stroke-linecap="round"/>
    <path d="M540 144C552 178 580 204 628 216M486 194C476 164 450 146 418 142" fill="none" stroke="#6b3f2a" stroke-width="5" stroke-linecap="round"/>
    ${flower(598, 116, 13)}${flower(538, 142, 15, '#ffd3e0')}${flower(486, 194, 14)}${flower(442, 232, 12, '#ffd3e0')}
    ${flower(604, 208, 13, '#ffb3cc')}${flower(430, 146, 12, '#ffb3cc')}${flower(566, 186, 9)}${flower(404, 258, 9)}
    ${[[430, 282, 20], [480, 258, -30], [536, 250, 40], [588, 270, -15], [612, 296, 25], [520, 296, -40], [466, 300, 10]]
      .map(([x, y, a]) => `<ellipse cx="${x}" cy="${y}" rx="8" ry="4.5" fill="#ffc2d6" opacity=".9" transform="rotate(${a} ${x} ${y})"/>`)
      .join('')}`;
  },

  // Северное сияние: ленты света, звёзды и горы со снежными шапками
  aurora: () => `
    <defs>
      <linearGradient id="a1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6ef0c2" stop-opacity=".95"/><stop offset="1" stop-color="#6ef0c2" stop-opacity="0"/></linearGradient>
      <linearGradient id="a2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8f7bff" stop-opacity=".9"/><stop offset="1" stop-color="#8f7bff" stop-opacity="0"/></linearGradient>
      <filter id="ab" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"/></filter>
      <linearGradient id="af" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000"/><stop offset=".3" stop-color="#fff"/></linearGradient>
      <mask id="am" maskUnits="userSpaceOnUse" x="340" y="30" width="300" height="230"><rect x="340" y="30" width="300" height="230" fill="url(#af)"/></mask>
    </defs>
    <g filter="url(#ab)" mask="url(#am)">
      <path d="M372 92C420 70 452 112 498 96C544 80 574 60 640 84V214C580 190 548 220 500 226C452 232 420 200 372 222Z" fill="url(#a1)"/>
      <path d="M408 70C452 96 492 60 540 84C580 104 610 92 640 70V176C604 196 574 176 536 190C492 206 452 176 408 196Z" fill="url(#a2)" opacity=".8"/>
    </g>
    ${dots([[392, 76, 1.8], [446, 58, 1.5], [520, 66, 2], [586, 54, 1.6], [626, 104, 1.8], [470, 120, 1.4], [560, 128, 1.6]], '#fff', 0.95)}
    <polygon points="352,320 430,214 482,270 540,196 640,320" fill="#10203f"/>
    <polygon points="430,214 414,236 428,230 438,244 450,232 446,232" fill="#e8f1ff"/>
    <polygon points="540,196 520,222 536,214 548,232 562,216 558,218" fill="#e8f1ff"/>
    <polygon points="452,320 560,238 640,300 640,320" fill="#0a1630"/>
    <polygon points="560,238 546,256 560,250 570,262 580,252" fill="#cfe0f7"/>`,

  // Пустыня: солнце, дюны и кактус
  dunes: () => `
    <circle cx="560" cy="150" r="50" fill="#ffb24d"/>
    <circle cx="560" cy="150" r="66" fill="#ffb24d" opacity=".22"/>
    <path d="M352 268C420 216 480 226 540 250C580 266 612 258 640 244V320H352Z" fill="#e3ad62"/>
    <path d="M388 320C440 262 520 252 580 280C606 292 626 290 640 284V320Z" fill="#c9853a"/>
    <path d="M352 320C400 290 440 286 484 300C520 312 560 314 600 306L640 320Z" fill="#a8642a"/>
    <g fill="#2f7d4b">
      <rect x="436" y="186" width="20" height="92" rx="10"/>
      <path d="M436 232h-12a10 10 0 0 1-10-10v-18a8 8 0 0 1 16 0v12h6zM456 246h12a10 10 0 0 0 10-10v-22a8 8 0 0 0-16 0v16h-6z"/>
    </g>
    <path d="M446 192v80" stroke="#8fd3a4" stroke-width="2" opacity=".6"/>`,

  // Космос: планета с кольцом, спутник и звёзды
  planet: (c) => `
    <defs>
      <linearGradient id="pl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b79bff"/><stop offset=".55" stop-color="${c.p}"/><stop offset="1" stop-color="#23104f"/></linearGradient>
      <clipPath id="pc"><circle cx="528" cy="196" r="62"/></clipPath>
    </defs>
    <ellipse cx="528" cy="196" rx="104" ry="24" fill="none" stroke="${c.l}" stroke-width="7" opacity=".55" transform="rotate(-18 528 196)"/>
    <circle cx="528" cy="196" r="62" fill="url(#pl)"/>
    <g clip-path="url(#pc)" opacity=".35" fill="#fff">
      <rect x="450" y="166" width="170" height="9" transform="rotate(-18 528 196)"/>
      <rect x="450" y="196" width="170" height="14" transform="rotate(-18 528 196)"/>
      <rect x="450" y="228" width="170" height="6" transform="rotate(-18 528 196)"/>
    </g>
    <path d="M428.4 228.3A104 24 -18 0 0 627.6 163.7" fill="none" stroke="${c.l}" stroke-width="7" stroke-linecap="round"/>
    <circle cx="430" cy="110" r="15" fill="#ded6ff"/><circle cx="436" cy="106" r="4" fill="#b7a8f0"/><circle cx="425" cy="116" r="3" fill="#b7a8f0"/>
    ${spark(600, 96, 11, '#fff')}${spark(470, 276, 8, c.l)}${spark(392, 190, 7, '#fff', 0.8)}
    ${dots([[560, 76, 2], [618, 150, 1.8], [400, 264, 1.6], [488, 92, 1.6], [606, 286, 2]], '#fff', 0.9)}`,

  // Рамазан: полумесяц со звездой, фонари и силуэт мечети
  crescent: () => {
    const lantern = (x, top) => `
      <path d="M${x} 0V${top}" stroke="#f0c75a" stroke-width="2"/>
      <path d="M${x - 5} ${top}h10l3 8h-16z" fill="#c8962a"/>
      <path d="M${x - 13} ${top + 8}h26l5 22-5 22h-26l-5-22z" fill="#f0c75a"/>
      <path d="M${x - 7} ${top + 13}h14l3 17-3 17h-14l-3-17z" fill="#fff3c4"/>
      <path d="M${x - 9} ${top + 52}h18l-4 8h-10z" fill="#c8962a"/>
      <circle cx="${x}" cy="${top + 66}" r="3" fill="#f0c75a"/>`;
    return `
    <defs><mask id="cm"><rect width="${W}" height="${H}" fill="#fff"/><circle cx="574" cy="150" r="50"/></mask></defs>
    <circle cx="548" cy="162" r="64" fill="#f0c75a" mask="url(#cm)"/>
    ${star(586, 150, 15, '#f8dc86')}
    ${lantern(424, 62)}${lantern(476, 104)}
    <path d="M352 320V296h20v-18h8v18h30c0-22 16-38 34-40c18 2 34 18 34 40h44v-30h8v30h30c0-14 10-24 22-26c12 2 22 12 22 26h56v24z" fill="#0b1e44"/>
    ${dots([[400, 150, 1.8], [612, 92, 1.8], [516, 70, 1.6], [620, 232, 1.6]], '#fff', 0.9)}`;
  },

  // Курбан: рассвет, мечеть с куполом и минаретами
  mosque: (c) => `
    <circle cx="512" cy="258" r="92" fill="#f0c75a" opacity=".3"/>
    <circle cx="512" cy="258" r="62" fill="#f0c75a" opacity=".4"/>
    <g fill="${c.hero}">
      <rect x="396" y="150" width="18" height="160"/><path d="M392 150h26l-13-30z"/>
      <rect x="610" y="150" width="18" height="160"/><path d="M606 150h26l-13-30z"/>
      <path d="M446 226c0-42 30-70 66-78c36 8 66 36 66 78z"/>
      <rect x="430" y="224" width="164" height="86"/>
    </g>
    <g fill="#e8c766">
      <rect x="392" y="196" width="26" height="6"/><rect x="606" y="196" width="26" height="6"/>
      <rect x="430" y="222" width="164" height="6"/>
      <path d="M510 148v-22h4v22z"/><path d="M512 106a11 11 0 1 0 9 17a8.5 8.5 0 1 1-9-17z"/>
      <path d="M405 120v-12"/><circle cx="405" cy="112" r="4"/><circle cx="619" cy="112" r="4"/>
    </g>
    <path d="M492 310v-40a20 20 0 0 1 40 0v40z" fill="#f4dc8e"/>
    <g fill="#f4dc8e" opacity=".9">${[448, 470, 554, 576].map((x) => `<path d="M${x - 7} 284v-20a7 7 0 0 1 14 0v20z"/>`).join('')}</g>
    ${star(452, 112, 9, '#e8c766')}${star(574, 96, 7, '#e8c766')}`,

  // День независимости: три волнистые полосы, корона и семь звёзд
  flag: () => {
    const band = (a, b, fill) => `<path d="M388 ${a}C448 ${a - 18} 512 ${a + 18} 632 ${a}V${b}C512 ${b + 18} 448 ${b - 18} 388 ${b}Z" fill="${fill}"/>`;
    const stars = range(7)
      .map((i) => {
        const a = (-158 + i * (136 / 6)) * (Math.PI / 180);
        return star(510 + Math.cos(a) * 44, 202 + Math.sin(a) * 40, 5.5, '#f8c300');
      })
      .join('');
    return `
    <rect x="380" y="92" width="7" height="216" rx="3.5" fill="#d9c7a0"/><circle cx="383.5" cy="90" r="7" fill="#f8c300"/>
    ${band(108, 156, '#cf1230')}${band(156, 232, '#ffffff')}${band(232, 280, '#12863f')}
    <path d="M488 214l5-20 9 12 8-18 8 18 9-12 5 20z" fill="#f8c300"/><rect x="488" y="214" width="44" height="6" rx="2" fill="#f8c300"/>
    ${stars}`;
  },

  // 8 марта: тюльпаны, ветка мимозы и восьмёрка
  bouquet: () => {
    const tulip = (x, y, fill, shade) => `
      <path d="M${x} ${y + 44}C${x - 22} ${y + 36} ${x - 26} ${y + 8} ${x - 18} ${y - 14}L${x - 8} ${y + 2}L${x} ${y - 18}L${x + 8} ${y + 2}L${x + 18} ${y - 14}C${x + 26} ${y + 8} ${x + 22} ${y + 36} ${x} ${y + 44}Z" fill="${fill}"/>
      <path d="M${x} ${y + 44}C${x - 8} ${y + 30} ${x - 8} ${y + 6} ${x} ${y - 18}C${x + 8} ${y + 6} ${x + 8} ${y + 30} ${x} ${y + 44}Z" fill="${shade}"/>`;
    return `
    <g fill="none" stroke="#2f8a4a" stroke-width="6" stroke-linecap="round">
      <path d="M474 190C482 240 500 276 520 306M532 168C530 220 526 266 522 306M590 196C570 240 544 276 524 306"/>
    </g>
    <path d="M500 270C470 262 452 240 450 214C476 220 494 240 500 270ZM546 270C576 258 592 236 592 210C566 220 550 242 546 270Z" fill="#3fa35e"/>
    ${tulip(474, 150, '#f472b6', '#db2777')}${tulip(532, 126, '#ef4444', '#b91c1c')}${tulip(590, 156, '#a855f7', '#7e22ce')}
    <path d="M620 300C616 250 604 220 584 204" fill="none" stroke="#2f8a4a" stroke-width="4" stroke-linecap="round"/>
    ${dots([[612, 232, 8], [626, 252, 7], [600, 250, 6], [616, 272, 7], [630, 284, 6], [604, 286, 5], [596, 220, 6]], '#ffd84d')}
    <path d="M506 296l-22 18M538 296l22 18" stroke="#ffd84d" stroke-width="7" stroke-linecap="round"/><circle cx="522" cy="298" r="9" fill="#ffd84d"/>
    <g fill="none" stroke="#ffd84d" stroke-width="8"><circle cx="412" cy="150" r="15"/><circle cx="412" cy="188" r="20"/></g>`;
  },

  // День рождения: торт со свечами, шары и конфетти
  cake: () => `
    <g stroke="#fff" stroke-width="1.5" opacity=".7" fill="none"><path d="M560 196C556 172 566 160 562 142M598 206C600 180 592 170 600 150M628 190C624 170 632 160 628 140"/></g>
    <ellipse cx="562" cy="112" rx="24" ry="30" fill="#8b5cf6"/><ellipse cx="600" cy="120" rx="22" ry="28" fill="#f472b6"/><ellipse cx="628" cy="108" rx="18" ry="24" fill="#ffcb3d"/>
    <ellipse cx="554" cy="102" rx="6" ry="10" fill="#fff" opacity=".35"/><ellipse cx="593" cy="110" rx="5" ry="9" fill="#fff" opacity=".35"/>
    <ellipse cx="470" cy="304" rx="96" ry="10" fill="#fff" opacity=".85"/>
    <rect x="392" y="232" width="156" height="68" rx="14" fill="#f9a8d4"/>
    <path d="M392 246c14 0 14 16 26 16s12-16 26-16s14 16 26 16s12-16 26-16s14 16 26 16s12-16 26-16v-6a14 14 0 0 0-14-14H406a14 14 0 0 0-14 14z" fill="#fff7ed"/>
    <rect x="418" y="186" width="104" height="46" rx="12" fill="#c4b5fd"/>
    <path d="M418 198c10 0 10 12 21 12s10-12 21-12s10 12 21 12s10-12 21-12s10 12 20 12v-12a12 12 0 0 0-12-12H430a12 12 0 0 0-12 12z" fill="#fff7ed"/>
    ${[442, 470, 498].map((x) => `<rect x="${x - 3}" y="160" width="6" height="26" rx="2" fill="#ffcb3d"/><path d="M${x} 142c6 8 6 14 0 18c-6-4-6-10 0-18z" fill="#fb923c"/>`).join('')}
    ${[[400, 150, '#ffcb3d', 20], [384, 196, '#f472b6', -30], [540, 170, '#34d399', 40], [366, 250, '#8b5cf6', 10], [424, 124, '#34d399', -20], [596, 250, '#ffcb3d', 30], [620, 286, '#f472b6', -10]]
      .map(([x, y, f, a]) => `<rect x="${x - 5}" y="${y - 2.5}" width="10" height="5" rx="1.5" fill="${f}" transform="rotate(${a} ${x} ${y})"/>`)
      .join('')}`,

  // Футбольная форма цветов клуба и мяч (без герба: только цвета и рисунок полос)
  kit: (c, s) => {
    const k = s.kit;
    const body = 'M452 116L404 134L372 196L410 214L424 190V306H596V190L610 214L648 196L616 134L568 116Q510 148 452 116Z';
    const sleeves = 'M452 116L404 134L372 196L410 214L424 190V150ZM568 116L616 134L648 196L610 214L596 190V150Z';
    let deco = '';
    if (k.kind === 'stripes') deco = range(5).map((i) => `<rect x="${441 + i * 34.5}" y="100" width="17.2" height="220" fill="${k.band}"/>`).join('');
    else if (k.kind === 'band') deco = `<rect x="482" y="100" width="56" height="220" fill="#fff"/><rect x="490" y="100" width="40" height="220" fill="${k.band}"/>`;
    else if (k.kind === 'hoop') deco = `<rect x="400" y="196" width="220" height="34" fill="${k.band}"/>`;
    else if (k.kind === 'chest') deco = `<rect x="400" y="176" width="220" height="16" fill="${k.band}"/><rect x="400" y="198" width="220" height="10" fill="${k.trim}"/>`;
    else if (k.kind === 'sash') deco = `<path d="M424 150L470 116L596 250V306H570Z" fill="${k.band}"/>`;
    else if (k.kind === 'diamonds')
      deco = range(8)
        .map((i) => `<path d="M${424 + i * 24} 200l12-14 12 14-12 14z" fill="${i % 2 === 0 ? '#fff' : k.band}"/>`)
        .join('');
    return `<g transform="translate(-18 0)">
    <defs><clipPath id="kb"><path d="${body}"/></clipPath></defs>
    <path d="${body}" fill="${k.body}"/>
    <g clip-path="url(#kb)">${deco}<path d="${sleeves}" fill="${k.sleeve}"/>
      <path d="M372 196l38 18M648 196l-38 18" stroke="${k.trim}" stroke-width="9"/>
      <rect x="424" y="296" width="172" height="10" fill="${k.trim}" opacity=".9"/>
      <path d="M424 150V306M596 150V306" stroke="#000" stroke-width="3" opacity=".12"/>
    </g>
    <path d="M452 116Q510 148 568 116" fill="none" stroke="${k.trim}" stroke-width="${k.kind === 'collar' ? 13 : 8}" stroke-linecap="round"/>
    ${star(546, 170, 9, k.trim === '#ffffff' ? '#f5d76e' : k.trim)}
    <path d="${body}" fill="none" stroke="#000" stroke-width="2" opacity=".2"/>
    <circle cx="414" cy="278" r="32" fill="#fff"/>
    <g fill="#1d1d22"><polygon points="414,262 428,272 423,289 405,289 400,272"/>
      <polygon points="414,246 426,252 421,260 407,260 402,252"/><polygon points="442,268 446,282 438,290 431,284 433,272"/>
      <polygon points="386,268 395,272 397,284 390,290 382,282"/><polygon points="398,304 406,296 422,296 430,304 414,310"/></g>
    <circle cx="414" cy="278" r="32" fill="none" stroke="#1d1d22" stroke-width="2.5"/></g>`;
  },

  // Бокс: пара перчаток на шнурках и канаты ринга
  gloves: () => {
    const glove = (x, y, a) => `
      <g transform="rotate(${a} ${x} ${y})">
        <path d="M${x} 0V${y - 60}" stroke="#e7d9b8" stroke-width="3"/>
        <rect x="${x - 26}" y="${y - 62}" width="52" height="30" rx="6" fill="#2a2a2e"/>
        <rect x="${x - 26}" y="${y - 50}" width="52" height="6" fill="#d9a431"/>
        <path d="M${x - 40} ${y - 6}a40 44 0 0 0 80 0v-14a26 22 0 0 0-26-22h-28a26 22 0 0 0-26 22z" fill="#c62828"/>
        <ellipse cx="${x - 40}" cy="${y - 2}" rx="15" ry="24" fill="#a51c1c"/>
        <path d="M${x - 8} ${y - 28}c22-6 34 6 36 22" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".35"/>
      </g>`;
    return `
    ${glove(468, 190, -10)}${glove(566, 214, 9)}
    <g stroke="#f4f1ea" stroke-width="5" opacity=".9"><path d="M352 276H640M352 296H640"/></g>
    <path d="M352 286H640" stroke="#c62828" stroke-width="5"/>
    <rect x="616" y="252" width="16" height="68" rx="3" fill="#d9a431"/>`;
  },

  // Баскетбол: щит с кольцом и мяч
  hoop: () => `
    <rect x="484" y="72" width="140" height="92" rx="8" fill="#fff" opacity=".92"/>
    <rect x="484" y="72" width="140" height="92" rx="8" fill="none" stroke="#2b2f36" stroke-width="5"/>
    <rect x="530" y="108" width="48" height="36" fill="none" stroke="#e8590c" stroke-width="5"/>
    <ellipse cx="554" cy="170" rx="36" ry="9" fill="none" stroke="#e8590c" stroke-width="7"/>
    <g fill="none" stroke="#fff" stroke-width="2.2" opacity=".85">
      <path d="M520 172l10 54M538 178l6 48M554 180v46M570 178l-6 48M588 172l-10 54M524 196c20 8 40 8 60 0M528 214c18 6 34 6 52 0"/>
    </g>
    <circle cx="436" cy="246" r="52" fill="#f08a24"/>
    <g fill="none" stroke="#2b2f36" stroke-width="3.5">
      <circle cx="436" cy="246" r="52"/><path d="M384 246h104M436 194v104M400 208c22 22 22 54 0 76M472 208c-22 22-22 54 0 76"/>
    </g>
    <ellipse cx="418" cy="222" rx="14" ry="9" fill="#fff" opacity=".28" transform="rotate(-30 418 222)"/>`,

  // Зал: гантель и гиря
  dumbbell: () => `
    <g transform="rotate(-22 500 190)">
      <rect x="430" y="180" width="140" height="20" rx="4" fill="#9ca3af"/>
      <rect x="402" y="146" width="26" height="88" rx="6" fill="#3f3f46"/><rect x="380" y="158" width="20" height="64" rx="5" fill="#27272a"/>
      <rect x="572" y="146" width="26" height="88" rx="6" fill="#3f3f46"/><rect x="600" y="158" width="20" height="64" rx="5" fill="#27272a"/>
      <rect x="402" y="184" width="26" height="12" fill="#a3e635"/><rect x="572" y="184" width="26" height="12" fill="#a3e635"/>
    </g>
    <path d="M560 252c-10-26 8-44 30-44s40 18 30 44" fill="none" stroke="#3f3f46" stroke-width="11" stroke-linecap="round"/>
    <path d="M546 300a46 40 0 1 1 88 0z" fill="#27272a"/>
    <rect x="546" y="296" width="88" height="12" rx="4" fill="#3f3f46"/>
    <path d="M572 268a24 20 0 0 1 36 0" fill="none" stroke="#a3e635" stroke-width="5" stroke-linecap="round"/>`,

  // Чёрная карта: две карты, чип, бесконтактная оплата и блик
  card: () => `
    <defs>
      <linearGradient id="cg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a3a42"/><stop offset=".5" stop-color="#17171b"/><stop offset="1" stop-color="#050506"/></linearGradient>
      <clipPath id="cc"><rect x="392" y="118" width="232" height="146" rx="16"/></clipPath>
    </defs>
    <rect x="412" y="134" width="222" height="140" rx="16" fill="#9a9aa6" opacity=".5" transform="rotate(9 523 204)"/>
    <g transform="rotate(-8 508 191)">
      <rect x="392" y="118" width="232" height="146" rx="16" fill="url(#cg)"/>
      <g clip-path="url(#cc)"><path d="M470 100L520 100L440 290L390 290Z" fill="#fff" opacity=".1"/><path d="M560 100L580 100L500 290L480 290Z" fill="#fff" opacity=".07"/></g>
      <rect x="392" y="118" width="232" height="146" rx="16" fill="none" stroke="#c0c0c8" stroke-width="1.5" opacity=".7"/>
      <rect x="414" y="156" width="42" height="32" rx="6" fill="#d9b55a"/>
      <path d="M414 167h42M414 177h42M428 156v32M442 156v32" stroke="#8f6f25" stroke-width="1.4"/>
      <g fill="none" stroke="#c0c0c8" stroke-width="3" stroke-linecap="round"><path d="M574 160a14 14 0 0 1 0 22M584 153a24 24 0 0 1 0 36M594 146a34 34 0 0 1 0 50"/></g>
      ${range(4)
        .map((g) => range(4).map((i) => `<circle cx="${418 + g * 50 + i * 9}" cy="224" r="3" fill="#d4d4dc"/>`).join(''))
        .join('')}
      <rect x="414" y="240" width="70" height="6" rx="3" fill="#8e8e99"/>
    </g>`,

  // Мрамор: колонна, лавровая ветвь и прожилки
  column: () => `
    <g fill="#f3f1ea">
      <rect x="494" y="92" width="112" height="14" rx="3"/><rect x="504" y="106" width="92" height="12" rx="3"/>
      <rect x="512" y="118" width="76" height="156"/>
      <rect x="502" y="274" width="96" height="14" rx="3"/><rect x="490" y="288" width="120" height="16" rx="3"/>
    </g>
    <circle cx="502" cy="100" r="9" fill="#e5e1d6"/><circle cx="598" cy="100" r="9" fill="#e5e1d6"/>
    <g stroke="#cfc9ba" stroke-width="3"><path d="M527 122v148M542 122v148M558 122v148M573 122v148"/></g>
    <g fill="none" stroke="#9aa39c" stroke-width="1.6" opacity=".8"><path d="M514 150c20 10 26 30 50 34s20 30 24 50M512 230c16-6 30 4 40 20"/></g>
    <g fill="none" stroke="#c9a85c" stroke-width="3.5" stroke-linecap="round"><path d="M470 296C424 262 412 200 438 150"/></g>
    <g fill="#c9a85c">${[[432, 168, -50], [424, 194, -30], [424, 222, -10], [432, 248, 12], [446, 272, 34]]
      .map(([x, y, a]) => `<ellipse cx="${x - 12}" cy="${y}" rx="14" ry="6" transform="rotate(${a} ${x - 12} ${y})"/><ellipse cx="${x + 12}" cy="${y - 4}" rx="13" ry="5.5" transform="rotate(${a + 70} ${x + 12} ${y - 4})"/>`)
      .join('')}</g>`,

  // Биржа: японские свечи и линия роста
  candles: () => {
    const data = [
      [392, 250, 30, 1], [420, 236, 44, 0], [448, 244, 28, 1], [476, 214, 50, 1], [504, 222, 34, 0], [532, 188, 56, 1], [560, 196, 30, 0], [588, 156, 62, 1], [616, 132, 48, 1],
    ];
    return `
    <g stroke="#fff" stroke-width="1" opacity=".14"><path d="M372 120H640M372 170H640M372 220H640M372 270H640"/></g>
    ${data
      .map(([x, y, h, up]) => {
        const f = up ? '#2bd67b' : '#f0535b';
        return `<rect x="${x - 1}" y="${y - 16}" width="2" height="${h + 32}" fill="${f}"/><rect x="${x - 8}" y="${y}" width="16" height="${h}" rx="2" fill="${f}"/>`;
      })
      .join('')}
    <path d="M384 286L436 262L484 248L540 214L596 176L628 126" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>
    <path d="M628 126l-18 4 12 12z" fill="#fff" opacity=".9"/>`;
  },
};

// Золото: три слитка пирамидой (два внизу, один сверху) и стопка монет
MOTIFS.bars = () => {
  const bar = (x, y) => `
    <path d="M${x} ${y + 26}l14-26h92l14 26z" fill="#f4d470"/>
    <path d="M${x} ${y + 26}h120l-8 34H${x + 8}z" fill="#d9a520"/>
    <path d="M${x + 14} ${y}h92l-4 7H${x + 18}z" fill="#fff3bf" opacity=".85"/>
    <rect x="${x + 38}" y="${y + 37}" width="44" height="11" rx="3" fill="#b7860f" opacity=".7"/>`;
  const coin = (y) => `<ellipse cx="420" cy="${y}" rx="38" ry="11" fill="#e9bf3f"/><path d="M382 ${y}v9a38 11 0 0 0 76 0v-9" fill="#c8961c"/>`;
  return `
    ${bar(458, 244)}${bar(514, 244)}${bar(486, 186)}
    ${coin(300)}${coin(288)}${coin(276)}
    <ellipse cx="420" cy="264" rx="38" ry="11" fill="#f6dc7a"/><ellipse cx="420" cy="264" rx="26" ry="7" fill="none" stroke="#c8961c" stroke-width="2"/>
    ${spark(606, 170, 12, '#fff3bf')}${spark(452, 200, 8, '#fff3bf')}${spark(624, 236, 7, '#fff')}`;
};

/** Полный SVG сцены образа. */
function sceneSvg(s) {
  const pal = PALETTES[s.id];
  const c = { p: s.primary, s: s.secondary, l: s.line, hero: pal['hero-l'], brand: pal['brand-l'] };
  const draw = MOTIFS[s.motif];
  if (!draw) throw new Error(`Нет рисунка «${s.motif}» для образа ${s.id}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${draw(c, s)}</svg>`;
}

/** Значок «Классики (прежней)»: прежняя карточка «Всего» — фиолетовый градиент с двумя кругами и капсулами. */
const LEGACY_THUMB = `<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112" viewBox="0 0 112 112">
  <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f46e5"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs>
  <rect width="112" height="112" fill="url(#lg)"/>
  <circle cx="92" cy="14" r="44" fill="#fff" opacity=".16"/><circle cx="66" cy="112" r="34" fill="#fff" opacity=".12"/>
  <rect x="14" y="34" width="56" height="12" rx="6" fill="#fff"/><rect x="14" y="58" width="34" height="14" rx="7" fill="#fff" opacity=".3"/><rect x="54" y="58" width="40" height="14" rx="7" fill="#fff" opacity=".3"/>
  <path d="M10 96c18 0 20-14 34-14s22 6 58-6" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".7"/>
</svg>`;

/* ───────────── отрисовка в браузере ───────────── */

const require = createRequire(import.meta.url);
const { chromium } = require(existsSync(join(ROOT, 'node_modules', '@playwright', 'test')) ? '@playwright/test' : 'playwright');
const CHROMIUM = process.env.PW_CHROMIUM_PATH ?? ['/opt/pw-browsers/chromium'].find((p) => existsSync(p));

const args = process.argv.slice(2);
const sheetAt = args.indexOf('--sheet');
const sheetFile = sheetAt >= 0 ? args[sheetAt + 1] : null;
const only = args.filter((a, i) => !a.startsWith('--') && i !== sheetAt + 1);
const list = SPEC.filter((s) => only.length === 0 || only.includes(s.id));

const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
const page = await browser.newPage();
await page.setContent('<canvas id="c"></canvas>');

/** Рисует SVG на холсте заданного размера (с фоном-градиентом или без) и возвращает webp или png в base64. */
const render = (svg, opts) =>
  page.evaluate(
    async ({ svg, w, h, bg, crop, type, quality }) => {
      const img = new Image();
      await new Promise((ok, fail) => {
        img.onload = ok;
        img.onerror = () => fail(new Error('SVG не разобран'));
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      });
      const canvas = document.getElementById('c');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, w, h);
      if (bg) {
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, bg[0]);
        g.addColorStop(1, bg[1]);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      if (crop) ctx.drawImage(img, crop[0], crop[1], crop[2], crop[3], 0, 0, w, h);
      else ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL(type, quality).split(',')[1];
    },
    { type: 'image/webp', quality: 0.9, ...opts, svg },
  );

if (sheetFile) {
  // Лист для просмотра: каждая сцена на градиенте своей карточки, подписана id
  const cols = 5;
  const rows = Math.ceil(list.length / cols);
  const cells = [];
  for (const s of list) cells.push({ id: s.id, data: await render(sceneSvg(s), { w: 320, h: 160, bg: [PALETTES[s.id]['brand-l'], PALETTES[s.id]['hero-l']], type: 'image/png' }) });
  const sheet = await page.evaluate(
    async ({ cells, cols, rows }) => {
      const canvas = document.getElementById('c');
      canvas.width = cols * 330;
      canvas.height = rows * 186;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#f4f4f7';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = '13px sans-serif';
      for (const [i, cell] of cells.entries()) {
        const img = new Image();
        await new Promise((ok) => {
          img.onload = ok;
          img.src = 'data:image/png;base64,' + cell.data;
        });
        const x = (i % cols) * 330 + 5;
        const y = Math.floor(i / cols) * 186 + 5;
        ctx.drawImage(img, x, y);
        ctx.fillStyle = '#111';
        ctx.fillText(cell.id, x + 4, y + 176);
      }
      return canvas.toDataURL('image/png').split(',')[1];
    },
    { cells, cols, rows },
  );
  writeFileSync(sheetFile, Buffer.from(sheet, 'base64'));
  console.log(`Лист: ${sheetFile} (${list.length} сцен)`);
} else {
  for (const s of list) {
    const svg = sceneSvg(s);
    const pal = PALETTES[s.id];
    let quality = 0.9;
    let hero = Buffer.from(await render(svg, { w: W, h: H, quality }), 'base64');
    while (hero.length > 44 * 1024 && quality > 0.4) {
      quality -= 0.1;
      hero = Buffer.from(await render(svg, { w: W, h: H, quality }), 'base64');
    }
    writeFileSync(join(OUT, `${s.id}-hero.webp`), hero);
    // значок: правая часть сцены (где рисунок) на фоне цвета карточки образа
    const thumb = Buffer.from(await render(svg, { w: 112, h: 112, bg: [pal['brand-l'], pal['hero-l']], crop: [356, 52, 284, 284 - 16], quality: 0.86 }), 'base64');
    writeFileSync(join(OUT, `${s.id}-thumb.webp`), thumb);
    console.log(`${s.id.padEnd(14)} hero ${(hero.length / 1024).toFixed(1)} КБ, значок ${(thumb.length / 1024).toFixed(1)} КБ`);
  }
  if (only.length === 0) {
    const legacy = Buffer.from(await render(LEGACY_THUMB, { w: 112, h: 112, quality: 0.9 }), 'base64');
    writeFileSync(join(OUT, 'legacy-thumb.webp'), legacy);
    console.log(`legacy         значок ${(legacy.length / 1024).toFixed(1)} КБ`);
  }
}
await browser.close();
