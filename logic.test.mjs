import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatEuro, parseEuro, centsToInput, orderTotal, itemCount, addItem, setQty, nextOrderNumber,
  normalizePhone, orderMessage, whatsappLink, telegramLink, telegramChatLink, mailLink, matches,
  makeBackup, readBackup, sampleData, BACKUP_FORMAT, itemLine, cleanQty, startProducts, STARTSORTIMENT,
} from './public/logic.mjs';

test('Euro formatieren und einlesen', () => {
  assert.equal(formatEuro(1250), '12,50 €');
  assert.equal(formatEuro(0), '0,00 €');
  assert.equal(formatEuro(123456), '1.234,56 €');
  assert.equal(parseEuro('12,50'), 1250);
  assert.equal(parseEuro('12.5'), 1250);
  assert.equal(parseEuro('1.234,56 €'), 123456);
  assert.equal(parseEuro(' 3 '), 300);
  assert.equal(parseEuro('0,1'), 10);
  assert.equal(parseEuro(''), null);
  assert.equal(parseEuro('abc'), null);
  assert.equal(parseEuro('-2'), null);
  assert.equal(parseEuro('1,234'), null);
  assert.equal(centsToInput(1250), '12,50');
  assert.equal(centsToInput(5), '0,05');
});

test('Gesamtpreis ohne Rundungsfehler', () => {
  const items = [
    { productId: 'a', name: 'Wurst', priceCents: 180, qty: 3 },
    { productId: 'b', name: 'Steak', priceCents: 890, qty: 2 },
    { productId: 'c', name: 'Cent', priceCents: 10, qty: 3 },
  ];
  assert.equal(orderTotal(items), 540 + 1780 + 30);
  assert.equal(itemCount(items), 3);
  assert.equal(orderTotal([]), 0);
});

test('Positionen hinzufügen, erhöhen, entfernen; Preis wird kopiert', () => {
  const wurst = { id: 'w', name: 'Wurst', priceCents: 180 };
  let items = addItem([], wurst);
  items = addItem(items, wurst, 2);
  assert.deepEqual(items, [{ productId: 'w', name: 'Wurst', size: '', priceCents: 180, unit: 'Stück', qty: 3 }]);
  wurst.priceCents = 999; // späterer Preiswechsel ändert die Bestellung nicht
  assert.equal(items[0].priceCents, 180);
  items = setQty(items, 'w', 5);
  assert.equal(items[0].qty, 5);
  assert.deepEqual(setQty(items, 'w', 0), []);
  assert.deepEqual(addItem(items, wurst, -5), []);
});

test('kg-Produkte: halbe Kilo, Cent-genau gerundet', () => {
  const hack = { id: 'h', name: 'Wildhackfleisch', priceCents: 1700, unit: 'kg' };
  let items = addItem([], hack);
  assert.equal(items[0].qty, 0.5);
  items = addItem(items, hack);
  assert.equal(items[0].qty, 1);
  items = setQty(items, 'h', '1,25');
  assert.equal(orderTotal(items), 2125);
  items = setQty(items, 'h', 0.333);
  assert.equal(orderTotal(items), 566); // 566,1 → 566
  assert.equal(itemLine({ name: 'Wildhackfleisch', unit: 'kg', priceCents: 1700, qty: 1.5 }), '1,5 kg Wildhackfleisch à 17,00 €/kg = 25,50 €');
  assert.equal(itemLine({ name: 'Wildschwein-Bratwurst', size: '4 Stück', unit: 'Stück', priceCents: 700, qty: 2 }), '2 × Wildschwein-Bratwurst (4 Stück) à 7,00 € = 14,00 €');
  assert.equal(cleanQty('2,6', 'Stück'), 3);
  assert.equal(cleanQty('-1', 'kg'), 0);
  assert.equal(cleanQty('abc'), 0);
});

test('Startsortiment entspricht den Plakaten', () => {
  const products = startProducts();
  assert.equal(products.length, 18);
  const find = (name, size = '') => products.find((p) => p.name === name && p.size === size);
  assert.equal(find('Hirschsalami').priceCents, 1000);
  assert.equal(find('Chilli con Carne', 'Dose 800 g').priceCents, 1400);
  assert.equal(find('Wildhackfleisch').unit, 'kg');
  assert.equal(find('Marinierte Wildschwein-Rückensteaks').priceCents, 3000);
  assert.equal(find('Rehgulasch').priceCents, 1800);
  assert.equal(find('Rehgulasch', 'Dose 400 g').priceCents, 900);
  assert.equal(find('Wildfleischkäse mit Käse', '1-kg-Schale').priceCents, 1300);
  assert.equal(products.filter((p) => p.unit === 'kg').length, 5);
  assert.equal(new Set(products.map((p) => p.id)).size, 18);
  assert.equal(STARTSORTIMENT.length, 18);
});

