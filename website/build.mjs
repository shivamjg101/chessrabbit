import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { guides } from './guides.mjs';

const source = fileURLToPath(new URL('.', import.meta.url));
const output = join(source, 'dist');
const defaultURL = 'https://shivamjg101.github.io/chessrabbit/';
const configuredURL = new URL(process.env.SITE_URL || defaultURL);
if (configuredURL.protocol !== 'https:' || configuredURL.search || configuredURL.hash || configuredURL.username || configuredURL.password) {
  throw new Error('SITE_URL must be a public HTTPS URL without credentials, a query, or a fragment.');
}
const base = configuredURL.href.replace(/\/?$/, '/');
const escape = text => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
await mkdir(join(output, 'assets'), { recursive: true });
const home = (await readFile(join(source, 'index.html'), 'utf8')).replaceAll(defaultURL, base);
await writeFile(join(output, 'index.html'), home);
for (const file of ['styles.css', 'site.js', '.nojekyll', 'assets/favicon.svg', 'assets/social.png']) {
  await copyFile(join(source, file), join(output, file));
}

// All board positions are fixed illustrative examples; no engine runs on this website.
const positions = [
  'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R',
  'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/2P2N2/PP1P1PPP/RNBQK2R',
];
positions.unshift('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R');
const glyphs = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
for (const [index, fen] of positions.entries()) {
  const squares = [...fen.replaceAll('/', '')].flatMap(c => /[1-8]/.test(c) ? Array(Number(c)).fill('') : [c]);
  const svg = squares.map((piece, i) => {
    const x = i % 8 * 60, y = Math.floor(i / 8) * 60;
    const dark = (i % 8 + Math.floor(i / 8)) % 2;
    const white = piece && piece === piece.toUpperCase();
    const selected = [[34, 61], [26, 5], [42, 50]][index].includes(i);
    const fill = selected ? (dark ? '#a8ad6a' : '#dce0a7') : dark ? '#80916a' : '#e9e9d5';
    let cell = `<rect x="${x}" y="${y}" width="60" height="60" fill="${fill}"/>`;
    if (piece) cell += `<text x="${x + 30}" y="${y + 46}" text-anchor="middle" font-family="Segoe UI Symbol,DejaVu Sans,Arial Unicode MS,serif" font-size="51" fill="${white ? '#fffdf0' : '#2d382c'}" stroke="${white ? '#4f5946' : '#1f281f'}" stroke-width="${white ? 1 : .35}" paint-order="stroke">${glyphs[piece.toLowerCase()]}</text>`;
    if (i % 8 === 0) cell += `<text x="${x + 4}" y="${y + 11}" font-family="Arial,sans-serif" font-size="9" fill="${dark ? '#f5f4e8' : '#5c6c4f'}">${8 - Math.floor(i / 8)}</text>`;
    if (i >= 56) cell += `<text x="${x + 52}" y="${y + 56}" font-family="Arial,sans-serif" font-size="9" fill="${dark ? '#f5f4e8' : '#5c6c4f'}">${'abcdefgh'[i % 8]}</text>`;
    return cell;
  }).join('');
  await writeFile(join(output, `assets/position-${index}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480">${svg}</svg>`);
}

const header = home.match(/<header[\s\S]*?<\/header>/)[0]
  .replace('href="./"', 'href="../"').replaceAll('src="assets/', 'src="../assets/').replaceAll('href="#', 'href="../#');
const footer = home.match(/<footer[\s\S]*?<\/footer>/)[0]
  .replace('href="./"', 'href="../"').replaceAll('src="assets/', 'src="../assets/');
for (const guide of guides) {
  const url = `${base}${guide.slug}/`;
  const schema = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Article', headline: guide.heading,
    description: guide.description, mainEntityOfPage: url, image: `${base}assets/social.png`,
    author: { '@type': 'Person', name: 'shivamjg101', url: 'https://github.com/shivamjg101' },
    publisher: { '@type': 'Organization', name: 'ChessRabbit', url: base } }).replaceAll('<', '\\u003c');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(guide.title)}</title><meta name="description" content="${escape(guide.description)}">
<link rel="canonical" href="${escape(url)}"><meta name="theme-color" content="#f8f7f3">
<meta property="og:type" content="article"><meta property="og:title" content="${escape(guide.heading)}"><meta property="og:description" content="${escape(guide.description)}"><meta property="og:url" content="${escape(url)}"><meta property="og:image" content="${escape(base)}assets/social.png"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="../assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="../styles.css">
<script type="application/ld+json">${schema}</script></head><body><a class="skip" href="#main">Skip to content</a>${header}
<main id="main" class="wrap"><article><div class="article-header"><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="../">ChessRabbit</a> / ${escape(guide.category.toLowerCase())}</nav><p class="eyebrow" style="margin-top:30px">THE CHESSRABBIT FIELD NOTES</p><h1>${escape(guide.heading)}</h1><p class="intro">${escape(guide.intro)}</p><p class="micro">By the ChessRabbit project · <a href="https://github.com/shivamjg101/chessrabbit">Source & documentation ↗</a></p></div>
<div class="article-body">${guide.body}<div class="callout"><h3>Put it into practice.</h3><p>ChessRabbit is free for Windows 10 and 11 on 64-bit Intel / AMD PCs. Stockfish is included.</p><a class="button" href="https://github.com/shivamjg101/chessrabbit/releases/download/desktop-v0.1.2/ChessRabbit-Setup.exe">↓ Download for Windows</a></div><aside class="related"><h2>Keep exploring.</h2><ul>${guides.filter(other => other !== guide).map(other => `<li><a href="../${other.slug}/">${escape(other.heading)}</a></li>`).join('')}</ul><a href="../#features">Explore ChessRabbit’s features →</a></aside></div></article></main>${footer}</body></html>`;
  await mkdir(join(output, guide.slug), { recursive: true });
  await writeFile(join(output, guide.slug, 'index.html'), html);
}
await writeFile(join(output, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['', ...guides.map(g => `${g.slug}/`)].map(route => `<url><loc>${escape(base + route)}</loc></url>`).join('')}</urlset>\n`);
await writeFile(join(output, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${base}sitemap.xml\n`);
await writeFile(join(output, '404.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Page not found | ChessRabbit</title><link rel="stylesheet" href="${escape(base)}styles.css"></head><body><main class="wrap article-header"><p class="eyebrow">404 / A DIFFERENT VARIATION</p><h1>This page is off the board.</h1><p class="intro">Let’s get you back to your next move.</p><p class="actions"><a class="button" href="${escape(base)}">Return to ChessRabbit</a></p></main></body></html>`);
console.log(`Built ${guides.length + 1} pages in ${output}\nPublic URL: ${base}`);
