// Bestellseite für Freunde: Sortiment ansehen, Mengen wählen, bestellen.
// Der Link enthält die Server-Adresse (s) und den Bestell-Schlüssel (t) im #-Teil – der wird nie an GitHub übertragen.
import { formatEuro, formatQty, stepFor, cleanQty, lineTotal, orderTotal, addItem, setQty, formatDate, CATEGORIES } from './logic.mjs';

const main = document.getElementById('shop');
const bar = document.getElementById('shop-bar');
const params = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
const server = (params.get('s') || '').replace(/\/+$/, '');
const token = params.get('t') || '';

const state = { catalog: null, items: [], view: 'auswahl', category: '', sending: false, result: null };

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const product = (id) => state.catalog.products.find((p) => p.id === id);

// Name und Nummer für das nächste Mal merken (nur auf diesem Handy)
const remember = {
  get() { try { return JSON.parse(localStorage.getItem('fw-besteller') || '{}'); } catch { return {}; } },
  set(v) { try { localStorage.setItem('fw-besteller', JSON.stringify(v)); } catch { /* privat-Modus */ } },
};

let toastTimer;
function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function fail(title, text) {
  bar.hidden = true;
  main.innerHTML = `<section class="panel narrow shop-msg"><h1>${esc(title)}</h1><p>${esc(text)}</p></section>`;
}

function priceText(p) {
  if (p.unit === 'kg') return `${formatEuro(p.priceCents)} <small>pro kg</small>`;
  return `${formatEuro(p.priceCents)} <small>${p.size ? `für ${esc(p.size)}` : 'pro Stück'}</small>`;
}

function qtyOf(id) {
  return state.items.find((i) => i.productId === id)?.qty || 0;
}

// ---------- Ansichten ----------

function viewChoose() {
  const c = state.catalog;
  const cats = [...new Set(c.products.map((p) => p.category).filter(Boolean))].sort((a, b) => (CATEGORIES.indexOf(a) + 1 || 99) - (CATEGORIES.indexOf(b) + 1 || 99));
  const shown = state.category ? c.products.filter((p) => p.category === state.category) : c.products;
  return `
    <section class="hero">
      <p class="eyebrow">Das Beste vom Wild</p>
      <h1>${esc(c.businessName)}</h1>
      <p>Such dir aus, was du möchtest – wir melden uns wegen der Abholung.</p>
    </section>
    <div class="chips" role="group" aria-label="Kategorie">
      <button data-action="category" data-cat="" aria-pressed="${!state.category}">Alle</button>
      ${cats.map((k) => `<button data-action="category" data-cat="${esc(k)}" aria-pressed="${state.category === k}">${esc(k)}</button>`).join('')}
    </div>
    <div class="grid">
      ${shown.map((p) => {
        const q = qtyOf(p.id);
        return `
        <article class="card${q ? ' chosen' : ''}">
          ${p.photo ? `<img class="photo" src="${esc(p.photo)}" alt="${esc(p.name)}" data-action="zoom" data-id="${p.id}" loading="lazy">` : `<div class="photo placeholder" aria-hidden="true"><span>${esc(p.name.slice(0, 1))}</span></div>`}
          <div class="card-body">
            <p class="cat">${esc(p.category)}</p>
            <h2>${esc(p.name)}</h2>
            ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
            <p class="price">${priceText(p)}</p>
            ${q ? `<div class="stepper shop-stepper">
                <button data-action="minus" data-id="${p.id}" aria-label="weniger ${esc(p.name)}">−</button>
                <span class="qty">${formatQty(q)}${p.unit === 'kg' ? ' kg' : ''}</span>
                <button data-action="plus" data-id="${p.id}" aria-label="mehr ${esc(p.name)}">+</button>
              </div>`
              : `<button class="add" data-action="plus" data-id="${p.id}">+ ${p.unit === 'kg' ? '0,5 kg' : '1'} hinzufügen</button>`}
          </div>
        </article>`;
      }).join('')}
    </div>`;
}

function linesHtml(items) {
  return `<ul class="lines readonly">${items.map((i) => `<li><div class="line-name"><strong>${i.unit === 'kg' ? `${formatQty(i.qty)} kg` : `${formatQty(i.qty)} ×`} ${esc(i.name)}</strong>
    <small>${i.unit === 'kg' ? `${formatEuro(i.priceCents)} pro kg` : `${formatEuro(i.priceCents)}${i.size ? ` für ${esc(i.size)}` : ''}`}</small></div>
    <strong class="line-total">${formatEuro(lineTotal(i))}</strong></li>`).join('')}</ul>`;
}

function viewCheckout() {
  const me = remember.get();
  const today = new Date();
  const min = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return `
    <p><button class="linkish" data-action="back">← Auswahl ändern</button></p>
    <div class="intro"><div><h1>Deine Bestellung</h1><p>Prüf kurz alles und schick sie ab.</p></div></div>
    <section class="panel">
      ${linesHtml(state.items)}
      <div class="total"><span>Gesamt</span><strong>${formatEuro(orderTotal(state.items))}</strong></div>
    </section>
    <form class="panel" id="order-form" autocomplete="on">
      <label class="field">Dein Name *<input name="name" required autocomplete="name" value="${esc(me.name || '')}" placeholder="Vor- und Nachname"></label>
      <label class="field">Deine Handynummer *<input name="phone" type="tel" required autocomplete="tel" value="${esc(me.phone || '')}" placeholder="0171 1234567"></label>
      <label class="field">E-Mail (freiwillig)<input name="email" type="email" autocomplete="email" value="${esc(me.email || '')}"></label>
      <label class="field">Wunsch-Abholtag (freiwillig)<input name="pickupDate" type="date" min="${min}"></label>
      <label class="field">Hinweis (freiwillig)<textarea name="note" rows="2" maxlength="500" placeholder="z. B. Uhrzeit, Wünsche"></textarea></label>
      <label class="hp" aria-hidden="true">Bitte leer lassen<input name="website" tabindex="-1" autocomplete="off"></label>
      <button class="primary wide" type="submit" ${state.sending ? 'disabled' : ''}>${state.sending ? 'Wird gesendet …' : `Bestellung abschicken · ${formatEuro(orderTotal(state.items))}`}</button>
      <p class="hint">Mit dem Abschicken bekommt ${esc(state.catalog.businessName)} deine Bestellung, deinen Namen und deine Nummer, um sich bei dir zu melden.</p>
    </form>`;
}

