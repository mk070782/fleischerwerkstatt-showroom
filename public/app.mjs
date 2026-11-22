import * as db from './db.mjs';
import {
  STATUS, DEFAULT_SETTINGS, CATEGORIES, formatEuro, parseEuro, centsToInput, formatQty, unitLabel, stepFor,
  cleanQty, lineTotal, orderTotal, itemCount, addItem, setQty, nextOrderNumber, normalizePhone, formatDate,
  orderMessage, orderSubject, whatsappLink, telegramLink, telegramChatLink, mailLink, matches,
  makeBackup, readBackup, newId, startProducts, sampleCustomers, mergeData, duplicateNumbers, migrateStartIds, fillStartPhotos,
} from './logic.mjs';

const state = {
  products: [],
  customers: [],
  orders: [],
  settings: { ...DEFAULT_SETTINGS },
  draft: emptyDraft(),
  category: '',
  customerQuery: '',
  orderFilter: 'alle',
  tombstones: {}, // gelöschte IDs → Zeitpunkt, damit der Abgleich nichts zurückholt
  device: { prefix: '' }, // nur dieses Handy: Kürzel vor der Bestellnummer
  lastSync: null,
};

const now = () => new Date().toISOString();

/** Löschen merken, damit es beim Abgleich auch auf dem anderen Handy verschwindet. */
function bury(id) {
  state.tombstones[id] = now();
  scheduleSync();
  return db.setMeta('tombstones', state.tombstones);
}

// ---------- Automatischer Abgleich mit dem Server (Synology) ----------

let syncTimer;
let syncing = false;
let syncAgain = false;

/** Nach Änderungen kurz warten und dann abgleichen (mehrere Änderungen = ein Abgleich). */
function scheduleSync(delay = 2500) {
  if (!state.device.syncUrl || !state.device.syncKey) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => autoSync(), delay);
}

function syncStatusText() {
  const d = state.device;
  if (!d.syncUrl || !d.syncKey) return 'Nicht eingerichtet.';
  const l = d.lastAuto;
  if (syncing) return 'Gleicht gerade ab …';
  if (!l) return 'Noch nicht abgeglichen.';
  const when = `${formatDate(l.at)} ${new Date(l.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
  return l.ok
    ? `✓ Zuletzt abgeglichen ${when}${l.added || l.updated || l.removed ? ` · ${l.added} neu, ${l.updated} aktualisiert, ${l.removed} gelöscht` : ' · nichts Neues'}`
    : `⚠ Letzter Versuch ${when}: ${l.error}`;
}

function updateSyncStatus() {
  const el = document.getElementById('sync-status');
  if (el) el.textContent = syncStatusText();
  document.getElementById('sync-dot')?.setAttribute('data-state', !state.device.syncUrl ? 'off' : syncing ? 'busy' : state.device.lastAuto?.ok === false ? 'error' : 'ok');
}

/** Formulare nicht unter den Fingern neu aufbauen. */
function safeToRerender() {
  const view = (location.hash.split('/')[1] || '').split('?')[0];
  const a = document.activeElement;
  return !['kunde', 'produkt', 'bestellung'].includes(view) && !(a && main.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
}

async function autoSync({ manual = false } = {}) {
  const { syncUrl, syncKey } = state.device;
  if (!syncUrl || !syncKey) { if (manual) toast('Bitte zuerst Adresse und Schlüssel eintragen.'); return; }
  if (syncing) { syncAgain = true; return; }
  if (!manual && navigator.onLine === false) return;
  syncing = true;
  updateSyncStatus();
  try {
    const res = await fetch(`${syncUrl.replace(/\/+$/, '')}/api/sync`, {
      method: 'POST',
      headers: { authorization: `Bearer ${syncKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(makeBackup(state, new Date(), state.device.prefix)),
      signal: AbortSignal.timeout(25000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Server antwortet mit ${res.status}`);
    const { data, stats } = mergeData(state, readBackup(body));
    const changed = stats.added || stats.updated || stats.removed || (data.settings.updatedAt || '') !== (state.settings.updatedAt || '');
    if (changed) {
      await db.replaceAll(data);
      Object.assign(state, { products: data.products, customers: data.customers, orders: data.orders, settings: data.settings, tombstones: data.tombstones });
      state.draft.items = state.draft.items.filter((i) => product(i.productId));
      saveDraft();
    }
    state.device.lastAuto = { at: now(), ok: true, ...stats };
    await db.setMeta('device', state.device);
    syncing = false;
    if (changed && safeToRerender()) rerender();
    if (manual) toast(changed ? `Abgeglichen: ${stats.added} neu, ${stats.updated} aktualisiert, ${stats.removed} gelöscht` : 'Abgeglichen, alles aktuell');
  } catch (err) {
    const msg = err.name === 'TimeoutError' ? 'Zeitüberschreitung, Server antwortet nicht'
      : err instanceof TypeError ? 'Server nicht erreichbar (Internet oder Adresse prüfen)' : err.message;
    state.device.lastAuto = { at: now(), ok: false, error: msg };
    db.setMeta('device', state.device).catch(() => {});
    if (manual) toast(`Abgleich fehlgeschlagen: ${msg}`);
  } finally {
    syncing = false;
    updateSyncStatus();
    if (syncAgain) { syncAgain = false; scheduleSync(500); }
  }
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(300); });
window.addEventListener('online', () => scheduleSync(300));
setInterval(() => { if (document.visibilityState === 'visible') autoSync(); }, 5 * 60 * 1000);

function connectLink() {
  const { syncUrl, syncKey } = state.device;
  return `${location.origin}${location.pathname}#/verbinden?u=${encodeURIComponent(syncUrl)}&k=${encodeURIComponent(syncKey)}`;
}

function viewConnect() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const u = q.get('u') || '';
  let host = '';
  try { host = new URL(u).host; } catch { /* ungültig */ }
  if (!host || !q.get('k')) return '<p class="empty">Der Einrichtungs-Link ist unvollständig.</p><p><a href="#/verwaltung">Zur Verwaltung</a></p>';
  return `
    <div class="intro"><div><h1>Abgleich einrichten</h1><p>Dieses Handy mit dem Server <strong>${esc(host)}</strong> verbinden?</p></div></div>
    <section class="panel narrow">
      <p>Danach gleichen sich Produkte, Kunden und Bestellungen automatisch mit dem Server ab. Was schon auf diesem Handy ist, bleibt erhalten und kommt dazu.</p>
      ${state.device.prefix ? '' : '<p class="warn">Bitte danach unter Verwaltung dein Kürzel eintragen (z. B. B).</p>'}
      <div class="actions"><button class="primary" data-action="connect">Verbinden</button><a class="button" href="#/verwaltung">Abbrechen</a></div>
    </section>`;
}

const main = document.getElementById('main');

function emptyDraft() {
  return { orderId: '', customerId: '', customerName: '', items: [], pickupDate: '', note: '' };
}

// ---------- Hilfen ----------

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const byName = (a, b) => a.name.localeCompare(b.name, 'de');
const sortProducts = (list) => [...list].sort((a, b) => (CATEGORIES.indexOf(a.category) + 1 || 99) - (CATEGORIES.indexOf(b.category) + 1 || 99) || (a.sort ?? 999) - (b.sort ?? 999) || byName(a, b));
const product = (id) => state.products.find((p) => p.id === id);
const customer = (id) => state.customers.find((c) => c.id === id);
const order = (id) => state.orders.find((o) => o.id === id);

let toastTimer;
function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function priceText(p) {
  if (p.unit === 'kg') return `${formatEuro(p.priceCents)} <small>pro kg</small>`;
  return `${formatEuro(p.priceCents)} <small>${p.size ? `für ${esc(p.size)}` : 'pro Stück'}</small>`;
}

function photoOrPlaceholder(p, cls = 'photo') {
  if (p.photo) return `<img class="${cls}" src="${p.photo}" alt="${esc(p.name)}" data-action="zoom" data-id="${p.id}" loading="lazy">`;
  return `<div class="${cls} placeholder" aria-hidden="true"><span>${esc(p.name.slice(0, 1))}</span></div>`;
}

function saveDraft() {
  db.setMeta('draft', state.draft).catch(() => {});
  updateCartChip();
}

function updateCartChip() {
  const chip = document.getElementById('cart-chip');
  const n = itemCount(state.draft.items);
  chip.hidden = n === 0;
  chip.textContent = n ? `${n} ${n === 1 ? 'Position' : 'Positionen'} · ${formatEuro(orderTotal(state.draft.items))}` : '';
}

/** Bild verkleinern (max. 900 px), damit viele Produkte aufs Handy passen. */
function resizeImage(file, max = 900) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht gelesen werden.')); };
    img.src = url;
  });
}

