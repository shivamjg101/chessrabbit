import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./dist/', import.meta.url));
const allFiles = await readdir(root, { recursive: true });
const pages = allFiles.filter(file => file.endsWith('index.html'));
assert.equal(pages.length, 5, 'Expected the homepage, product facts, and three guides');
const titles = new Set(), descriptions = new Set(), canonicals = new Set();
for (const file of pages) {
  const absolute = join(root, file);
  const html = await readFile(absolute, 'utf8');
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1, `${file}: exactly one H1`);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /name="viewport"/);
  assert.doesNotMatch(html, /noindex|localhost|TODO|PLACEHOLDER/);
  const title = html.match(/<title>(.*?)<\/title>/)[1];
  const description = html.match(/name="description" content="([^"]+)"/)[1];
  const canonical = html.match(/rel="canonical" href="([^"]+)"/)[1];
  assert(canonical.startsWith('https://') && canonical.endsWith('/'));
  titles.add(title); descriptions.add(description); canonicals.add(canonical);
  const schema = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(schema['@context'], 'https://schema.org');
  assert.equal(schema.url || schema.mainEntityOfPage, canonical);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size, `${file}: duplicate IDs`);
  for (const [, reference] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (/^(https?:|mailto:|data:)/.test(reference)) continue;
    const [pathname, anchor] = reference.split('#');
    let target = pathname ? resolve(dirname(absolute), decodeURIComponent(pathname)) : absolute;
    assert(target.startsWith(resolve(root)), `${file}: link leaves site: ${reference}`);
    if ((await stat(target)).isDirectory()) target = join(target, 'index.html');
    await stat(target);
    if (anchor) {
      const destination = await readFile(target, 'utf8');
      assert(destination.includes(`id="${anchor}"`), `${file}: missing anchor ${reference}`);
    }
  }
  for (const [image] of html.matchAll(/<img\b[^>]*>/g)) assert.match(image, /\balt="[^"]*"/);
}
assert.equal(titles.size, pages.length, 'Titles must be unique');
assert.equal(descriptions.size, pages.length, 'Descriptions must be unique');
assert.equal(canonicals.size, pages.length, 'Canonicals must be unique');
const sitemap = await readFile(join(root, 'sitemap.xml'), 'utf8');
const locations = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);
assert.deepEqual(new Set(locations), canonicals);
const robots = await readFile(join(root, 'robots.txt'), 'utf8');
assert(robots.includes(`Sitemap: ${locations[0]}sitemap.xml`));
const home = await readFile(join(root, 'index.html'), 'utf8');
const product = JSON.parse(await readFile(join(root, 'product.json'), 'utf8'));
assert.deepEqual(product, JSON.parse(home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]));
assert.equal(product['@id'], `${locations[0]}#software`);
assert.equal(product.subjectOf.url, `${locations[0]}about/`);
assert.equal(product.isAccessibleForFree, true);
assert.match(product.description, /prerelease/);
const facts = await readFile(join(root, 'about/index.html'), 'utf8');
assert.match(facts, /0\.1\.2/);
assert.match(facts, /prerelease/);
assert.match(facts, /href="\.\.\/product.json"/);
const key = (await readFile(new URL('./indexnow-key.txt', import.meta.url), 'utf8')).trim();
assert.match(key, /^[a-f0-9]{32}$/);
assert.equal(await readFile(join(root, `${key}.txt`), 'utf8'), key);
const social = await readFile(join(root, 'assets/social.png'));
assert.equal(social.subarray(1, 4).toString(), 'PNG');
assert.equal(social.readUInt32BE(16), 1200);
assert.equal(social.readUInt32BE(20), 630);
for (let index = 0; index < 3; index++) {
  const svg = await readFile(join(root, `assets/position-${index}.svg`), 'utf8');
  assert.equal((svg.match(/<rect /g) || []).length, 64);
  assert.equal((svg.match(/paint-order=/g) || []).length, 32);
}
console.log(`PASS: ${pages.length} pages; metadata; product JSON parity; structured data; links and anchors; sitemap; IndexNow key; social image; example boards.`);
