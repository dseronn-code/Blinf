// Gera ícones e telas de abertura do app Android a partir dos ícones do PWA (public/icons)
const path = require('path');
const fs = require('fs');
const sharp = require(path.resolve(__dirname, '../../node_modules/sharp'));
const res = path.resolve(__dirname, '../android/app/src/main/res');
const icon = fs.readFileSync(path.resolve(__dirname, '../../public/icons/icon.svg'));
const maskable = fs.readFileSync(path.resolve(__dirname, '../../public/icons/icon-maskable.svg'));
const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

(async () => {
  for (const [d, s] of Object.entries(sizes)) {
    const dir = `${res}/mipmap-${d}`;
    await sharp(icon, { density: 384 }).resize(s, s).png().toFile(`${dir}/ic_launcher.png`);
    const r = Math.round(s / 2);
    const circle = Buffer.from(`<svg width="${s}" height="${s}"><circle cx="${r}" cy="${r}" r="${r}"/></svg>`);
    await sharp(maskable, { density: 384 }).resize(s, s).composite([{ input: circle, blend: 'dest-in' }]).png().toFile(`${dir}/ic_launcher_round.png`);
    // primeiro plano do ícone adaptativo (108dp, conteúdo nos 72dp centrais)
    const f = Math.round((s * 108) / 48);
    await sharp(maskable, { density: 384 }).resize(f, f).png().toFile(`${dir}/ic_launcher_foreground.png`);
  }
  // Tela de abertura: fundo verde com o logotipo ao centro
  const logo = await sharp(icon, { density: 384 }).resize(220, 220).png().toBuffer();
  for (const dir of fs.readdirSync(res).filter((x) => x.startsWith('drawable'))) {
    const file = `${res}/${dir}/splash.png`;
    if (!fs.existsSync(file)) continue;
    const { width, height } = await sharp(file).metadata();
    const size = Math.round(Math.min(width, height) * 0.28);
    const l = await sharp(logo).resize(size, size).toBuffer();
    await sharp({ create: { width, height, channels: 4, background: '#16a34a' } }).composite([{ input: l, gravity: 'center' }]).png().toFile(file + '.tmp');
    fs.renameSync(file + '.tmp', file);
  }
  // cor de fundo do ícone adaptativo
  const bg = `${res}/values/ic_launcher_background.xml`;
  if (fs.existsSync(bg)) fs.writeFileSync(bg, fs.readFileSync(bg, 'utf8').replace(/#[0-9A-Fa-f]{6}/, '#16A34A'));
  console.log('ícones e splash gerados');
})();