// ---------- Ansichten ----------

function viewShowroom() {
  const active = sortProducts(state.products.filter((p) => p.active !== false));
  const cats = [...new Set(active.map((p) => p.category).filter(Boolean))];
  const shown = state.category ? active.filter((p) => p.category === state.category) : active;
  const inDraft = Object.fromEntries(state.draft.items.map((i) => [i.productId, i.qty]));
  return `
    <section class="hero">
      <p class="eyebrow">Das Beste vom Wild</p>
      <h1>${esc(state.settings.businessName)}</h1>
      <p>Echter Geschmack. Kein Kompromiss.</p>
    </section>
    <div class="chips" role="group" aria-label="Kategorie">
      <button data-action="category" data-cat="" aria-pressed="${!state.category}">Alle</button>
      ${cats.map((c) => `<button data-action="category" data-cat="${esc(c)}" aria-pressed="${state.category === c}">${esc(c)}</button>`).join('')}
    </div>
    ${shown.length ? '' : '<p class="empty">Noch keine Produkte. Unter „Verwaltung“ anlegen.</p>'}
    <div class="grid">
      ${shown.map((p) => `
        <article class="card">
          ${photoOrPlaceholder(p)}
          <div class="card-body">
            <p class="cat">${esc(p.category)}</p>
            <h2>${esc(p.name)}</h2>
            ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
            <p class="price">${priceText(p)}</p>
            <button class="add" data-action="add" data-id="${p.id}">
              ${inDraft[p.id] ? `In Bestellung: ${formatQty(inDraft[p.id])}${p.unit === 'kg' ? ' kg' : ''} · +${formatQty(stepFor(p.unit))}` : `+ ${p.unit === 'kg' ? '0,5 kg' : '1'} in Bestellung`}
            </button>
          </div>
        </article>`).join('')}
    </div>`;
}

function viewDraft() {
  const d = state.draft;
  const total = orderTotal(d.items);
  const c = customer(d.customerId);
  const active = sortProducts(state.products.filter((p) => p.active !== false));
  return `
    <div class="intro">
      <div><h1>${d.orderId ? `Bestellung ${esc(order(d.orderId)?.number || '')} bearbeiten` : 'Neue Bestellung'}</h1>
      <p>Kunde wählen, Mengen eintragen, speichern und verschicken.</p></div>
      ${d.items.length || d.customerId ? '<button data-action="draft-clear">Leeren</button>' : ''}
    </div>
    <div class="layout">
      <section class="panel">
        <h2>Kunde</h2>
        <label class="field">Name oder Telefon
          <input id="draft-customer" list="customer-list" autocomplete="off" value="${esc(c ? c.name : d.customerName)}" placeholder="Kunde suchen oder neu eingeben">
        </label>
        <datalist id="customer-list">${[...state.customers].sort(byName).map((x) => `<option value="${esc(x.name)}">${esc(x.phone || x.email || '')}</option>`).join('')}</datalist>
        ${c ? `<p class="hint">✓ ${esc([c.phone, c.email, c.telegram && '@' + c.telegram.replace(/^@/, '')].filter(Boolean).join(' · ') || 'Keine Kontaktdaten hinterlegt')}</p>`
            : d.customerName ? `<p class="hint">Neuer Kunde – wird beim Speichern in der Kartei angelegt. <a href="#/kunde/neu">Mit Telefon/Mail anlegen</a></p>` : ''}

        <h2 class="gap">Positionen</h2>
        ${d.items.length ? '' : '<p class="empty">Noch nichts ausgewählt. Unten oder im Showroom Produkte hinzufügen.</p>'}
        <ul class="lines">
          ${d.items.map((i) => `
            <li>
              <div class="line-name"><strong>${esc(i.name)}</strong><small>${i.unit === 'kg' ? `${formatEuro(i.priceCents)} pro kg` : `${formatEuro(i.priceCents)}${i.size ? ` für ${esc(i.size)}` : ' pro Stück'}`}</small></div>
              <div class="stepper">
                <button data-action="qty-minus" data-id="${i.productId}" aria-label="weniger">−</button>
                <input inputmode="decimal" data-action="qty-input" data-id="${i.productId}" value="${formatQty(i.qty)}" aria-label="Menge ${esc(i.name)}">
                <span class="unit">${i.unit === 'kg' ? 'kg' : 'x'}</span>
                <button data-action="qty-plus" data-id="${i.productId}" aria-label="mehr">+</button>
              </div>
              <strong class="line-total">${formatEuro(lineTotal(i))}</strong>
            </li>`).join('')}
        </ul>
        <div class="total"><span>Gesamt</span><strong>${formatEuro(total)}</strong></div>

        <div class="two">
          <label class="field">Abholung am<input type="date" id="draft-pickup" value="${esc(d.pickupDate)}"></label>
          <label class="field">Hinweis<input id="draft-note" value="${esc(d.note)}" placeholder="z. B. dünn schneiden"></label>
        </div>
        <button class="primary wide" data-action="draft-save" ${d.items.length ? '' : 'disabled'}>${d.orderId ? 'Änderungen speichern' : 'Bestellung speichern'} · ${formatEuro(total)}</button>
      </section>
      <aside class="panel">
        <h2>Schnell hinzufügen</h2>
        <ul class="quick">
          ${active.map((p) => `<li><button data-action="add" data-id="${p.id}"><span>${esc(p.name)}${p.size ? ` <small>${esc(p.size)}</small>` : ''}</span><b>${formatEuro(p.priceCents)}${p.unit === 'kg' ? '/kg' : ''}</b></button></li>`).join('')}
        </ul>
      </aside>
    </div>`;
}