function viewThanks() {
  const r = state.result;
  const first = String(remember.get().name || '').trim().split(/\s+/)[0];
  const friends = r.paypalMode === 'freunde' && r.paypal;
  return `
    <section class="panel narrow thanks">
      <p class="eyebrow">Bestellung angekommen</p>
      <h1>Danke${first ? `, ${esc(first)}` : ''}!</h1>
      <p>Wir haben deine Bestellung bekommen und melden uns wegen der Abholung${r.pickupDate ? ` (Wunsch: ${esc(formatDate(r.pickupDate))})` : ''}.</p>
      <ul class="plain">${r.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      <div class="total"><span>Gesamt</span><strong>${formatEuro(r.total)}</strong></div>
      ${r.paymentNote || r.payLink || friends ? `<div class="paybox"><div>
        ${r.paymentNote ? `<p>${esc(r.paymentNote)}</p>` : ''}
        ${friends ? '<p><strong>Bitte als „Freunde &amp; Familie“ senden.</strong></p>' : ''}
      </div>${r.payLink ? `<a class="button primary" href="${esc(r.payLink)}" target="_blank" rel="noopener">Jetzt mit PayPal bezahlen</a>` : ''}</div>` : ''}
      <div class="actions"><button data-action="again">Noch etwas bestellen</button></div>
    </section>`;
}

function render() {
  if (!state.catalog) return;
  document.getElementById('brand-name').textContent = state.catalog.businessName;
  document.title = `Bestellen · ${state.catalog.businessName}`;
  main.innerHTML = state.view === 'kasse' ? viewCheckout() : state.view === 'danke' ? viewThanks() : viewChoose();
  const n = state.items.length;
  bar.hidden = state.view !== 'auswahl' || !n;
  bar.innerHTML = n ? `<div><strong>${formatEuro(orderTotal(state.items))}</strong><small>${n} ${n === 1 ? 'Produkt' : 'Produkte'}</small></div>
    <button class="primary" data-action="checkout">Weiter zur Bestellung</button>` : '';
}

// ---------- Aktionen ----------

function change(id, dir) {
  const p = product(id);
  const cur = qtyOf(id);
  if (dir > 0) state.items = addItem(state.items, p);
  else state.items = setQty(state.items, id, cleanQty(cur - stepFor(p.unit), p.unit));
  render();
}

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;
  if (action === 'category') { state.category = el.dataset.cat; render(); }
  else if (action === 'plus') change(id, 1);
  else if (action === 'minus') change(id, -1);
  else if (action === 'zoom') {
    const dlg = document.getElementById('photo-dialog');
    dlg.querySelector('img').src = product(id).photo;
    dlg.showModal();
  } else if (action === 'checkout') { state.view = 'kasse'; render(); window.scrollTo(0, 0); }
  else if (action === 'back') { state.view = 'auswahl'; render(); }
  else if (action === 'again') { state.items = []; state.result = null; state.view = 'auswahl'; render(); window.scrollTo(0, 0); }
});

document.addEventListener('submit', async (ev) => {
  if (ev.target.id !== 'order-form') return;
  ev.preventDefault();
  if (state.sending) return;
  const f = Object.fromEntries(new FormData(ev.target));
  remember.set({ name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim() });
  state.sending = true;
  render();
  try {
    const res = await fetch(`${server}/api/bestellung`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ t: token, ...f, items: state.items.map((i) => ({ productId: i.productId, qty: i.qty })) }),
      signal: AbortSignal.timeout(20000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Fehler ${res.status}`);
    state.result = body;
    state.view = 'danke';
    state.items = [];
  } catch (err) {
    toast(err instanceof TypeError || err.name === 'TimeoutError' ? 'Keine Verbindung. Bitte gleich noch einmal versuchen.' : err.message);
  } finally {
    state.sending = false;
    render();
    if (state.view === 'danke') window.scrollTo(0, 0);
  }
});

// ---------- Start ----------

async function start() {
  if (!server || !token || !/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(server)) {
    fail('Link unvollständig', 'Dieser Bestell-Link ist nicht vollständig. Bitte den Link noch einmal genau so öffnen, wie du ihn bekommen hast.');
    return;
  }
  try {
    const res = await fetch(`${server}/api/katalog?t=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(15000) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body.error || `Fehler ${res.status}`), { status: res.status });
    state.catalog = body;
  } catch (err) {
    if (err.status === 401) fail('Link nicht mehr gültig', 'Dieser Bestell-Link gilt nicht mehr. Bitte frag nach einem neuen Link.');
    else fail('Gerade nicht erreichbar', 'Die Bestellung ist gerade nicht erreichbar. Bitte versuch es später noch einmal.');
    return;
  }
  if (!state.catalog.open) {
    fail('Gerade keine Bestellungen', 'Bestellungen über diesen Link sind gerade pausiert. Schau bald wieder vorbei!');
    return;
  }
  if (!state.catalog.products.length) {
    fail('Noch nichts im Angebot', 'Gerade gibt es keine Produkte. Schau bald wieder vorbei!');
    return;
  }
  render();
}

start();
