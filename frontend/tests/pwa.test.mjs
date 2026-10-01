import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manifestUrl = new URL('../public/manifest.webmanifest', import.meta.url);
const serviceWorkerUrl = new URL('../public/sw.js', import.meta.url);

test('PWA manifest declares a standalone app and an install icon', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));

  assert.equal(manifest.name, 'PlacePrep AI');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some((icon) => icon.src === '/icon.svg'));
});

test('service worker explicitly bypasses API requests', async () => {
  const source = await readFile(serviceWorkerUrl, 'utf8');

  assert.match(source, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(source, /request\.method !== 'GET'/);
});