function viewCustomers() {
  const list = state.customers.filter((c) => matches(c, state.customerQuery)).sort(byName);
  return `
    <div class="intro">
      <div><h1>Kunden</h1><p>${state.customers.length} in der Kartei</p></div>
      <a class="button primary" href="#/kunde/neu">+ Kunde</a>
    </div>
    <label class="field search">Suchen<input id="customer-search" type="search" value="${esc(state.customerQuery)}" placeholder="Name, Telefon, Ort …"></label>
    <section class="panel">
      ${list.length ? '' : `<p class="empty">${state.customers.length ? 'Kein Treffer.' : 'Noch keine Kunden angelegt.'}</p>`}
      ${list.map((c) => {
        const orders = state.orders.filter((o) => o.customerId === c.id);
        return `<a class="row link" href="#/kunde/${c.id}">
          <div><strong>${esc(c.name)}</strong><p class="hint">${esc([c.phone, c.email].filter(Boolean).join(' · ') || 'keine Kontaktdaten')}</p></div>
          <span class="hint">${orders.length} ${orders.length === 1 ? 'Bestellung' : 'Bestellungen'}</span>
        </a>`;
      }).join('')}
    </section>`;
}

function viewCustomer(id) {
  const isNew = id === 'neu';
  const c = isNew ? { name: state.draft.customerId ? '' : state.draft.customerName, phone: '', email: '', telegram: '', address: '', notes: '' } : customer(id);
  if (!c) return '<p class="empty">Kunde nicht gefunden.</p>';
  const orders = isNew ? [] : state.orders.filter((o) => o.customerId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return `
    <p><a href="#/kunden">← Kunden</a></p>
    <div class="intro"><h1>${isNew ? 'Neuer Kunde' : esc(c.name)}</h1>
      ${isNew ? '' : `<button class="primary" data-action="order-for" data-id="${id}">+ Bestellung</button>`}</div>
    <div class="layout">
      <form class="panel" id="customer-form" data-id="${isNew ? '' : id}">
        <label class="field">Name *<input name="name" required value="${esc(c.name)}" autocomplete="off"></label>
        <label class="field">Telefon / WhatsApp<input name="phone" type="tel" value="${esc(c.phone)}" placeholder="0171 1234567"></label>
        <label class="field">E-Mail<input name="email" type="email" value="${esc(c.email)}"></label>
        <label class="field">Telegram-Name<input name="telegram" value="${esc(c.telegram)}" placeholder="@name (optional)"></label>
        <label class="field">Adresse<input name="address" value="${esc(c.address)}"></label>
        <label class="field">Notiz<textarea name="notes" rows="2">${esc(c.notes)}</textarea></label>
        <div class="actions">
          <button class="primary" type="submit">Speichern</button>
          ${isNew ? '' : '<button type="button" class="danger" data-action="customer-delete">Löschen</button>'}
        </div>
      </form>
      ${isNew ? '' : `<section class="panel"><h2>Bestellungen</h2>
        ${orders.length ? '' : '<p class="empty">Noch keine.</p>'}
        ${orders.map(orderRow).join('')}
      </section>`}
    </div>`;
}

function orderRow(o) {
  const c = customer(o.customerId);
  return `<a class="row link" href="#/auftrag/${o.id}">
    <div><strong>${esc(o.number)} · ${esc(c?.name || o.customerName || 'ohne Kunde')}</strong>
    <p class="hint">${formatDate(o.createdAt)}${o.pickupDate ? ` · Abholung ${formatDate(o.pickupDate)}` : ''}</p></div>
    <div class="row-end"><span class="status s-${o.status}">${STATUS[o.status] || o.status}</span><strong>${formatEuro(orderTotal(o.items))}</strong></div>
  </a>`;
}

function viewOrders() {
  const f = state.orderFilter;
  const list = state.orders.filter((o) => f === 'alle' || o.status === f).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const open = state.orders.filter((o) => o.status === 'offen' || o.status === 'verschickt');
  return `
    <div class="intro"><div><h1>Verlauf</h1><p>${state.orders.length} Bestellungen · offen ${formatEuro(open.reduce((s, o) => s + orderTotal(o.items), 0))}</p></div>
      <a class="button primary" href="#/bestellung">+ Bestellung</a></div>
    <div class="chips" role="group" aria-label="Status">
      ${['alle', ...Object.keys(STATUS)].map((k) => `<button data-action="order-filter" data-f="${k}" aria-pressed="${f === k}">${k === 'alle' ? 'Alle' : STATUS[k]}</button>`).join('')}
    </div>
    <section class="panel">${list.length ? list.map(orderRow).join('') : '<p class="empty">Keine Bestellungen.</p>'}</section>`;
}

function viewOrder(id) {
  const o = order(id);
  if (!o) return '<p class="empty">Bestellung nicht gefunden.</p>';
  const c = customer(o.customerId);
  const text = orderMessage(o, c || { name: o.customerName }, state.settings);
  const phone = normalizePhone(c?.phone, state.settings.countryCode);
  const tgChat = telegramChatLink(c?.telegram);
  return `
    <p><a href="#/verlauf">← Verlauf</a></p>
    <div class="intro"><div><h1>Bestellung ${esc(o.number)}</h1>
      <p>${formatDate(o.createdAt)} · ${c ? `<a href="#/kunde/${c.id}">${esc(c.name)}</a>` : esc(o.customerName || 'ohne Kunde')}</p></div>
      <label class="field inline">Status
        <select data-action="order-status" data-id="${o.id}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </label></div>
    <div class="layout">
      <section class="panel">
        <ul class="lines readonly">${o.items.map((i) => `<li><div class="line-name"><strong>${i.unit === 'kg' ? `${formatQty(i.qty)} kg` : `${formatQty(i.qty)} ×`} ${esc(i.name)}</strong>
          <small>${i.unit === 'kg' ? `${formatEuro(i.priceCents)} pro kg` : `${formatEuro(i.priceCents)}${i.size ? ` für ${esc(i.size)}` : ''}`}</small></div><strong class="line-total">${formatEuro(lineTotal(i))}</strong></li>`).join('')}</ul>
        <div class="total"><span>Gesamt</span><strong>${formatEuro(orderTotal(o.items))}</strong></div>
        ${o.pickupDate ? `<p>Abholung: <strong>${formatDate(o.pickupDate)}</strong></p>` : ''}
        ${o.note ? `<p>Hinweis: ${esc(o.note)}</p>` : ''}
        ${o.sentAt ? `<p class="hint">Zuletzt verschickt ${formatDate(o.sentAt)} per ${esc(o.sentVia)}</p>` : ''}
        <div class="actions"><button data-action="order-edit" data-id="${o.id}">Bearbeiten</button>
          <button class="danger" data-action="order-delete" data-id="${o.id}">Löschen</button></div>
      </section>
      <section class="panel send">
        <h2>Verschicken</h2>
        <div class="send-buttons">
          <a class="button wa ${phone ? '' : 'off'}" ${phone ? `href="${esc(whatsappLink(c.phone, text, state.settings.countryCode))}" target="_blank" rel="noopener"` : 'aria-disabled="true"'} data-action="sent" data-via="WhatsApp" data-id="${o.id}">WhatsApp</a>
          <a class="button tg" href="${esc(telegramLink(text))}" target="_blank" rel="noopener" data-action="sent" data-via="Telegram" data-id="${o.id}">Telegram</a>
          <a class="button mail ${c?.email ? '' : 'off'}" ${c?.email ? `href="${esc(mailLink(c.email, orderSubject(o, state.settings), text))}"` : 'aria-disabled="true"'} data-action="sent" data-via="E-Mail" data-id="${o.id}">E-Mail</a>
          ${navigator.share ? `<button data-action="share" data-id="${o.id}">Teilen …</button>` : ''}
          <button data-action="copy" data-id="${o.id}">Text kopieren</button>
        </div>
        ${!phone ? `<p class="hint">WhatsApp: beim Kunden fehlt die Telefonnummer.</p>` : ''}
        ${!c?.email ? `<p class="hint">E-Mail: beim Kunden fehlt die Adresse.</p>` : ''}
        <p class="hint">Telegram öffnet den Teilen-Dialog, dort den Kontakt wählen.${tgChat ? ` <a href="${esc(tgChat)}" target="_blank" rel="noopener">Chat mit @${esc(c.telegram.replace(/^@/, ''))} öffnen</a>` : ''}</p>
        <label class="field">Nachricht (Vorschau)<textarea readonly rows="12">${esc(text)}</textarea></label>
      </section>
    </div>`;
}

function viewAdmin() {
  const s = state.settings;
  return `
    <div class="intro"><div><h1>Verwaltung</h1><p>Produkte, Texte und Datensicherung</p></div>
      <a class="button primary" href="#/produkt/neu">+ Produkt</a></div>
    <div class="layout">
      <section class="panel">
        <h2>Produkte (${state.products.length})</h2>
        ${sortProducts(state.products).map((p) => `<a class="row link prod" href="#/produkt/${p.id}">
          ${photoOrPlaceholder(p, 'thumb')}
          <div><strong>${esc(p.name)}${p.active === false ? ' <span class="status s-storniert">ausgeblendet</span>' : ''}</strong><p class="hint">${esc(p.category)}${p.size ? ` · ${esc(p.size)}` : ''}</p></div>
          <strong>${formatEuro(p.priceCents)}${p.unit === 'kg' ? '/kg' : ''}</strong></a>`).join('')}
      </section>
      <div class="stack">
        ${viewSync()}
        <form class="panel" id="settings-form">
          <h2>Betrieb &amp; Nachricht</h2>
          <label class="field">Name des Betriebs<input name="businessName" value="${esc(s.businessName)}"></label>
          <label class="field">Untertitel<input name="subtitle" value="${esc(s.subtitle)}"></label>
          <label class="field">Kontakt unter jeder Nachricht<textarea name="contact" rows="3" placeholder="Telefon, Adresse, Öffnungszeiten">${esc(s.contact)}</textarea></label>
          <label class="field">Schlusssatz<input name="greeting" value="${esc(s.greeting)}"></label>
          <label class="field">Ländervorwahl für Handynummern<input name="countryCode" inputmode="numeric" value="${esc(s.countryCode)}"></label>
          <button class="primary" type="submit">Speichern</button>
        </form>
        <section class="panel">
          <h2>Datensicherung</h2>
          <p class="hint">Alle Daten liegen nur auf diesem Gerät. Regelmäßig eine Sicherung exportieren (z. B. in iCloud Drive oder per Mail an dich).</p>
          <div class="actions">
            <button data-action="backup-export">Sicherung exportieren</button>
            <label class="button">Sicherung einspielen<input type="file" accept="application/json,.json" id="backup-import" hidden></label>
          </div>
          <details><summary>Weitere</summary>
            <div class="actions">
              <button data-action="load-test-customers">Testkunden laden</button>
              <button data-action="reset-products">Startsortiment neu laden</button>
              <button class="danger" data-action="wipe">Alle Daten löschen</button>
            </div>
          </details>
        </section>
      </div>
    </div>`;
}

function viewSync() {
  const prefix = state.device.prefix;
  const ls = state.lastSync;
  const dups = duplicateNumbers(state.orders);
  const time = (iso) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return `
    <form class="panel sync" id="device-form">
      <h2>Abgleich per Datei</h2>
      <ol class="steps">
        <li>Jeder trägt einmal sein eigenes Kürzel ein (z. B. <b>M</b> und <b>B</b>), dann gibt es keine doppelten Bestellnummern.</li>
        <li><b>Abgleich senden</b> und die Datei per AirDrop, Nachrichten oder iCloud Drive an den anderen schicken.</li>
        <li>Der andere tippt <b>Abgleich einspielen</b> und wählt die Datei. Neues kommt dazu, bei Änderungen gewinnt die neuere, Gelöschtes bleibt gelöscht.</li>
        <li>Danach dasselbe in die andere Richtung, dann haben beide den gleichen Stand.</li>
      </ol>
      <div class="two">
        <label class="field">Kürzel dieses Handys<input name="prefix" maxlength="4" autocapitalize="characters" value="${esc(prefix)}" placeholder="z. B. M"></label>
        <div class="field"><span>&nbsp;</span><button type="submit">Kürzel speichern</button></div>
      </div>
      ${prefix ? `<p class="hint">Nächste Bestellnummer: ${esc(nextOrderNumber(state.orders, new Date(), prefix))}</p>` : '<p class="warn">Noch kein Kürzel, bitte zuerst eintragen.</p>'}
      <div class="actions">
        <button type="button" class="primary" data-action="sync-send">Abgleich senden</button>
        <label class="button">Abgleich einspielen<input type="file" accept="application/json,.json" id="sync-import" hidden></label>
      </div>
      ${ls ? `<p class="hint">Zuletzt eingespielt: ${formatDate(ls.at)} ${time(ls.at)} von „${esc(ls.from)}“ · ${ls.added} neu, ${ls.updated} aktualisiert, ${ls.removed} gelöscht</p>` : ''}
      ${dups.length ? `<p class="warn">Doppelte Bestellnummern: ${dups.map(esc).join(', ')} (entstanden ohne Kürzel). Die Bestellungen sind trotzdem getrennt gespeichert.</p>` : ''}
    </form>
    <form class="panel sync" id="server-form">
      <h2>Automatischer Abgleich (Synology)</h2>
      <p class="hint">Mit Adresse und Schlüssel gleicht die App von selbst ab: beim Öffnen, nach jeder Änderung und alle 5 Minuten. Ohne Netz arbeitet sie ganz normal weiter und holt den Abgleich später nach.</p>
      <label class="field">Adresse des Servers (oder Einrichtungs-Link einfügen)<input name="syncUrl" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(state.device.syncUrl || '')}" placeholder="https://… oder Link"></label>
      <label class="field">Schlüssel<input name="syncKey" type="password" autocomplete="off" value="${esc(state.device.syncKey || '')}"></label>
      <div class="actions">
        <button type="submit">Speichern</button>
        ${state.device.syncUrl ? `<button type="button" class="primary" data-action="sync-now">Jetzt abgleichen</button>
        <button type="button" data-action="share-connect">Link für den Bruder</button>
        <button type="button" class="danger" data-action="sync-disconnect">Trennen</button>` : ''}
      </div>
      <p class="hint" id="sync-status">${esc(syncStatusText())}</p>
    </form>`;
}

function viewProduct(id) {
  const isNew = id === 'neu';
  const p = isNew ? { name: '', category: '', unit: 'Stück', priceCents: 0, size: '', description: '', photo: '', active: true } : product(id);
  if (!p) return '<p class="empty">Produkt nicht gefunden.</p>';
  const cats = [...new Set([...CATEGORIES, ...state.products.map((x) => x.category).filter(Boolean)])];
  return `
    <p><a href="#/verwaltung">← Verwaltung</a></p>
    <div class="intro"><h1>${isNew ? 'Neues Produkt' : esc(p.name)}</h1></div>
    <form class="panel narrow" id="product-form" data-id="${isNew ? '' : id}">
      <div class="photo-edit">
        <div id="photo-preview">${photoOrPlaceholder(p, 'photo')}</div>
        <div class="actions">
          <label class="button">Foto wählen<input type="file" accept="image/*" id="photo-input" hidden></label>
          ${p.photo ? '<button type="button" data-action="photo-remove">Foto entfernen</button>' : ''}
        </div>
      </div>
      <label class="field">Name *<input name="name" required value="${esc(p.name)}"></label>
      <label class="field">Kategorie<input name="category" list="cat-list" value="${esc(p.category)}"></label>
      <datalist id="cat-list">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      <div class="two">
        <label class="field">Preis in € *<input name="price" inputmode="decimal" required value="${p.priceCents ? centsToInput(p.priceCents) : ''}" placeholder="7,00"></label>
        <label class="field">Abrechnung<select name="unit">
          <option value="Stück" ${p.unit !== 'kg' ? 'selected' : ''}>pro Stück / Packung</option>
          <option value="kg" ${p.unit === 'kg' ? 'selected' : ''}>pro kg</option></select></label>
      </div>
      <label class="field">Inhalt / Packung<input name="size" value="${esc(p.size)}" placeholder="z. B. 4 Stück, Dose 400 g"></label>
      <label class="field">Beschreibung<textarea name="description" rows="2">${esc(p.description)}</textarea></label>
      <label class="check"><input type="checkbox" name="active" ${p.active !== false ? 'checked' : ''}> Im Showroom zeigen</label>
      <div class="actions">
        <button class="primary" type="submit">Speichern</button>
        ${isNew ? '' : '<button type="button" class="danger" data-action="product-delete">Löschen</button>'}
      </div>
    </form>`;
}

// ---------- Routing ----------

let pendingPhoto; // neues Foto im Produktformular (undefined = unverändert, '' = entfernt)

function route() {
  if (location.hash.startsWith('#/verbinden')) {
    main.innerHTML = viewConnect();
    return;
  }
  const [, view = 'showroom', id] = (location.hash || '#/showroom').split('/');
  const navKey = { kunde: 'kunden', auftrag: 'verlauf', produkt: 'verwaltung' }[view] || view;
  for (const a of document.querySelectorAll('#nav a')) {
    if (a.dataset.nav === navKey) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  pendingPhoto = undefined;
  const html = {
    showroom: viewShowroom,
    bestellung: viewDraft,
    kunden: viewCustomers,
    kunde: () => viewCustomer(id),
    verlauf: viewOrders,
    auftrag: () => viewOrder(id),
    verwaltung: viewAdmin,
    produkt: () => viewProduct(id),
  }[view];
  main.innerHTML = html ? html() : viewShowroom();
  document.getElementById('brand-name').textContent = state.settings.businessName;
  document.getElementById('brand-sub').textContent = state.settings.subtitle;
  document.title = `${state.settings.subtitle || 'Showroom'} · ${state.settings.businessName}`;
  updateCartChip();
}

function rerender() {
  const y = window.scrollY;
  route();
  window.scrollTo(0, y);
}

window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });

