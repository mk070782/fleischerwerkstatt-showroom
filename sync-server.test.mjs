import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSyncServer } from './sync-server/server.mjs';
import { makeBackup, startProducts } from './public/logic.mjs';

const KEY = 'test-schluessel-0123456789abcdef';
const ORIGIN = 'https://mk070782.github.io';

async function withServer(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'fw-sync-'));
  const server = createSyncServer({ key: KEY, dataDir: dir, origins: [ORIGIN], log: () => {} });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base, dir);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
}

const sync = (base, body, key = KEY, origin = ORIGIN) => fetch(`${base}/api/sync`, {
  method: 'POST',
  headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', origin },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const T = (h) => `2026-11-22T${String(h).padStart(2, '0')}:00:00.000Z`;
const phone = (from, data) => makeBackup({ products: startProducts(), customers: [], orders: [], settings: {}, tombstones: {}, ...data }, new Date(), from);

test('Server: zwei Handys gleichen über den Server ab', async () => {
  await withServer(async (base, dir) => {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.ok, true);

    const a = phone('M', { customers: [{ id: 'c1', name: 'Max', updatedAt: T(8) }], orders: [{ id: 'o1', number: 'M-2026-0001', updatedAt: T(8) }] });
    const r1 = await sync(base, a);
    assert.equal(r1.status, 200);
    assert.equal(r1.headers.get('access-control-allow-origin'), ORIGIN);
    const s1 = await r1.json();
    assert.equal(s1.from, 'NAS');
    assert.deepEqual(s1.stats, { added: 20, updated: 0, removed: 0 });

    const b = phone('B', { customers: [{ id: 'c2', name: 'Kunde Bruder', updatedAt: T(9) }], tombstones: { c1: T(10) } });
    const s2 = await (await sync(base, b)).json();
    assert.deepEqual(s2.customers.map((c) => c.id), ['c2']); // Max wurde vom Bruder gelöscht
    assert.equal(s2.orders.length, 1);
    assert.equal(s2.products.length, 18);
    assert.equal(s2.tombstones.c1, T(10));

    // Stand liegt als Datei vor, plus Tagessicherung
    const files = await readdir(dir);
    assert.ok(files.includes('stand.json'));
    assert.equal((await readdir(join(dir, 'sicherungen'))).length, 1);
  });
});

test('Server: falscher Schlüssel, Sperre, fremde Herkunft, kaputte Datei', async () => {
  await withServer(async (base) => {
    const ok = phone('M', {});
    assert.equal((await sync(base, ok, 'falsch-falsch-falsch-falsch')).status, 401);
    const noAuth = await fetch(`${base}/api/sync`, { method: 'POST', body: '{}' });
    assert.equal(noAuth.status, 401);
    // fremde Webseite bekommt keine CORS-Freigabe
    const foreign = await sync(base, ok, KEY, 'https://boese.example');
    assert.equal(foreign.status, 200);
    assert.equal(foreign.headers.get('access-control-allow-origin'), null);
    // Vorabanfrage des Browsers
    const pre = await fetch(`${base}/api/sync`, { method: 'OPTIONS', headers: { origin: ORIGIN } });
    assert.equal(pre.status, 204);
    assert.match(pre.headers.get('access-control-allow-headers'), /authorization/);
    // kaputte Datei → 400 mit verständlicher Meldung
    const bad = await sync(base, '{"format":"anders"}');
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /keine Sicherung/);
    // nach 10 Fehlversuchen am Stück gesperrt, auch mit richtigem Schlüssel
    // (ein erfolgreicher Abgleich oben hat den Zähler zurückgesetzt)
    for (let i = 0; i < 10; i++) await sync(base, ok, 'falsch-falsch-falsch-falsch');
    assert.equal((await sync(base, ok)).status, 429);
    assert.equal((await fetch(`${base}/api/x`)).status, 404);
  });
});

test('Server startet nicht ohne ausreichend langen Schlüssel', () => {
  assert.throws(() => createSyncServer({ key: 'kurz', dataDir: '.', origins: [] }), /SYNC_KEY/);
});
