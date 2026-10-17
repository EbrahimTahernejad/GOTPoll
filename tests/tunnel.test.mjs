import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPublicRequest, isPublicUpgrade } from '../build/electron/tunnel/allowlist.js';

test('the viewer page and its assets are public', () => {
  for (const u of ['/', '/?transparent=1', '/index.html', '/icon.png', '/favicon.ico', '/api/counts', '/assets/root-D54-9Ic7.css', '/assets/entry.client-DQn2wos1.js']) {
    assert.ok(isPublicRequest('GET', u), u);
  }
  assert.ok(isPublicRequest('HEAD', '/'));
});

test('everything else is private', () => {
  for (const u of [
    '/api/dev/capture', '/api/dev/sim?rate=5', '/settings', '/api/anything', '/assets/../package.json',
    '/assets/%2e%2e/package.json', '/assets/x.js/../../secrets', '/build/electron/main.js', '/@vite/client', '/app/root.tsx',
    '/assets\\..\\x.js',
  ]) {
    assert.ok(!isPublicRequest('GET', u), u);
  }
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) assert.ok(!isPublicRequest(m, '/api/counts'), m);
});

test('dev builds also expose the Vite module graph (and nothing more)', () => {
  assert.ok(isPublicRequest('GET', '/@vite/client', true));
  assert.ok(isPublicRequest('GET', '/app/root.tsx', true));
  assert.ok(!isPublicRequest('GET', '/api/dev/capture', true));
});

test('only the live feed can upgrade to a websocket', () => {
  assert.ok(isPublicUpgrade('/ws'));
  assert.ok(isPublicUpgrade('/ws?z=1'));
  for (const u of ['/', '/ws/../x', '/wsx', '/vite-hmr', '/@vite/client']) assert.ok(!isPublicUpgrade(u), u);
});
