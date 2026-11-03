import type { IconPackId } from './registry';

/** Кто нарисовал набор и на каких условиях (для «О приложении» и README). У наборов с лицензией CC BY ссылка на авторов обязательна. */
export const ICON_PACK_CREDITS: Readonly<Record<IconPackId, { title: string; author: string; license: string }>> = {
  'wi-anime': { title: 'with icons Anime', author: 'Evergrow', license: 'MIT' },
  'wi-brutal': { title: 'with icons Brutal', author: 'Evergrow', license: 'MIT' },
  'wi-kawaii': { title: 'with icons Kawaii', author: 'Evergrow', license: 'MIT' },
  'wi-luxe': { title: 'with icons Luxe', author: 'Evergrow', license: 'MIT' },
  'wi-coquette': { title: 'with icons Coquette', author: 'Evergrow', license: 'MIT' },
  'wi-gothic': { title: 'with icons Gothic', author: 'Evergrow', license: 'MIT' },
  'wi-clay': { title: 'with icons Clay', author: 'Evergrow', license: 'MIT' },
  'wi-liquid': { title: 'with icons Liquid', author: 'Evergrow', license: 'MIT' },
  'wi-chrome': { title: 'with icons Chrome', author: 'Evergrow', license: 'MIT' },
  pixelarticons: { title: 'Pixelarticons', author: 'Gerrit Halfmann', license: 'MIT' },
  'sl-cyber': { title: 'Streamline Cyber', author: 'Streamline', license: 'CC BY 4.0' },
  'ph-fill': { title: 'Phosphor', author: 'Phosphor Icons', license: 'MIT' },
};

/** Одной строкой для «Настроек» (внизу страницы): у наборов с лицензией CC BY ссылка на авторов обязательна. Тест следит, чтобы здесь были все наборы. */
export const PACK_CREDITS_TEXT = 'with icons Anime, Brutal, Kawaii, Luxe, Coquette, Gothic, Clay, Liquid, Chrome (Evergrow, MIT), Pixelarticons (Gerrit Halfmann, MIT), Phosphor (MIT), Streamline Cyber (Streamline, CC BY 4.0)';
