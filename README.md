# AirKneipi Fleischerwerkstatt – Showroom

Handy-App (PWA) für den Verkauf: Produkte mit Preis zeigen, Kunden verwalten, Bestellung zusammenstellen,
Gesamtpreis berechnen und die Bestellung per **WhatsApp, Telegram oder E-Mail** verschicken.
Gebaut im Stil der AirBritti 3D-Druck-Werkstatt: Node 24, keine Fremdpakete.

## Bereiche

| Bereich | Was man dort macht |
|---|---|
| **Showroom** | Produktkarten mit Foto, Preis (pro Stück/Packung oder pro kg), Kategorien. „+ in Bestellung“. Foto antippen = groß. |
| **Bestellung** | Kunde wählen (oder neuen Namen tippen), Mengen mit − / + (Stück: 1er-Schritte, kg: 0,5er-Schritte, frei eintippbar), Abholtag, Hinweis, Gesamtpreis, speichern. |
| **Kunden** | Kartei mit Name, Telefon/WhatsApp, E-Mail, Telegram-Name, Adresse, Notiz; Suche; Bestellungen je Kunde. |
| **Verlauf** | Alle Bestellungen mit Nummer (2026-0001 …), Status Offen / Verschickt / Erledigt / Storniert, Verschicken-Knöpfe. |
| **Umsatz** (im Verlauf) | Heute, dieser Monat, noch nicht bezahlt; Monate und Tage mit Summe, bezahlt/unbezahlt. Stornos zählen nicht. |
| **Verwaltung** | Produkte anlegen/ändern (Foto vom Handy, wird auf 900 px verkleinert), Betriebsname, Kontaktzeile, Sicherung. |

## Verschicken

- **WhatsApp**: öffnet den Chat mit der Nummer des Kunden, Text ist eingefügt – nur noch „Senden“.
- **Telegram**: öffnet den Teilen-Dialog mit dem Text, dort den Kontakt wählen (Telegram erlaubt kein Vorbefüllen an eine Nummer).
- **E-Mail**: öffnet das Mailprogramm mit Adresse, Betreff und Text.
- **Teilen …** (am Handy): normales Teilen-Menü, z. B. für Signal oder SMS. **Text kopieren** geht immer.

Nach dem Verschicken springt der Status von „Offen“ auf „Verschickt“. Jede Bestellung hat zusätzlich **bezahlt / unbezahlt**.
Ist unter Verwaltung „PayPal für Bezahl-Link“ eingetragen (PayPal.me-Name oder E-Mail), steht in jeder unbezahlten
Nachricht ein PayPal-Link mit dem fertigen Betrag; bei bezahlten Bestellungen stattdessen „Bereits bezahlt – vielen Dank!“.

## Daten

Alles liegt **nur auf dem Gerät** (IndexedDB), kein Server, keine Konten.
Darum regelmäßig unter *Verwaltung → Sicherung exportieren* eine Datei speichern (iCloud Drive, Mail an sich selbst).
Mit *Sicherung einspielen* kommt alles auf ein neues Handy. Sicherungsdateien enthalten Kundendaten – nicht weitergeben.

## Abgleich zwischen zwei Handys (z. B. mit dem Bruder)

Ohne Server und ohne Cloud, per Datei:

1. Jeder trägt unter *Verwaltung → Abgleich* einmal sein **Kürzel** ein (z. B. `M` und `B`).
   Bestellnummern heißen dann `M-2026-0001` bzw. `B-2026-0001` und kommen sich nie in die Quere.
2. **Abgleich senden** → Datei per AirDrop, Nachrichten oder iCloud Drive an den anderen.
3. Der andere: **Abgleich einspielen** → Datei wählen. Das *führt zusammen*, es ersetzt nichts:
   Neues kommt dazu, bei derselben Bestellung/demselben Kunden gewinnt die neuere Änderung,
   Gelöschtes bleibt gelöscht (außer es wurde danach auf dem anderen Handy noch geändert).
4. Dasselbe zurück, dann haben beide den gleichen Stand. Zweimal einspielen schadet nicht.

Gut zu wissen: Legen beide denselben Kunden getrennt an, steht er zweimal in der Kartei.
Die gemeinsamen Einstellungen (Betriebsname, Kontaktzeile) gleichen sich mit ab, das Kürzel nicht.

## Automatischer Abgleich über die Synology

