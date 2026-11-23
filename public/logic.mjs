// Reine Logik ohne Browser-Abhängigkeiten: Preise, Bestellungen, Nachrichtentexte, Links.
// Wird von der App und von den Tests (node --test) gleichermaßen benutzt.

export const STATUS = {
  offen: 'Offen',
  verschickt: 'Verschickt',
  erledigt: 'Erledigt',
  storniert: 'Storniert',
};

export const DEFAULT_SETTINGS = {
  businessName: 'AirKneipi Fleischerwerkstatt',
  subtitle: 'Showroom',
  countryCode: '49',
  contact: '',
  greeting: 'Vielen Dank für Ihre Bestellung!',
  paymentNote: '', // z. B. „Bezahlung über PayPal an …“ – steht direkt unter dem Gesamtbetrag
  paypal: '', // PayPal.me-Name/-Link oder E-Mail: daraus wird ein Bezahl-Link mit fertigem Betrag
  paypalMode: 'freunde', // 'freunde' (Freunde & Familie) oder 'waren' (Waren und Dienstleistungen)
  orderPrefix: '',
  tone: 'sie', // Ansprache in der Nachricht: 'sie' oder 'du'
  shopOpen: true, // Bestellungen über den Bestell-Link annehmen
};

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

/** Cent-Betrag als "12,50 €". */
export function formatEuro(cents) {
  return euro.format((Number(cents) || 0) / 100).replace(/ /g, ' ');
}

