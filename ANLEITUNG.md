# 🏔 Schwarzberghof Dashboard — Installations-Anleitung

## Was du bekommst
Eine echte Web-App die:
- Automatisch eure Reservierungs-E-Mails aus dem IONOS-Postfach liest
- Auf jedem iPhone als App installierbar ist
- Reservierungen anzeigt, filtert, und die Tagesliste teilen kann

---

## Schritt 1: Node.js installieren (einmalig, 2 Min.)

1. Gehe auf **https://nodejs.org** und lade die **LTS Version** herunter
2. Installiere sie normal (weiter, weiter, fertig)
3. Öffne das **Terminal** (Mac: Spotlight → "Terminal") oder die **Eingabeaufforderung** (Windows: Win+R → "cmd")
4. Teste: Tippe `node --version` → es sollte `v20.x.x` erscheinen ✅

---

## Schritt 2: Dateien auf den Server kopieren

### Option A: Lokaler PC / Mac (zum Testen)
1. Entpacke den Ordner `schwarzberghof` irgendwo auf deinem Computer
2. Öffne das Terminal und navigiere in den Ordner:
   ```
   cd /Pfad/zum/Ordner/schwarzberghof
   ```
3. Installiere Abhängigkeiten:
   ```
   npm install
   ```
4. Starte den Server:
   ```
   node server.js
   ```
5. Öffne im Browser: **http://localhost:3000**

### Option B: IONOS Server (dauerhafter Betrieb, empfohlen)
Falls ihr bei IONOS ein Webhosting oder VPS habt:

1. Verbinde dich per FTP (z.B. FileZilla) mit euren IONOS-Zugangsdaten
2. Lade den kompletten `schwarzberghof`-Ordner hoch
3. In IONOS-Verwaltung → **Node.js App** aktivieren, Startdatei: `server.js`
4. Die App ist dann unter eurer Domain erreichbar

### Option C: Kostenloser Cloud-Dienst (Railway)
1. Gehe auf **https://railway.app** und erstelle ein kostenloses Konto
2. Klicke auf "New Project" → "Deploy from GitHub" oder "Deploy from folder"
3. Lade die Dateien hoch
4. Railway gibt dir automatisch eine URL wie `https://schwarzberghof-xyz.railway.app`

---

## Schritt 3: App auf dem iPhone installieren

1. Öffne **Safari** auf dem iPhone (wichtig: Safari, nicht Chrome!)
2. Gehe zur URL deines Servers (z.B. `http://192.168.1.x:3000` im Heimnetz oder eure Domain)
3. Melde dich mit `info@schwarzberghof.eu` und eurem E-Mail-Passwort an
4. Tippe auf das **Teilen-Symbol** (☐ mit Pfeil nach oben) unten in Safari
5. Scrolle runter zu **„Zum Home-Bildschirm"**
6. Tippe auf **Hinzufügen**

✅ Fertig! Das Dashboard erscheint jetzt als App auf eurem iPhone-Homescreen.

---

## Im Heimnetz nutzen (einfachste Lösung)

Wenn ihr das Dashboard nur im Restaurant-WLAN braucht:

1. Starte `node server.js` auf einem PC/Mac der immer läuft (oder einem Raspberry Pi)
2. Finde die lokale IP-Adresse des PCs:
   - Mac: Systemeinstellungen → WLAN → Details → IP-Adresse
   - Windows: cmd → `ipconfig` → "IPv4-Adresse"
3. Auf dem iPhone Safari aufrufen: `http://192.168.1.XXX:3000`
4. Als App installieren (Schritt 3 oben)

---

## Probleme?

**„IMAP-Verbindung fehlgeschlagen"**
- Prüfe ob das Passwort stimmt (IONOS-Webmail testen)
- Bei IONOS: Stelle sicher dass IMAP aktiviert ist (IONOS-Verwaltung → E-Mail → Einstellungen)
- IMAP-Server: `imap.ionos.de`, Port: `993`

**Keine Reservierungen werden gefunden**
- Die E-Mails müssen "Reservier" oder "Tisch" im Betreff haben
- Prüfe im IONOS-Webmail ob die E-Mails im INBOX-Ordner sind (nicht Spam)

**App zeigt sich nicht nach Neustart**
- Installiere `pm2` für automatischen Neustart: `npm install -g pm2`
- Starte mit: `pm2 start server.js --name schwarzberghof`
- Autostart: `pm2 startup` und `pm2 save`

---

## Dateien-Übersicht

```
schwarzberghof/
├── server.js          ← Der Server (IMAP + API)
├── package.json       ← Abhängigkeiten
└── public/
    └── index.html     ← Das Dashboard (Frontend)
```