Ein kleiner Server (`sync-server/server.mjs`, ohne Fremdpakete) läuft auf der DS220+ im Container Manager
und hält den gemeinsamen Stand als Datei (`data/stand.json`, dazu 30 Tagessicherungen). Die Handys gleichen
beim Öffnen, nach jeder Änderung und alle 5 Minuten ab; ohne Netz arbeiten sie normal weiter.
Zusammengeführt wird mit derselben Logik wie beim Datei-Abgleich.

- NAS-Ordner: `/volume1/docker/fleischerwerkstatt/` mit `compose.yaml` (Vorlage: `nas/compose.yaml`),
  `.env` (nur dort: `SYNC_KEY`), `app/` (= `sync-server/server.mjs` + `public/logic.mjs`) und `data/`.
- Von außen: DSM-Reverse-Proxy `https://michaelkneip.synology.me:8443` → `http://localhost:3191`,
  FRITZ!Box-Portfreigabe TCP 8443 → DS220+.
- Handy einrichten: In der App unter *Verwaltung → Automatischer Abgleich* den Einrichtungs-Link ins
  Adressfeld einfügen → Speichern. Den Link erzeugt jedes verbundene Handy über „Link für den Bruder“.
- Server-Update: `sync-server/server.mjs` und `public/logic.mjs` nach `app/` kopieren, Projekt neu starten.

## Bestell-Link für Freunde

`public/bestellen.html`: Freunde sehen das Sortiment, wählen Mengen und bestellen mit Name und Handynummer.
Die Bestellung geht an den Abgleich-Server (`POST /api/bestellung`), der Preise selbst aus dem Sortiment rechnet,
den Kunden an der Nummer erkennt oder neu anlegt und die Bestellung als `WEB-…` mit „NEU · über Link“ speichert.
Der Link enthält Server-Adresse und einen eigenen **Bestell-Schlüssel** (`data/bestell-schluessel.txt` auf der NAS,
wird beim ersten Start erzeugt) – damit kann man nur bestellen, nie Kunden oder Bestellungen lesen.
Spam-Bremse: 5 Bestellungen je Absender in 10 Minuten, 300 am Tag. In der App: Verwaltung → Abgleich →
„Bestell-Link teilen“ / „Pausieren“. Neuer Schlüssel = Datei löschen und Container neu starten (alte Links gelten dann nicht mehr).

**Push-Benachrichtigung:** Steht in `data/benachrichtigung.txt` auf der NAS eine Webhook-Adresse, schickt der Server
nach jeder Bestellung über den Link `{ title, message, name, total, pickupDate }` dorthin. Eingerichtet ist die
Home-Assistant-Automation „Fleischerwerkstatt: neue Bestellung über den Bestell-Link“ (Webhook, nur Heimnetz) →
Push aufs iPhone. Die Adresse wird bei jeder Bestellung neu gelesen, ändern braucht keinen Neustart.

## Am Rechner ausprobieren

```
node server.mjs        # http://127.0.0.1:3190/
node --test            # Tests der Rechen-, Text- und Abgleichlogik und des Servers
```

## Aufs Handy

Damit man die App installieren kann („Zum Home-Bildschirm“) und sie offline läuft, muss der Ordner `public/`
über **HTTPS** erreichbar sein (z. B. eigene Subdomain oder GitHub Pages). Es sind nur statische Dateien.
Danach am iPhone in Safari öffnen → Teilen → „Zum Home-Bildschirm“; am Android in Chrome → „App installieren“.

Bei jeder neuen Version **drei Stellen** hochzählen: `VERSION` in `public/sw.js`, `APP_VERSION` in `public/app.mjs` und `public/version.json`.
Die App prüft beim Öffnen `version.json` und zeigt „Neue Version verfügbar → Jetzt aktualisieren“.

## Startsortiment

18 Produkte nach den Plakaten vom 22.11.2026 (`STARTSORTIMENT` in `public/logic.mjs`), Fotos = die Plakate
in `public/produkte/start-01.jpg` … `start-18.jpg` (auf 900 px verkleinert). Eigene Fotos in der App haben Vorrang.
Fünf werden pro kg abgerechnet (Wildhack, Wildschwein-, Hirsch-, Rehgulasch, marinierte Rückensteaks).

## Veröffentlichung

Jeder Push auf `main` lässt die Tests laufen und stellt `public/` auf GitHub Pages:
https://mk070782.github.io/fleischerwerkstatt-showroom/ (siehe `.github/workflows/pages.yml`).
Im Repo stehen nur Programm und Sortiment – Kunden und Bestellungen bleiben auf dem Handy.
