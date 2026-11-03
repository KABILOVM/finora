// Сжимает разметку значков (svgo): меньше знаков после запятой, слияние путей. Вызывается из icon_packs.py:
//   node optimize-svg.cjs вход.json выход.json точность
// svgo ищется в NODE_PATH (icon_packs.py ставит его во временную папку).
// cleanupIds выключен: значки стоят на одной странице, и сжатые id («a», «b») у разных значков совпали бы.
const { optimize } = require('svgo');
const fs = require('node:fs');

const [, , input, output, precision] = process.argv;
const icons = JSON.parse(fs.readFileSync(input, 'utf8'));
const out = {};
for (const [name, svg] of Object.entries(icons)) {
  out[name] = optimize(svg, {
    multipass: true,
    floatPrecision: Number(precision || 1),
    plugins: [{ name: 'preset-default', params: { overrides: { removeViewBox: false, cleanupIds: false, mergePaths: false } } }],
  }).data;
}
fs.writeFileSync(output, JSON.stringify(out));