test('Bestellnummern laufen pro Jahr hoch', () => {
  const d = new Date('2026-11-22T10:00:00');
  assert.equal(nextOrderNumber([], d), '2026-0001');
  assert.equal(nextOrderNumber([{ number: '2026-0007' }, { number: '2025-0042' }, { number: '2026-0003' }], d), '2026-0008');
  assert.equal(nextOrderNumber([{ number: '2025-0042' }], d), '2026-0001');
  assert.equal(nextOrderNumber([{ number: 'FW2026-0002' }], d, 'FW'), 'FW2026-0003');
});

test('Telefonnummern für WhatsApp', () => {
  assert.equal(normalizePhone('0171 1234567'), '491711234567');
  assert.equal(normalizePhone('+49 (171) 123-45'), '4917112345');
  assert.equal(normalizePhone('0043 660 123'), '43660123');
  assert.equal(normalizePhone('06131/123', '43'), '436131123');
  assert.equal(normalizePhone('491711234567'), '491711234567');
  assert.equal(normalizePhone(''), '');
  assert.equal(normalizePhone('keine'), '');
});

const order = {
  number: '2026-0001',
  createdAt: '2026-11-22T10:00:00.000Z',
  pickupDate: '2026-11-28',
  note: 'Bitte dünn schneiden',
  items: [
    { productId: 'a', name: 'Wildschwein-Bratwurst', size: '4 Stück', unit: 'Stück', priceCents: 700, qty: 2 },
    { productId: 'b', name: 'Hirschgulasch', unit: 'kg', priceCents: 1800, qty: 1.5 },
  ],
};

test('Bestelltext enthält Positionen, Gesamt, Abholung, Hinweis und Kontakt', () => {
  const text = orderMessage(order, { name: 'Max Mustermann' }, { contact: 'Tel. 06131 000000' });
  assert.match(text, /^Hallo Max Mustermann,/);
  assert.match(text, /AirKneipi Fleischerwerkstatt \(Nr\. 2026-0001 vom 22\.11\.2026\)/);
  assert.match(text, /2 × Wildschwein-Bratwurst \(4 Stück\) à 7,00 € = 14,00 €/);
  assert.match(text, /1,5 kg Hirschgulasch à 18,00 €\/kg = 27,00 €/);
  assert.match(text, /Gesamt: 41,00 €/);
  assert.match(text, /Abholung: Sa\., 28\.11\.2026/);
  assert.match(text, /Hinweis: Bitte dünn schneiden/);
  assert.match(text, /Tel\. 06131 000000$/);
  assert.equal(orderMessage({ items: [] }, null).split('\n')[0], 'Hallo,');
});

test('Links für WhatsApp, Telegram und Mail', () => {
  const text = 'Zeile 1\nGesamt: 7,20 € & mehr';
  const wa = whatsappLink('0171 1234567', text);
  assert.ok(wa.startsWith('https://wa.me/491711234567?text='));
  assert.equal(decodeURIComponent(wa.split('text=')[1]), text);
  const tg = new URL(telegramLink(text));
  assert.equal(tg.origin + tg.pathname, 'https://t.me/share/url');
  assert.equal(tg.searchParams.get('text'), text);
  assert.equal(telegramChatLink('@erika_beispiel'), 'https://t.me/erika_beispiel');
  assert.equal(telegramChatLink('https://t.me/erika_beispiel'), 'https://t.me/erika_beispiel');
  assert.equal(telegramChatLink('ab'), '');
  assert.equal(telegramChatLink(''), '');
  const mail = mailLink('max@example.com', 'Betreff ä', text);
  assert.ok(mail.startsWith('mailto:max@example.com?subject='));
  assert.ok(mail.includes('%0D%0A'));
  assert.ok(!mail.includes('&mehr'));
});

test('Kundensuche ignoriert Groß/Klein und Umlaute', () => {
  const c = { name: 'Jürgen Müller', phone: '0171 555', address: 'Mainz-Finthen' };
  assert.ok(matches(c, 'mueller'));
  assert.ok(matches(c, 'MÜLLER jürg'));
  assert.ok(matches(c, 'finthen'));
  assert.ok(matches(c, '555'));
  assert.ok(!matches(c, 'schmidt'));
  assert.ok(matches(c, ''));
});

test('Sicherung schreiben und wieder einlesen', () => {
  const data = sampleData();
  const backup = makeBackup({ ...data, settings: { businessName: 'Test' } }, new Date('2026-11-22T00:00:00Z'));
  assert.equal(backup.format, BACKUP_FORMAT);
  const back = readBackup(JSON.stringify(backup));
  assert.equal(back.products.length, data.products.length);
  assert.equal(back.settings.businessName, 'Test');
  assert.equal(back.settings.countryCode, '49');
  assert.throws(() => readBackup('kein json'), /kein JSON/);
  assert.throws(() => readBackup('{"format":"anders"}'), /keine Sicherung dieses Showrooms/);
  assert.throws(() => readBackup({ ...backup, version: 2 }), /Sicherungsversion/);
  assert.throws(() => readBackup({ ...backup, orders: [{}] }), /keine gültige ID/);
});

test('Beispieldaten haben gültige Preise', () => {
  for (const p of sampleData().products) assert.ok(Number.isInteger(p.priceCents) && p.priceCents > 0, p.name);
});