/** "12,50", "12.5", "12,50 €" → 1250. Ungültig → null. */
export function parseEuro(text) {
  if (typeof text === 'number') return Number.isFinite(text) && text >= 0 ? Math.round(text * 100) : null;
  let s = String(text ?? '').replace(/[€\s]/g, '');
  if (!s) return null;
  // Tausenderpunkte erlauben ("1.234,50"), sonst Punkt als Dezimaltrenner ("12.5")
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

/** Cent-Betrag fürs Eingabefeld: 1250 → "12,50". */
export function centsToInput(cents) {
  return ((Number(cents) || 0) / 100).toFixed(2).replace('.', ',');
}

/** Menge auf 3 Nachkommastellen (kg) bzw. ganze Zahl (Stück), nie negativ. */
export function cleanQty(qty, unit = 'Stück') {
  const n = Number(String(qty ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return unit === 'kg' ? Math.round(n * 1000) / 1000 : Math.round(n);
}

export function lineTotal(item) {
  return Math.round(cleanQty(item.qty, item.unit) * Math.max(0, Math.round(item.priceCents || 0)));
}

/** 1.5 → "1,5", 2 → "2" */
export function formatQty(qty) {
  return String(Number(qty) || 0).replace('.', ',');
}

/** "pro Stück" / "pro kg" */
export function unitLabel(unit) {
  return unit === 'kg' ? 'pro kg' : 'pro Stück';
}

export function orderTotal(items = []) {
  return items.reduce((sum, item) => sum + lineTotal(item), 0);
}

/** Anzahl Positionen (Stück und kg lassen sich nicht sinnvoll addieren). */
export function itemCount(items = []) {
  return items.filter((item) => cleanQty(item.qty, item.unit) > 0).length;
}

/**
 * Fügt ein Produkt zu den Positionen hinzu oder erhöht die Menge.
 * Preis und Name werden in die Position kopiert, damit spätere Preisänderungen
 * alte Bestellungen nicht verändern.
 */
export function addItem(items, product, qty) {
  const unit = product.unit === 'kg' ? 'kg' : 'Stück';
  const step = qty ?? stepFor(unit);
  const next = items.map((i) => ({ ...i }));
  const hit = next.find((i) => i.productId === product.id);
  if (hit) hit.qty = cleanQty(hit.qty + step, hit.unit);
  else next.push({ productId: product.id, name: product.name, size: product.size || '', priceCents: product.priceCents, unit, qty: cleanQty(step, unit) });
  return next.filter((i) => i.qty > 0);
}

/** Schrittweite der +/− Knöpfe: 1 Stück bzw. 0,5 kg. */
export function stepFor(unit) {
  return unit === 'kg' ? 0.5 : 1;
}

export function setQty(items, productId, qty) {
  return items
    .map((i) => (i.productId === productId ? { ...i, qty: cleanQty(qty, i.unit) } : { ...i }))
    .filter((i) => i.qty > 0);
}

/** Eine Zeile im Bestelltext. */
export function itemLine(item) {
  const total = formatEuro(lineTotal(item));
  if (item.unit === 'kg') return `${formatQty(item.qty)} kg ${item.name} à ${formatEuro(item.priceCents)}/kg = ${total}`;
  const size = item.size ? ` (${item.size})` : '';
  return `${formatQty(item.qty)} × ${item.name}${size} à ${formatEuro(item.priceCents)} = ${total}`;
}

/** Nächste Bestellnummer im Jahr: "2026-0001", "2026-0002", ... */
export function nextOrderNumber(orders, date = new Date(), prefix = '') {
  const year = String(date.getFullYear());
  const tag = String(prefix ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const head = tag ? `${tag}-${year}-` : `${year}-`;
  let max = 0;
  for (const o of orders) {
    if (typeof o.number === 'string' && o.number.startsWith(head)) {
      const n = Number(o.number.slice(head.length));
      if (Number.isInteger(n) && n > max) max = n;
    }
  }
  return `${head}${String(max + 1).padStart(4, '0')}`;
}

/**
 * Telefonnummer für wa.me: nur Ziffern mit Ländervorwahl, ohne + und führende Nullen.
 * "0171 1234567" → "491711234567", "+49 (171) 123" → "49171123", "0043 660 1" → "436601".
 */
export function normalizePhone(phone, countryCode = '49') {
  let s = String(phone ?? '').trim();
  if (!s) return '';
  const plus = s.startsWith('+');
  s = s.replace(/\D/g, '');
  if (!s) return '';
  if (plus) return s;
  if (s.startsWith('00')) return s.slice(2);
  if (s.startsWith('0')) return String(countryCode).replace(/\D/g, '') + s.slice(1);
  return s;
}

/**
 * PayPal-Link mit fertigem Betrag.
 * - PayPal.me-Name oder -Link → https://paypal.me/NAME/41.00EUR
 * - E-Mail-Adresse → PayPal-Zahlungsseite an diese Adresse, Betrag und Bestellnummer vorausgefüllt
 * Leer oder unbrauchbar → ''.
 */
export function paypalLink(paypal, cents, reference = '', mode = 'waren') {
  const v = String(paypal ?? '').trim();
  const amount = ((Number(cents) || 0) / 100).toFixed(2);
  if (!v || !(Number(cents) > 0)) return '';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    // Dieser Link öffnet bei PayPal immer „Waren und Dienstleistungen“ – für „Freunde & Familie“ gibt es keinen
    if (mode === 'freunde') return '';
    const q = new URLSearchParams({ cmd: '_xclick', business: v, currency_code: 'EUR', amount, item_name: reference ? `Bestellung ${reference}` : 'Bestellung' });
    return `https://www.paypal.com/cgi-bin/webscr?${q}`;
  }
  const name = v.replace(/^https?:\/\//, '').replace(/^(www\.)?paypal\.me\//i, '').replace(/\/.*$/, '');
  return /^[A-Za-z0-9._-]{2,40}$/.test(name) ? `https://paypal.me/${name}/${amount}EUR` : '';
}

const STORNO = 'storniert';
const pad2 = (n) => String(n).padStart(2, '0');
/** Lokaler Tag "2026-11-23" und Monat "2026-11" einer ISO-Zeit. */
export const dayKey = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
export const monthKey = (iso) => dayKey(iso).slice(0, 7);

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const monthLabel = (key) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

function sum(orders) {
  const r = { count: 0, total: 0, paid: 0, open: 0 };
  for (const o of orders) {
    if (o.status === STORNO) continue;
    const t = orderTotal(o.items);
    r.count += 1;
    r.total += t;
    if (o.paid) r.paid += t; else r.open += t;
  }
  return r;
}

/**
 * Umsatz nach Bestelldatum (Stornos zählen nicht).
 * today/month: laufender Tag und Monat; months: alle Monate mit Bestellungen, neueste zuerst;
 * days(month): Tage eines Monats, neueste zuerst; unpaid: alles noch nicht Bezahlte.
 */
export function salesSummary(orders = [], now = new Date()) {
  const today = dayKey(now.toISOString());
  const month = today.slice(0, 7);
  const valid = orders.filter((o) => o.createdAt);
  const group = (keyFn) => {
    const m = new Map();
    for (const o of valid) { const k = keyFn(o.createdAt); if (!m.has(k)) m.set(k, []); m.get(k).push(o); }
    return [...m].map(([key, list]) => ({ key, ...sum(list) })).filter((g) => g.count).sort((a, b) => b.key.localeCompare(a.key));
  };
  return {
    today: sum(valid.filter((o) => dayKey(o.createdAt) === today)),
    month: sum(valid.filter((o) => monthKey(o.createdAt) === month)),
    unpaid: sum(valid.filter((o) => !o.paid)),
    months: group(monthKey).map((g) => ({ ...g, label: monthLabel(g.key) })),
    days: (m) => group(dayKey).filter((g) => g.key.startsWith(m)),
  };
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('de-DE', { weekday: iso.length === 10 ? 'short' : undefined, day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Der Bestelltext, der per WhatsApp, Telegram oder Mail verschickt wird. */
/**
 * Vorname für die Anrede: eigenes Feld „salutation“ beim Kunden, sonst das erste Wort des Namens
 * (ohne Herr/Frau/Dr.). „Max Mustermann“ → „Max“.
 */
export function firstName(customer) {
  const own = String(customer?.salutation ?? '').trim();
  if (own) return own;
  const words = String(customer?.name ?? '').trim().split(/\s+/).filter(Boolean);
  while (words.length > 1 && /^(herr|frau|dr\.?|prof\.?)$/i.test(words[0])) words.shift();
  return words[0] || '';
}

const GREETING_SIE = 'Vielen Dank für Ihre Bestellung!';
const GREETING_DU = 'Vielen Dank für deine Bestellung!';

export function orderMessage(order, customer, settings = DEFAULT_SETTINGS) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const du = s.tone === 'du';
  const lines = [];
  const name = firstName(customer);
  lines.push(name ? `Hallo ${name},` : 'Hallo,');
  lines.push('');
  const when = formatDate(order.createdAt);
  lines.push(`hier ${du ? 'deine' : 'Ihre'} Bestellung bei ${s.businessName}${when ? ` vom ${when}` : ''}:`);
  lines.push('');
  for (const item of order.items || []) {
    lines.push(itemLine(item));
  }
  lines.push('');
  lines.push(`Gesamt: ${formatEuro(orderTotal(order.items))}`);
  if (order.paid) {
    lines.push('Bereits bezahlt – vielen Dank!');
  } else {
    if (s.paymentNote?.trim()) lines.push(s.paymentNote.trim());
    if (s.paypal?.trim() && s.paypalMode === 'freunde') lines.push('Bitte als „Freunde & Familie“ senden.');
    const pay = paypalLink(s.paypal, orderTotal(order.items), payReference(order), s.paypalMode);
    if (pay) lines.push(`Jetzt bezahlen: ${pay}`);
  }
  if (order.pickupDate) lines.push(`Abholung: ${formatDate(order.pickupDate)}`);
  if (order.note?.trim()) lines.push(`Hinweis: ${order.note.trim()}`);
  if (s.greeting?.trim()) {
    lines.push('');
    // der voreingestellte Schlusssatz passt sich der Ansprache an, ein eigener Text bleibt wie er ist
    lines.push(du && s.greeting.trim() === GREETING_SIE ? GREETING_DU : s.greeting.trim());
  }
  if (s.contact?.trim()) {
    lines.push('');
    lines.push(s.businessName);
    lines.push(s.contact.trim());
  }
  return lines.join('\n');
}

export function orderSubject(order, settings = DEFAULT_SETTINGS) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const when = formatDate(order.createdAt);
  return `${s.tone === 'du' ? 'Deine' : 'Ihre'} Bestellung bei ${s.businessName}${when ? ` vom ${when}` : ''}`;
}

/** Verwendungszweck auf der PayPal-Seite: Datum statt Bestellnummer („Bestellung vom 22.11.2026“). */
export function payReference(order) {
  const when = formatDate(order.createdAt);
  return when ? `vom ${when}` : '';
}

export function whatsappLink(phone, text, countryCode = '49') {
  const number = normalizePhone(phone, countryCode);
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

/** Telegram erlaubt kein Vorbefüllen an eine bestimmte Nummer: Teilen-Dialog mit Text, Kontakt wählt man dort. */
export function telegramLink(text) {
  return `https://t.me/share/url?url=${encodeURIComponent(' ')}&text=${encodeURIComponent(text)}`;
}

export function telegramChatLink(username) {
  const u = String(username ?? '').trim().replace(/^@/, '').replace(/^https?:\/\/t\.me\//, '');
  return /^[A-Za-z0-9_]{4,}$/.test(u) ? `https://t.me/${u}` : '';
}

export function mailLink(email, subject, text) {
  const body = text.replace(/\n/g, '\r\n');
  return `mailto:${encodeURIComponent(String(email ?? '').trim()).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Suche über Name, Telefon, Mail und Ort, ohne Groß/Klein und Umlaut-Probleme. */
export function matches(customer, query) {
  const q = fold(query);
  if (!q) return true;
  const hay = fold([customer.name, customer.phone, customer.email, customer.telegram, customer.address, customer.notes].join(' '));
  return q.split(/\s+/).every((part) => hay.includes(part));
}

export function fold(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim();
}

export const BACKUP_FORMAT = 'airkneipi-fleischerwerkstatt-showroom';

export function makeBackup(data, now = new Date(), from = '') {
  return {
    format: BACKUP_FORMAT,
    version: 2,
    exportedAt: now.toISOString(),
    from,
    tombstones: data.tombstones || {},
    settings: data.settings || {},
    products: data.products || [],
    customers: data.customers || [],
    orders: data.orders || [],
  };
}

/** Prüft eine Sicherungsdatei. Wirft einen Fehler mit deutscher Meldung, wenn sie nicht passt. */
export function readBackup(json) {
  let data;
  try {
    data = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    throw new Error('Die Datei ist keine gültige Sicherung (kein JSON).');
  }
  if (!data || data.format !== BACKUP_FORMAT) throw new Error('Die Datei ist keine Sicherung dieses Showrooms.');
  if (data.version !== 1 && data.version !== 2) throw new Error(`Unbekannte Sicherungsversion ${data.version}. Bitte die App aktualisieren.`);
  for (const key of ['products', 'customers', 'orders']) {
    if (!Array.isArray(data[key])) throw new Error(`In der Sicherung fehlt die Liste „${key}“.`);
    for (const row of data[key]) {
      if (!row || typeof row.id !== 'string') throw new Error(`Ein Eintrag in „${key}“ hat keine gültige ID.`);
    }
  }
  const tombstones = data.tombstones && typeof data.tombstones === 'object' && !Array.isArray(data.tombstones) ? data.tombstones : {};
  return { settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) }, products: data.products, customers: data.customers, orders: data.orders,
    tombstones, from: typeof data.from === 'string' ? data.from : '', exportedAt: data.exportedAt || '' };
}

export const SYNC_STORES = ['products', 'customers', 'orders'];
const stamp = (row) => row?.updatedAt || row?.createdAt || '';

/**
 * Führt eine Abgleich-Datei mit den eigenen Daten zusammen.
 * Neue Einträge kommen dazu, bei gleicher ID gewinnt die neuere Änderung (updatedAt),
 * Gelöschtes (tombstones: id → Zeitpunkt) bleibt gelöscht, außer der Eintrag wurde danach noch geändert.
 * Die gemeinsamen Einstellungen gewinnen ebenfalls nach updatedAt.
 */
export function mergeData(local, incoming) {
  const tombstones = { ...(local.tombstones || {}) };
  for (const [id, at] of Object.entries(incoming.tombstones || {})) {
    if (!tombstones[id] || at > tombstones[id]) tombstones[id] = at;
  }
  const stats = { added: 0, updated: 0, removed: 0 };
  const result = { tombstones };
  for (const name of SYNC_STORES) {
    const map = new Map((local[name] || []).map((r) => [r.id, r]));
    const before = new Set(map.keys());
    for (const row of incoming[name] || []) {
      const cur = map.get(row.id);
      if (!cur) {
        if (tombstones[row.id] && tombstones[row.id] >= stamp(row)) continue;
        map.set(row.id, row);
        stats.added++;
      } else if (stamp(row) > stamp(cur)) {
        map.set(row.id, row);
        stats.updated++;
      }
    }
    for (const [id, at] of Object.entries(tombstones)) {
      const cur = map.get(id);
      if (cur && at >= stamp(cur)) {
        map.delete(id);
        if (before.has(id)) stats.removed++;
      }
    }
    result[name] = [...map.values()];
  }
  const ls = local.settings || {};
  const is = incoming.settings || {};
  result.settings = (is.updatedAt || '') > (ls.updatedAt || '') ? { ...DEFAULT_SETTINGS, ...is } : { ...DEFAULT_SETTINGS, ...ls };
  return { data: result, stats };
}

/** Doppelte Bestellnummern (z. B. wenn ein Kürzel fehlte). */
export function duplicateNumbers(orders = []) {
  const seen = new Map();
  for (const o of orders) seen.set(o.number, (seen.get(o.number) || 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([num]) => num);
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Startsortiment nach den Produktplakaten (Stand 22.11.2026), Fotos = die Plakate. */
export const STARTSORTIMENT = [
  ['Hirschsalami', 'Wurst', 'Stück', '10', '', 'Am Stück'],
  ['Wildschwein-Knacker', 'Wurst', 'Stück', '8', '5 Stück', ''],
  ['Wildschwein-Krakauer', 'Wurst', 'Stück', '7', '4 Stück', ''],
  ['Wildschwein-Käsesiedewurst', 'Wurst', 'Stück', '8', '4 Stück', ''],
  ['Wildschwein-Bratwurst', 'Grill', 'Stück', '7', '4 Stück', ''],
  ['Wildschwein-Käse-Bratwurst', 'Grill', 'Stück', '8', '4 Stück', ''],
  ['Chilli-Cheddar-Bratwurst', 'Grill', 'Stück', '8', '4 Stück', ''],
  ['Wildfleischkäse mit Käse', 'Wurst', 'Stück', '13', '1-kg-Schale', ''],
  ['Wildschwein-Hackfleisch', 'Frischfleisch', 'kg', '13', '', ''],
  ['Wildschweingulasch', 'Frischfleisch', 'kg', '17', '', ''],
  ['Hirschgulasch', 'Frischfleisch', 'kg', '18', '', ''],
  ['Rehgulasch', 'Frischfleisch', 'kg', '18', '', ''],
  ['Marinierte Wildschwein-Rückensteaks', 'Grill', 'kg', '30', '', ''],
  ['Chilli con Carne', 'Dosen', 'Stück', '14', 'Dose 800 g', ''],
  ['Rehgulasch', 'Dosen', 'Stück', '9', 'Dose 400 g', ''],
  ['Wildschweingulasch', 'Dosen', 'Stück', '9', 'Dose 400 g', ''],
  ['Wildbolognese', 'Dosen', 'Stück', '7', 'Dose 400 g', ''],
  ['Wildcurrywurst', 'Dosen', 'Stück', '7', 'Dose 400 g', ''],
];

export const CATEGORIES = ['Wurst', 'Grill', 'Frischfleisch', 'Dosen'];

/** Feste IDs, damit das Startsortiment auf zwei Handys beim Abgleich nicht doppelt auftaucht. */
export const startId = (index) => `start-${String(index + 1).padStart(2, '0')}`;

/** Plakatfoto zum Startsortiment (liegt in public/produkte/). */
/** Plakate mit neuem Preis bekommen einen neuen Dateinamen, damit Handys das alte Bild nicht aus dem Zwischenspeicher zeigen. */
export const PHOTO_VERSION = { 'start-02': 2, 'start-09': 2 };
export const startPhoto = (index) => { const id = startId(index); return `produkte/${id}${PHOTO_VERSION[id] ? `-v${PHOTO_VERSION[id]}` : ''}.jpg`; };

export function startProducts() {
  return STARTSORTIMENT.map(([name, category, unit, price, size, description], index) => ({
    id: startId(index), name, category, unit, priceCents: parseEuro(price), size, description, photo: startPhoto(index), active: true, sort: index,
  }));
}

/**
 * Ältere Installationen haben das Startsortiment mit Zufalls-IDs angelegt.
 * Diese Produkte bekommen die festen IDs, damit der Abgleich sie zusammenlegt.
 * Gibt die geänderten Produkte als [{ oldId, product }] zurück.
 */
export function migrateStartIds(products) {
  const taken = new Set(products.map((p) => p.id));
  const changes = [];
  STARTSORTIMENT.forEach(([name, , unit, , size], index) => {
    const id = startId(index);
    if (taken.has(id)) return;
    const hit = products.find((p) => !p.id.startsWith('start-') && !changes.some((c) => c.oldId === p.id)
      && p.name === name && p.unit === unit && ((p.size || '') === size || (name === 'Hirschsalami' && p.size === 'Stück')));
    if (hit) changes.push({ oldId: hit.id, product: { ...hit, id } });
  });
  return changes;
}

/**
 * Ältere Installationen haben das Startsortiment ohne Fotos. Ergänzt das Plakatfoto,
 * wo noch kein eigenes Foto gesetzt ist. Gibt nur die geänderten Produkte zurück.
 */
export function fillStartPhotos(products) {
  return products
    .filter((p) => !p.photo && /^start-(\d\d)$/.test(p.id) && Number(p.id.slice(6)) <= STARTSORTIMENT.length)
    .map((p) => ({ ...p, photo: startPhoto(Number(p.id.slice(6)) - 1) }));
}

/** Testkunden zum Ausprobieren (keine echten Daten). */
export function sampleCustomers() {
  return [
    { id: newId(), name: 'Max Mustermann', phone: '0171 1234567', email: 'max@example.com', telegram: '', address: 'Musterstraße 1, 55116 Mainz', notes: 'Testkunde' },
    { id: newId(), name: 'Erika Beispiel', phone: '0151 7654321', email: '', telegram: 'erika_beispiel', address: '', notes: 'Testkunde' },
  ];
}

export function sampleData() {
  return { products: startProducts(), customers: sampleCustomers(), orders: [] };
}

// ---------- Bestell-Link: Freunde bestellen selbst ----------

export const SHOP_PREFIX = 'WEB';

const sortForShop = (a, b) => (CATEGORIES.indexOf(a.category) + 1 || 99) - (CATEGORIES.indexOf(b.category) + 1 || 99)
  || (a.sort ?? 999) - (b.sort ?? 999) || String(a.name).localeCompare(String(b.name), 'de');

/** Öffentlicher Katalog für die Bestellseite: nur sichtbare Produkte und nur die nötigen Felder – nie Kunden oder Bestellungen. */
export function shopCatalog(state) {
  const s = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
  const products = (state.products || []).filter((p) => p.active !== false).sort(sortForShop)
    .map((p) => ({ id: p.id, name: p.name, category: p.category || '', unit: p.unit === 'kg' ? 'kg' : 'Stück',
      priceCents: p.priceCents, size: p.size || '', description: p.description || '', photo: p.photo || '' }));
  return { businessName: s.businessName, subtitle: s.subtitle, open: s.shopOpen !== false, paymentNote: s.paymentNote,
    paypal: s.paypal, paypalMode: s.paypalMode, contact: s.contact, products };
}

const clip = (v, max) => String(v ?? '').trim().slice(0, max);
function shopError(message, status = 400) { return Object.assign(new Error(message), { status }); }

/**
 * Prüft eine Bestellung von der Bestellseite und baut daraus die Bestellung (und ggf. einen neuen Kunden).
 * Preise und Namen kommen immer aus dem eigenen Sortiment, nie vom Absender.
 * Ein bekannter Kunde wird an der Telefonnummer erkannt. Fehler haben eine verständliche Meldung (err.status 400/403).
 */
export function buildShopOrder(state, input, now = new Date()) {
  const s = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
  if (s.shopOpen === false) throw shopError('Bestellungen sind gerade pausiert. Bitte später noch einmal versuchen.', 403);
  const name = clip(input?.name, 80);
  const phone = clip(input?.phone, 40);
  const email = clip(input?.email, 120);
  const note = clip(input?.note, 500);
  const pickupDate = /^\d{4}-\d{2}-\d{2}$/.test(String(input?.pickupDate || '')) ? input.pickupDate : '';
  if (name.length < 2) throw shopError('Bitte deinen Namen angeben.');
  const phoneKey = normalizePhone(phone, s.countryCode);
  if (phoneKey.length < 8) throw shopError('Bitte deine Handynummer angeben, damit wir uns melden können.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw shopError('Die E-Mail-Adresse sieht nicht richtig aus.');
  if (pickupDate && pickupDate < dayKey(now.toISOString())) throw shopError('Der Abholtag liegt in der Vergangenheit.');
  const wanted = Array.isArray(input?.items) ? input.items.slice(0, 60) : [];
  const qtyById = new Map();
  for (const w of wanted) {
    const id = String(w?.productId ?? '');
    qtyById.set(id, (qtyById.get(id) || 0) + (Number(String(w?.qty ?? '').replace(',', '.')) || 0));
  }
  const items = [];
  for (const [id, raw] of qtyById) {
    const p = (state.products || []).find((x) => x.id === id && x.active !== false);
    if (!p) throw shopError('Ein Produkt gibt es leider nicht mehr. Bitte die Seite neu laden.');
    const unit = p.unit === 'kg' ? 'kg' : 'Stück';
    const qty = cleanQty(raw, unit);
    if (!qty) continue;
    if (qty > (unit === 'kg' ? 20 : 50)) throw shopError(`Bei „${p.name}“ ist die Menge zu groß. Für größere Mengen bitte direkt melden.`);
    items.push({ productId: p.id, name: p.name, size: p.size || '', priceCents: p.priceCents, unit, qty });
  }
  if (!items.length) throw shopError('Bitte mindestens ein Produkt auswählen.');
  const at = now.toISOString();
  let customer = (state.customers || []).find((c) => c.phone && normalizePhone(c.phone, s.countryCode) === phoneKey);
  let newCustomer = null;
  if (!customer) {
    customer = newCustomer = { id: newId(), name, phone, email, telegram: '', address: '', notes: 'Kam über den Bestell-Link', salutation: '', updatedAt: at };
  }
  const extra = [];
  if (!newCustomer && fold(name) !== fold(customer.name)) extra.push(`Bestellt als: ${name}`);
  if (!newCustomer && email && email !== customer.email) extra.push(`E-Mail: ${email}`);
  const order = {
    id: newId(), number: nextOrderNumber(state.orders || [], now, SHOP_PREFIX), createdAt: at, updatedAt: at,
    status: 'offen', source: 'link', seen: false, paid: false,
    customerId: customer.id, customerName: customer.name, items, pickupDate,
    note: [note, ...extra].filter(Boolean).join(' · '),
  };
  return { order, newCustomer };
}
