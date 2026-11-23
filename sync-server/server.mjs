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
//   POST /api/sync    → Body = Abgleich-Datei des Handys, Antwort = gemeinsamer Stand (+ Bestell-Schlüssel)
//                       Header: Authorization: Bearer <SYNC_KEY>
//   GET  /api/katalog?t=<Bestell-Schlüssel>  → sichtbare Produkte + Zahlungshinweis (keine Kunden/Bestellungen)
//   POST /api/bestellung  {t, name, phone, email, pickupDate, note, items:[{productId, qty}]}
//                       → legt die Bestellung an (Preise vom Server), Antwort = Zusammenfassung für die Danke-Seite
// Der Bestell-Schlüssel liegt in DATA_DIR/bestell-schluessel.txt und wird beim ersten Start erzeugt.

import http from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rename, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { timingSafeEqual, createHash, randomBytes } from 'node:crypto';

const here = new URL('.', import.meta.url);
const logicUrl = [new URL('./logic.mjs', here), new URL('../public/logic.mjs', here)].find((u) => existsSync(u));
const { mergeData, readBackup, makeBackup, shopCatalog, buildShopOrder, orderTotal, itemLine, paypalLink, payReference, DEFAULT_SETTINGS } = await import(logicUrl.href);

export const VERSION = '2';
const MAX_ORDER_BODY = 50 * 1024;
const ORDERS_PER_IP = 5; // je 10 Minuten
const ORDERS_PER_DAY = 300;
const MAX_BODY = 60 * 1024 * 1024; // Fotos als data-URL können groß sein
const KEEP_BACKUPS = 30;