// ---------- Aktionen ----------

async function saveOrderFromDraft() {
  const d = state.draft;
  syncDraftFields();
  if (!d.items.length) return;
  let c = customer(d.customerId);
  const name = d.customerName.trim();
  if (!c && name) {
    c = state.customers.find((x) => x.name.trim().toLowerCase() === name.toLowerCase());
    if (!c) {
      c = { id: newId(), name, phone: '', email: '', telegram: '', address: '', notes: '', updatedAt: now() };
      await db.put('customers', c);
      state.customers.push(c);
      toast(`Kunde „${name}“ angelegt`);
    }
  }
  const existing = d.orderId && order(d.orderId);
  const o = existing
    ? { ...existing, customerId: c?.id || '', customerName: c?.name || name, items: d.items, pickupDate: d.pickupDate, note: d.note, updatedAt: new Date().toISOString() }
    : { id: newId(), number: nextOrderNumber(state.orders, new Date(), state.device.prefix), createdAt: now(), updatedAt: now(), status: 'offen',
        customerId: c?.id || '', customerName: c?.name || name, items: d.items, pickupDate: d.pickupDate, note: d.note };
  await db.put('orders', o);
  state.orders = [...state.orders.filter((x) => x.id !== o.id), o];
  scheduleSync();
  state.draft = emptyDraft();
  saveDraft();
  location.hash = `#/auftrag/${o.id}`;
  if (!c?.phone && !c?.email) toast('Gespeichert. Für WhatsApp/Mail fehlen beim Kunden noch Kontaktdaten.');
  else toast('Bestellung gespeichert');
}

