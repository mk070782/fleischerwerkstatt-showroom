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
| **Verwaltung** | Produkte anlegen/ändern (Foto vom Handy, wird auf 900 px verkleinert), Betriebsname, Kontaktzeile, Sicherung. |

## Verschicken

- **WhatsApp**: öffnet den Chat mit der Nummer des Kunden, Text ist eingefügt – nur noch „Senden“.
- **Telegram**: öffnet den Teilen-Dialog mit dem Text, dort den Kontakt wählen (Telegram erlaubt kein Vorbefüllen an eine Nummer).
- **E-Mail**: öffnet das Mailprogramm mit Adresse, Betreff und Text.
- **Teilen …** (am Handy): normales Teilen-Menü, z. B. für Signal oder SMS. **Text kopieren** geht immer.

Nach dem Verschicken springt der Status von „Offen“ auf „Verschickt“.

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

## Am Rechner ausprobieren

```
node server.mjs        # http://127.0.0.1:3190/
node --test            # Tests der Rechen- und Textlogik
```

## Aufs Handy

Damit man die App installieren kann („Zum Home-Bildschirm“) und sie offline läuft, muss der Ordner `public/`
über **HTTPS** erreichbar sein (z. B. eigene Subdomain oder GitHub Pages). Es sind nur statische Dateien.
Danach am iPhone in Safari öffnen → Teilen → „Zum Home-Bildschirm“; am Android in Chrome → „App installieren“.

Bei jeder neuen Version `VERSION` in `public/sw.js` hochzählen.

## Startsortiment

18 Produkte nach den Plakaten vom 22.11.2026 (`STARTSORTIMENT` in `public/logic.mjs`), ohne Fotos.
Fünf werden pro kg abgerechnet (Wildhack, Wildschwein-, Hirsch-, Rehgulasch, marinierte Rückensteaks).

## Veröffentlichung

Jeder Push auf `main` lässt die Tests laufen und stellt `public/` auf GitHub Pages:
https://mk070782.github.io/fleischerwerkstatt-showroom/ (siehe `.github/workflows/pages.yml`).
Im Repo stehen nur Programm und Sortiment – Kunden und Bestellungen bleiben auf dem Handy.
