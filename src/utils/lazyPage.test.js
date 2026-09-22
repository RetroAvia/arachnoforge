import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isChunkLoadError, lazyPage } from './lazyPage.js';

test('isChunkLoadError riconosce i download falliti dei vari browser', () => {
  assert.ok(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/Campus-abc.js')));
  assert.ok(isChunkLoadError(new TypeError('Importing a module script failed.'))); // Safari
  assert.ok(isChunkLoadError(new TypeError('error loading dynamically imported module: https://x/a.js'))); // Firefox
  assert.ok(isChunkLoadError(new Error('Unable to preload CSS for /assets/index.css'))); // Vite
  assert.ok(isChunkLoadError(Object.assign(new Error('x'), { name: 'ChunkLoadError' })));
  assert.ok(isChunkLoadError(Object.assign(new Error('x'), { chunkLoadFailed: true })));
});

test('isChunkLoadError non scambia un bug per un download fallito', () => {
  assert.equal(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'label')")), false);
  assert.equal(isChunkLoadError(null), false);
  assert.equal(isChunkLoadError(undefined), false);
});

test('lazyPage: preload scarica una volta sola e condivide il download', async () => {
  let chiamate = 0;
  const Pagina = lazyPage(() => {
    chiamate += 1;
    return Promise.resolve({ default: () => null });
  });
  assert.equal(typeof Pagina.preload, 'function');
  assert.equal(await Pagina.preload(), true);
  assert.equal(await Pagina.preload(), true);
  assert.equal(chiamate, 1);
});

test('lazyPage: un preload fallito non resta memorizzato e non lancia', async () => {
  let chiamate = 0;
  const Pagina = lazyPage(() => {
    chiamate += 1;
    return chiamate === 1
      ? Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/X.js'))
      : Promise.resolve({ default: () => null });
  });
  assert.equal(await Pagina.preload(), false);
  assert.equal(await Pagina.preload(), true);
  assert.equal(chiamate, 2);
});