function syncDraftFields() {
  const d = state.draft;
  const cust = document.getElementById('draft-customer');
  if (cust) {
    const v = cust.value.trim();
    const hit = state.customers.find((c) => c.name === v) || state.customers.find((c) => v && normalizePhone(c.phone) === normalizePhone(v));
    d.customerId = hit?.id || '';
    d.customerName = hit ? hit.name : v;
  }
  const pick = document.getElementById('draft-pickup');
  if (pick) d.pickupDate = pick.value;
  const note = document.getElementById('draft-note');
  if (note) d.note = note.value;
}

function changeQty(id, delta) {
  syncDraftFields();
  const item = state.draft.items.find((i) => i.productId === id);
  if (!item) return;
  state.draft.items = setQty(state.draft.items, id, cleanQty(item.qty + delta * stepFor(item.unit), item.unit));
  saveDraft();
  rerender();
}

async function markSent(id, via) {
  const o = order(id);
  if (!o) return;
  o.sentAt = now();
  o.updatedAt = o.sentAt;
  scheduleSync();
  o.sentVia = via;
  if (o.status === 'offen') o.status = 'verschickt';
  await db.put('orders', o);
  setTimeout(rerender, 400);
}

function download(name, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) return navigator.share({ files: [file], title: name }).catch(() => {});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;
  try {
    switch (action) {
      case 'category': state.category = el.dataset.cat; rerender(); break;
      case 'add': {
        syncDraftFields();
        const p = product(id);
        state.draft.items = addItem(state.draft.items, p);
        saveDraft();
        rerender();
        toast(`${p.name} hinzugefügt`);
        break;
      }
      case 'zoom': {
        const dlg = document.getElementById('photo-dialog');
        dlg.querySelector('img').src = product(id).photo;
        dlg.showModal();
        break;
      }
      case 'qty-minus': changeQty(id, -1); break;
      case 'qty-plus': changeQty(id, 1); break;
      case 'draft-clear':
        if (confirm('Aktuelle Bestellung verwerfen?')) { state.draft = emptyDraft(); saveDraft(); rerender(); }
        break;
      case 'draft-save': el.disabled = true; await saveOrderFromDraft(); break;
      case 'order-for':
        state.draft = { ...emptyDraft(), customerId: id, customerName: customer(id).name };
        saveDraft();
        location.hash = '#/bestellung';
        break;
      case 'order-filter': state.orderFilter = el.dataset.f; rerender(); break;
      case 'order-edit': {
        const o = order(id);
        if (state.draft.items.length && !confirm('Die angefangene Bestellung wird dabei verworfen. Weiter?')) break;
        state.draft = { orderId: o.id, customerId: o.customerId, customerName: o.customerName || '', items: o.items.map((i) => ({ ...i })), pickupDate: o.pickupDate || '', note: o.note || '' };
        saveDraft();
        location.hash = '#/bestellung';
        break;
      }
      case 'order-delete':
        if (confirm(`Bestellung ${order(id).number} löschen? Das lässt sich nicht rückgängig machen.`)) {
          await db.remove('orders', id);
          await bury(id);
          state.orders = state.orders.filter((o) => o.id !== id);
          location.hash = '#/verlauf';
        }
        break;
      case 'sent':
        if (el.classList.contains('off')) { ev.preventDefault(); toast('Beim Kunden fehlen die Kontaktdaten dafür.'); break; }
        await markSent(id, el.dataset.via);
        break;
      case 'share': {
        const o = order(id);
        const c = customer(o.customerId);
        await navigator.share({ title: orderSubject(o, state.settings), text: orderMessage(o, c || { name: o.customerName }, state.settings) });
        await markSent(id, 'Teilen');
        break;
      }
      case 'copy': {
        const o = order(id);
        await navigator.clipboard.writeText(orderMessage(o, customer(o.customerId) || { name: o.customerName }, state.settings));
        toast('Text kopiert');
        break;
      }
      case 'customer-delete': {
        const cid = document.getElementById('customer-form').dataset.id;
        const n = state.orders.filter((o) => o.customerId === cid).length;
        if (!confirm(`Kunde löschen?${n ? ` Die ${n} Bestellungen bleiben mit dem Namen erhalten.` : ''}`)) break;
        await db.remove('customers', cid);
        await bury(cid);
        state.customers = state.customers.filter((c) => c.id !== cid);
        location.hash = '#/kunden';
        break;
      }
      case 'product-delete': {
        const pid = document.getElementById('product-form').dataset.id;
        if (!confirm('Produkt löschen? Alte Bestellungen behalten Name und Preis.')) break;
        await db.remove('products', pid);
        await bury(pid);
        state.products = state.products.filter((p) => p.id !== pid);
        location.hash = '#/verwaltung';
        break;
      }
      case 'photo-remove':
        pendingPhoto = '';
        document.getElementById('photo-preview').innerHTML = '<div class="photo placeholder"><span>–</span></div>';
        el.remove();
        break;
      case 'backup-export': {
        const data = makeBackup(state, new Date(), state.device.prefix);
        await download(`fleischerwerkstatt-sicherung-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data));
        break;
      }
      case 'sync-send': {
        if (!state.device.prefix) { toast('Bitte zuerst dein Kürzel speichern.'); document.querySelector('#device-form input')?.focus(); break; }
        const data = makeBackup(state, new Date(), state.device.prefix);
        await download(`fleischerwerkstatt-abgleich-${state.device.prefix}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`, JSON.stringify(data));
        break;
      }
      case 'sync-now': await autoSync({ manual: true }); break;
      case 'share-connect': {
        const link = connectLink();
        if (navigator.share) await navigator.share({ title: 'Fleischerwerkstatt: Abgleich einrichten', text: 'Fleischerwerkstatt-Abgleich: Link lange drücken → Kopieren, dann in der App unter Verwaltung → Automatischer Abgleich ins Adressfeld einfügen → Speichern. Enthält den Schlüssel, nicht weitergeben!', url: link });
        else { await navigator.clipboard.writeText(link); toast('Einrichtungs-Link kopiert. Nur an deinen Bruder schicken!'); }
        break;
      }
      case 'sync-disconnect':
        if (!confirm('Automatischen Abgleich auf diesem Handy ausschalten? Die Daten bleiben auf dem Handy.')) break;
        state.device = { ...state.device, syncUrl: '', syncKey: '', lastAuto: null };
        await db.setMeta('device', state.device);
        rerender();
        break;
      case 'connect': {
        const q = new URLSearchParams(location.hash.split('?')[1] || '');
        state.device = { ...state.device, syncUrl: q.get('u'), syncKey: q.get('k'), lastAuto: null };
        await db.setMeta('device', state.device);
        history.replaceState(null, '', `${location.pathname}#/verwaltung`); // Schlüssel aus der Adresszeile entfernen
        route();
        await autoSync({ manual: true });
        break;
      }
      case 'load-test-customers': {
        for (const c of sampleCustomers()) { c.updatedAt = now(); await db.put('customers', c); state.customers.push(c); }
        scheduleSync();
        toast('2 Testkunden angelegt');
        rerender();
        break;
      }
      case 'reset-products':
        if (!confirm('Alle Produkte durch das Startsortiment (18 Produkte mit Plakatfotos) ersetzen?')) break;
        for (const p of state.products) { await db.remove('products', p.id); if (!p.id.startsWith('start-')) await bury(p.id); }
        state.products = startProducts().map((p) => ({ ...p, updatedAt: now() }));
        for (const p of state.products) await db.put('products', p);
        scheduleSync();
        rerender();
        break;
      case 'wipe':
        if (!confirm('Wirklich ALLE Produkte, Kunden und Bestellungen auf diesem Gerät löschen? Vorher eine Sicherung exportieren!')) break;
        await db.replaceAll({ products: [], customers: [], orders: [], settings: state.settings, tombstones: {} });
        Object.assign(state, { products: [], customers: [], orders: [], tombstones: {}, draft: emptyDraft() });
        saveDraft();
        rerender();
        break;
    }
  } catch (err) {
    if (err?.name !== 'AbortError') toast(`Fehler: ${err.message || err}`);
  }
});