export function createSyncServer({ key, dataDir, origins, shopToken = '', log = console.log }) {
  if (!key || key.length < 24) throw new Error('SYNC_KEY fehlt oder ist kürzer als 24 Zeichen.');
  const keyHash = createHash('sha256').update(key).digest();
  const shopHash = shopToken ? createHash('sha256').update(shopToken).digest() : null;
  const orderTimes = new Map(); // IP → Zeitpunkte der letzten Bestellungen
  let ordersToday = { day: '', n: 0 };
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

  function shopAuthorized(token) {
    if (!shopHash || typeof token !== 'string' || !token) return false;
    return timingSafeEqual(createHash('sha256').update(token).digest(), shopHash);
  }

  /** Spam-Bremse: höchstens 5 Bestellungen je Absender in 10 Minuten und 300 am Tag insgesamt. */
  function orderAllowed(ip) {
    const nowMs = Date.now();
    const list = (orderTimes.get(ip) || []).filter((t) => nowMs - t < 10 * 60 * 1000);
    const day = new Date().toISOString().slice(0, 10);
    if (ordersToday.day !== day) ordersToday = { day, n: 0 };
    orderTimes.set(ip, list);
    return list.length < ORDERS_PER_IP && ordersToday.n < ORDERS_PER_DAY;
  }

  /** Nur angenommene Bestellungen zählen – Tippfehler kosten niemanden ein Kontingent. */
  function countOrder(ip) {
    orderTimes.get(ip)?.push(Date.now());
    ordersToday.n += 1;
  }

  /** Schreibzugriffe nacheinander, damit sich Handys und Bestellungen nicht überschreiben. */
  function serial(fn) {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
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

  function readBody(req, limit = MAX_BODY) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) { reject(Object.assign(new Error('Zu groß'), { status: 413 })); req.destroy(); return; }
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

      // ---------- Bestell-Link (öffentlich, nur mit Bestell-Schlüssel) ----------
      if (path === '/api/katalog' || path === '/api/bestellung') {
        if (!shopHash) return send(404, { error: 'Bestell-Link ist nicht eingerichtet.' });
        if (blocked(ip)) return send(429, { error: 'Zu viele Versuche, bitte 10 Minuten warten.' });
        if (path === '/api/katalog') {
          if (req.method !== 'GET') return send(405, { error: 'Nur GET' });
          if (!shopAuthorized(new URL(req.url, 'http://x').searchParams.get('t'))) { fail(ip); return send(401, { error: 'Dieser Bestell-Link ist ungültig.' }); }
          return send(200, shopCatalog(await load()));
        }
        if (req.method !== 'POST') return send(405, { error: 'Nur POST' });
        let input;
        try { input = JSON.parse(await readBody(req, MAX_ORDER_BODY)); } catch (e) { if (e.status) throw e; return send(400, { error: 'Ungültige Bestellung.' }); }
        if (!shopAuthorized(input?.t)) { fail(ip); return send(401, { error: 'Dieser Bestell-Link ist ungültig.' }); }
        if (input.website) return send(200, { ok: true, lines: [], total: 0 }); // Honigtopf-Feld: nur Bots füllen das aus
        if (!orderAllowed(ip)) return send(429, { error: 'Es kamen gerade sehr viele Bestellungen. Bitte in ein paar Minuten noch einmal versuchen.' });
        const { order, state } = await serial(async () => {
          const st = await load();
          const built = buildShopOrder(st, input);
          st.orders.push(built.order);
          if (built.newCustomer) st.customers.push(built.newCustomer);
          await save(st);
          return { order: built.order, state: st };
        });
        countOrder(ip);
        const s = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
        const total = orderTotal(order.items);
        log(`${new Date().toISOString()} Bestellung über den Link: ${order.number} von ${order.customerName}, ${(total / 100).toFixed(2)} EUR`);
        return send(200, {
          ok: true, total, lines: order.items.map(itemLine), pickupDate: order.pickupDate,
          paymentNote: s.paymentNote, paypalMode: s.paypalMode, paypal: s.paypal,
          payLink: paypalLink(s.paypal, total, payReference(order), s.paypalMode), businessName: s.businessName,
        });
      }

      if (path !== '/api/sync') return send(404, { error: 'Nicht gefunden' });
      if (req.method !== 'POST') return send(405, { error: 'Nur POST' });
      if (blocked(ip)) return send(429, { error: 'Zu viele falsche Versuche, bitte 10 Minuten warten.' });
      if (!authorized(req)) { fail(ip); return send(401, { error: 'Falscher Schlüssel' }); }
      failures.delete(ip);
      const incoming = readBackup(await readBody(req));
      // Anfragen nacheinander abarbeiten, damit sich zwei Handys nicht überschreiben
      const { data, stats } = await serial(async () => {
        const merged = mergeData(await load(), incoming);
        await save(merged.data);
        return merged;
      });
      log(`${new Date().toISOString()} Abgleich von ${incoming.from || '?'}: ${stats.added} neu, ${stats.updated} aktualisiert, ${stats.removed} gelöscht`);
      return send(200, { ...makeBackup(data, new Date(), 'NAS'), stats, shop: shopToken ? { token: shopToken } : null });
    } catch (err) {
      const status = err.status || (/Sicherung|JSON|Eintrag|Liste|Version/.test(err.message) ? 400 : 500);
      // Fehler aus der Bestellprüfung haben eine verständliche Meldung (status 400/403)
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
  // Bestell-Schlüssel: einmal erzeugen und in DATA_DIR aufheben (getrennt vom Abgleich-Schlüssel)
  const tokenFile = join(dataDir, 'bestell-schluessel.txt');
  let shopToken = '';
  try { shopToken = (await readFile(tokenFile, 'utf8')).trim(); } catch { /* noch keiner */ }
  if (shopToken.length < 16) {
    shopToken = randomBytes(18).toString('base64url');
    await writeFile(tokenFile, `${shopToken}\n`);
  }
  createSyncServer({ key: process.env.SYNC_KEY, dataDir, origins, shopToken }).listen(port, '0.0.0.0', () => {
    console.log(`Abgleich-Server ${VERSION} auf Port ${port}, Daten in ${dataDir}, erlaubt für ${origins.join(', ')}`);
  });
}
