// Abgleich-Server für den Fleischerwerkstatt Showroom – läuft auf der Synology (Container Manager).
// Ohne Fremdpakete. Speichert den gemeinsamen Stand als JSON-Datei und führt mit derselben
// Logik zusammen wie die App (mergeData): Neues kommt dazu, Neueres gewinnt, Gelöschtes bleibt gelöscht.
//
// Umgebung:
//   SYNC_KEY        Pflicht. Gemeinsamer Schlüssel (mind. 24 Zeichen), steht auch in den Handys.
//   ALLOWED_ORIGINS Komma-getrennt, Standard: https://mk070782.github.io
//   DATA_DIR        Standard: ./data
//   PORT            Standard: 3191
//
// API:
//   GET  /api/health  → { ok, version }                          (ohne Schlüssel)
//   POST /api/sync    → Body = Abgleich-Datei des Handys, Antwort = gemeinsamer Stand
//                       Header: Authorization: Bearer <SYNC_KEY>

import http from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rename, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { timingSafeEqual, createHash } from 'node:crypto';

const here = new URL('.', import.meta.url);
const logicUrl = [new URL('./logic.mjs', here), new URL('../public/logic.mjs', here)].find((u) => existsSync(u));
const { mergeData, readBackup, makeBackup } = await import(logicUrl.href);

export const VERSION = '1';
const MAX_BODY = 60 * 1024 * 1024; // Fotos als data-URL können groß sein
const KEEP_BACKUPS = 30;

export function createSyncServer({ key, dataDir, origins, log = console.log }) {
  if (!key || key.length < 24) throw new Error('SYNC_KEY fehlt oder ist kürzer als 24 Zeichen.');
  const keyHash = createHash('sha256').update(key).digest();
  const stateFile = join(dataDir, 'stand.json');
  const backupDir = join(dataDir, 'sicherungen');
  const failures = new Map(); // IP → { n, until }
  let queue = Promise.resolve();

  const empty = () => ({ products: [], customers: [], orders: [], settings: {}, tombstones: {} });

  async function load() {
    try {
      const raw = JSON.parse(await readFile(stateFile, 'utf8'));
      return { ...empty(), ...raw };
    } catch (err) {
      if (err.code === 'ENOENT') return empty();
      throw err;
    }
  }

  async function save(state) {
    await mkdir(backupDir, { recursive: true });
    const tmp = `${stateFile}.tmp`;
    await writeFile(tmp, JSON.stringify(state));
    await rename(tmp, stateFile); // atomar: nie eine halb geschriebene Datei
    // eine Sicherung pro Tag, die letzten 30 behalten
    const day = new Date().toISOString().slice(0, 10);
    await writeFile(join(backupDir, `stand-${day}.json`), JSON.stringify(state));
    const old = (await readdir(backupDir)).filter((f) => f.startsWith('stand-')).sort().slice(0, -KEEP_BACKUPS);
    for (const f of old) await unlink(join(backupDir, f)).catch(() => {});
  }

  function authorized(req) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!m) return false;
    return timingSafeEqual(createHash('sha256').update(m[1]).digest(), keyHash);
  }

  function blocked(ip) {
    const f = failures.get(ip);
    return f && f.n >= 10 && f.until > Date.now();
  }

  function fail(ip) {
    const f = failures.get(ip) || { n: 0, until: 0 };
    if (f.until < Date.now()) f.n = 0;
    f.n += 1;
    f.until = Date.now() + 10 * 60 * 1000;
    failures.set(ip, f);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(Object.assign(new Error('Zu groß'), { status: 413 })); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const cors = origin && origins.includes(origin)
      ? { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-max-age': '86400' }
      : {};
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors });
      res.end(JSON.stringify(body));
    };
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    try {
      const path = new URL(req.url, 'http://x').pathname;
      if (req.method === 'OPTIONS') return send(204, {});
      if (req.method === 'GET' && path === '/api/health') return send(200, { ok: true, version: VERSION });
      if (path !== '/api/sync') return send(404, { error: 'Nicht gefunden' });
      if (req.method !== 'POST') return send(405, { error: 'Nur POST' });
      if (blocked(ip)) return send(429, { error: 'Zu viele falsche Versuche, bitte 10 Minuten warten.' });
      if (!authorized(req)) { fail(ip); return send(401, { error: 'Falscher Schlüssel' }); }
      failures.delete(ip);
      const incoming = readBackup(await readBody(req));
      // Anfragen nacheinander abarbeiten, damit sich zwei Handys nicht überschreiben
      const result = queue.then(async () => {
        const { data, stats } = mergeData(await load(), incoming);
        await save(data);
        return { data, stats };
      });
      queue = result.catch(() => {});
      const { data, stats } = await result;
      log(`${new Date().toISOString()} Abgleich von ${incoming.from || '?'}: ${stats.added} neu, ${stats.updated} aktualisiert, ${stats.removed} gelöscht`);
      return send(200, { ...makeBackup(data, new Date(), 'NAS'), stats });
    } catch (err) {
      const status = err.status || (/Sicherung|JSON|Eintrag|Liste|Version/.test(err.message) ? 400 : 500);
      if (status === 500) log(`Fehler: ${err.stack || err}`);
      return send(status, { error: status === 500 ? 'Serverfehler' : err.message });
    }
  });
}

if (import.meta.main) {
  const port = Number(process.env.PORT) || 3191;
  const dataDir = process.env.DATA_DIR || join(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'data');
  const origins = (process.env.ALLOWED_ORIGINS || 'https://mk070782.github.io').split(',').map((s) => s.trim()).filter(Boolean);
  await mkdir(dataDir, { recursive: true });
  createSyncServer({ key: process.env.SYNC_KEY, dataDir, origins }).listen(port, '0.0.0.0', () => {
    console.log(`Abgleich-Server ${VERSION} auf Port ${port}, Daten in ${dataDir}, erlaubt für ${origins.join(', ')}`);
  });
}