document.addEventListener('change', async (ev) => {
  const el = ev.target;
  try {
    if (el.matches('[data-action="order-status"]')) {
      const o = order(el.dataset.id);
      o.status = el.value;
      o.updatedAt = now();
      scheduleSync();
      await db.put('orders', o);
      toast(`Status: ${STATUS[o.status]}`);
    } else if (el.matches('[data-action="qty-input"]')) {
      syncDraftFields();
      state.draft.items = setQty(state.draft.items, el.dataset.id, el.value);
      saveDraft();
      rerender();
    } else if (el.id === 'draft-customer') {
      syncDraftFields();
      saveDraft();
      rerender();
    } else if (el.id === 'draft-pickup' || el.id === 'draft-note') {
      syncDraftFields();
      saveDraft();
    } else if (el.id === 'photo-input' && el.files[0]) {
      pendingPhoto = await resizeImage(el.files[0]);
      document.getElementById('photo-preview').innerHTML = `<img class="photo" src="${pendingPhoto}" alt="">`;
    } else if (el.id === 'backup-import' && el.files[0]) {
      const data = readBackup(await el.files[0].text());
      if (!confirm(`Sicherung einspielen? ${data.products.length} Produkte, ${data.customers.length} Kunden, ${data.orders.length} Bestellungen. Die aktuellen Daten auf diesem Gerät werden ersetzt.`)) return;
      await db.replaceAll(data);
      Object.assign(state, { products: data.products, customers: data.customers, orders: data.orders, settings: data.settings, tombstones: data.tombstones, draft: emptyDraft() });
      saveDraft();
      toast('Sicherung eingespielt');
      rerender();
    } else if (el.id === 'sync-import' && el.files[0]) {
      const incoming = readBackup(await el.files[0].text());
      el.value = '';
      if (incoming.from && incoming.from === state.device.prefix
        && !confirm(`Diese Datei hat dasselbe Kürzel „${incoming.from}“ wie dieses Handy, ist also vermutlich deine eigene. Trotzdem einspielen?`)) return;
      const { data, stats } = mergeData(state, incoming);
      await db.replaceAll(data);
      Object.assign(state, { products: data.products, customers: data.customers, orders: data.orders, settings: data.settings, tombstones: data.tombstones });
      state.lastSync = { at: now(), from: incoming.from || '?', exportedAt: incoming.exportedAt, ...stats };
      await db.setMeta('lastSync', state.lastSync);
      // angefangene Bestellung behalten, gelöschte Produkte daraus entfernen
      state.draft.items = state.draft.items.filter((i) => product(i.productId));
      saveDraft();
      scheduleSync();
      toast(`Abgleich: ${stats.added} neu, ${stats.updated} aktualisiert, ${stats.removed} gelöscht`);
      rerender();
    }
  } catch (err) {
    toast(`Fehler: ${err.message || err}`);
    if (el.type === 'file') el.value = '';
  }
});

document.addEventListener('input', (ev) => {
  if (ev.target.id === 'customer-search') {
    state.customerQuery = ev.target.value;
    const pos = ev.target.selectionStart;
    rerender();
    const s = document.getElementById('customer-search');
    s.focus();
    s.setSelectionRange(pos, pos);
  }
});

document.addEventListener('submit', async (ev) => {
  const form = ev.target;
  ev.preventDefault();
  const f = Object.fromEntries(new FormData(form));
  try {
    if (form.id === 'customer-form') {
      const id = form.dataset.id;
      const c = { ...(id ? customer(id) : { id: newId() }), name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim(), telegram: f.telegram.trim(), address: f.address.trim(), notes: f.notes.trim(), updatedAt: now() };
      if (!c.name) return toast('Bitte einen Namen eingeben.');
      await db.put('customers', c);
      state.customers = [...state.customers.filter((x) => x.id !== c.id), c];
      // Kam der Kunde aus einer angefangenen Bestellung? Dann gleich verknüpfen.
      if (!id && !state.draft.customerId && state.draft.customerName && state.draft.customerName.trim().toLowerCase() === c.name.toLowerCase()) {
        state.draft.customerId = c.id;
        saveDraft();
        scheduleSync();
        toast('Kunde angelegt und in die Bestellung übernommen');
        location.hash = '#/bestellung';
        return;
      }
      scheduleSync();
      toast('Kunde gespeichert');
      location.hash = `#/kunde/${c.id}`;
      if (id) rerender();
    } else if (form.id === 'product-form') {
      const id = form.dataset.id;
      const priceCents = parseEuro(f.price);
      if (!f.name.trim()) return toast('Bitte einen Namen eingeben.');
      if (priceCents === null) return toast('Preis bitte wie 7,00 eingeben.');
      const old = id ? product(id) : { id: newId(), sort: state.products.length };
      const p = { ...old, name: f.name.trim(), category: f.category.trim(), unit: f.unit === 'kg' ? 'kg' : 'Stück', priceCents,
        size: f.size.trim(), description: f.description.trim(), active: f.active === 'on', photo: pendingPhoto === undefined ? old.photo || '' : pendingPhoto, updatedAt: now() };
      await db.put('products', p);
      state.products = [...state.products.filter((x) => x.id !== p.id), p];
      scheduleSync();
      toast('Produkt gespeichert');
      location.hash = '#/verwaltung';
    } else if (form.id === 'settings-form') {
      state.settings = { ...state.settings, ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim()])) };
      state.settings.countryCode = state.settings.countryCode.replace(/\D/g, '') || '49';
      state.settings.updatedAt = now();
      await db.setMeta('settings', state.settings);
      scheduleSync();
      toast('Einstellungen gespeichert');
      rerender();
    } else if (form.id === 'server-form') {
      let url = String(f.syncUrl || '').trim().replace(/\/+$/, '');
      let key = String(f.syncKey || '').trim();
      // Eingefügter Einrichtungs-Link (iPhone: Home-Bildschirm-App kann Links nicht direkt öffnen)
      const pasted = /#\/verbinden\?(.+)$/.exec(url);
      if (pasted) {
        const q = new URLSearchParams(pasted[1]);
        url = (q.get('u') || '').replace(/\/+$/, '');
        key = q.get('k') || '';
      }
      if (url && !/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url)) return toast('Die Adresse muss mit https:// beginnen.');
      if (url && key.length < 24) return toast('Der Schlüssel ist zu kurz.');
      state.device = { ...state.device, syncUrl: url, syncKey: key, lastAuto: null };
      await db.setMeta('device', state.device);
      rerender();
      if (url) await autoSync({ manual: true });
    } else if (form.id === 'device-form') {
      const prefix = String(f.prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
      if (!prefix) return toast('Bitte ein Kürzel aus Buchstaben eingeben, z. B. M.');
      state.device = { ...state.device, prefix };
      await db.setMeta('device', state.device);
      toast(`Kürzel ${prefix}: nächste Bestellung ${nextOrderNumber(state.orders, new Date(), prefix)}`);
      rerender();
    }
  } catch (err) {
    toast(`Fehler: ${err.message || err}`);
  }
});

// ---------- Start ----------

async function start() {
  try {
    const [products, customers, orders, settings, draft, seeded, tombstones, device, lastSync] = await Promise.all([
      db.all('products'), db.all('customers'), db.all('orders'), db.getMeta('settings'), db.getMeta('draft'), db.getMeta('seeded'),
      db.getMeta('tombstones'), db.getMeta('device'), db.getMeta('lastSync'),
    ]);
    Object.assign(state, { products, customers, orders, settings: { ...DEFAULT_SETTINGS, ...(settings || {}) }, draft: draft || emptyDraft(),
      tombstones: tombstones || {}, device: { prefix: '', ...(device || {}) }, lastSync: lastSync || null });
    for (const { oldId, product: moved } of migrateStartIds(state.products)) {
      await db.remove('products', oldId);
      await db.put('products', moved);
      state.products = state.products.map((p) => (p.id === oldId ? moved : p));
      for (const i of state.draft.items) if (i.productId === oldId) i.productId = moved.id;
    }
    if (!(await db.getMeta('photosV1'))) {
      for (const p of fillStartPhotos(state.products)) {
        await db.put('products', p);
        state.products = state.products.map((x) => (x.id === p.id ? p : x));
      }
      await db.setMeta('photosV1', true);
    }
    if (!seeded && !products.length) {
      state.products = startProducts();
      for (const p of state.products) await db.put('products', p);
      await db.setMeta('seeded', true);
    }
    db.askPersistent();
  } catch (err) {
    main.innerHTML = `<p class="empty">Speicher nicht verfügbar: ${esc(err.message || err)}. Im privaten Modus funktioniert die App nicht.</p>`;
    return;
  }
  route();
  updateSyncStatus();
  autoSync();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
