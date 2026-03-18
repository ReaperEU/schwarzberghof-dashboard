/**
 * Schwarzberghof Reservierungs-Server
 * Liest E-Mails via IMAP und stellt sie als API bereit
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Abhängigkeiten installieren falls nötig ──────────────
function ensureDeps() {
  const needed = ['imapflow', 'mailparser', 'express', 'cors', 'express-session'];
  needed.forEach(pkg => {
    try { require.resolve(pkg); }
    catch(e) {
      console.log(`📦 Installiere ${pkg}...`);
      execSync(`npm install ${pkg} --save`, { stdio: 'inherit' });
    }
  });
}
ensureDeps();

const express    = require('express');
const cors       = require('cors');
const session    = require('express-session');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ───────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(session({
  secret: 'schwarzberghof-' + Math.random().toString(36),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // 8 Stunden
}));

// Static files (das Dashboard HTML)
app.use(express.static(path.join(__dirname, 'public')));

// ── In-Memory Cache ──────────────────────────────────────
let reservationCache = {};
let lastFetch = {};

// ── IMAP E-Mail Abruf ────────────────────────────────────
async function fetchReservations(email, password) {
  const cacheKey = email;
  const now = Date.now();
  
  // Cache für 5 Minuten
  if (reservationCache[cacheKey] && (now - lastFetch[cacheKey]) < 5 * 60 * 1000) {
    return reservationCache[cacheKey];
  }

  const client = new ImapFlow({
    host: 'imap.ionos.de',
    port: 993,
    secure: true,
    auth: { user: email, pass: password },
    logger: false,
    tls: { rejectUnauthorized: false }
  });

  const reservations = [];

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      // Alle E-Mails suchen (oder nach Betreff filtern)
      const messages = client.fetch('1:*', { envelope: true, source: true });

      for await (const msg of messages) {
        try {
          const subject = msg.envelope.subject || '';
          
          // Nur Reservierungs-E-Mails verarbeiten
          if (!subject.toLowerCase().includes('reservier') && 
              !subject.toLowerCase().includes('tisch') &&
              !subject.toLowerCase().includes('booking')) {
            continue;
          }

          const parsed = await simpleParser(msg.source);
          const body = parsed.text || parsed.html || '';
          
          // Parse Reservierungsdaten aus dem E-Mail-Body
          const reservation = parseReservationEmail(body, msg.envelope, msg.uid);
          if (reservation) {
            reservations.push(reservation);
          }
        } catch(msgErr) {
          // Einzelne E-Mail-Fehler ignorieren
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch(err) {
    throw new Error('IMAP-Verbindung fehlgeschlagen: ' + err.message);
  }

  // Cache speichern
  reservationCache[cacheKey] = reservations;
  lastFetch[cacheKey] = now;

  return reservations;
}

// ── E-Mail Parser ────────────────────────────────────────
function parseReservationEmail(body, envelope, uid) {
  // Bereinige HTML falls nötig
  const text = body.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

  // Extrahiere Felder mit flexiblen Regex-Patterns
  const dateMatch    = text.match(/Datumsauswahl[:\s]*(\d{4}-\d{2}-\d{2})/i) ||
                       text.match(/Datum[:\s]*(\d{4}-\d{2}-\d{2})/i) ||
                       text.match(/Date[:\s]*(\d{4}-\d{2}-\d{2})/i);
  
  const timeMatch    = text.match(/Uhrzeit[:\s]*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)/i) ||
                       text.match(/Zeit[:\s]*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)/i) ||
                       text.match(/Time[:\s]*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)/i);
  
  const paxMatch     = text.match(/Anzahl Personen[:\s]*(\d+)/i) ||
                       text.match(/Personen[:\s]*(\d+)/i) ||
                       text.match(/Guests?[:\s]*(\d+)/i) ||
                       text.match(/Persons?[:\s]*(\d+)/i);
  
  const firstMatch   = text.match(/Vorname[:\s]*([^\s,\n]+)/i) ||
                       text.match(/First\s*Name[:\s]*([^\s,\n]+)/i);
  
  const lastMatch    = text.match(/Nachname[:\s]*([^\s,\n]+)/i) ||
                       text.match(/Last\s*Name[:\s]*([^\s,\n]+)/i) ||
                       text.match(/Familienname[:\s]*([^\s,\n]+)/i);
  
  const phoneMatch   = text.match(/Telefon(?:nummer)?[:\s]*([\+\d\s\-\/\(\)]{7,20})/i) ||
                       text.match(/Phone[:\s]*([\+\d\s\-\/\(\)]{7,20})/i) ||
                       text.match(/Tel[:\s]*([\+\d\s\-\/\(\)]{7,20})/i);
  
  const emailMatch   = text.match(/E-?Mail(?:-Adresse)?[:\s]*([\w.\-+]+@[\w.\-]+\.\w+)/i) ||
                       text.match(/([\w.\-+]+@[\w.\-]+\.\w+)/);

  if (!dateMatch && !firstMatch && !lastMatch) return null;

  // Zeit normalisieren (12h → 24h)
  let timeStr = '00:00';
  if (timeMatch) {
    const raw = timeMatch[1].trim();
    const isPM = raw.toUpperCase().includes('PM');
    const isAM = raw.toUpperCase().includes('AM');
    const parts = raw.replace(/AM|PM/gi, '').trim().split(':');
    let h = parseInt(parts[0]);
    const m = parts[1] ? parts[1].substring(0,2) : '00';
    if (isPM && h < 12) h += 12;
    if (isAM && h === 12) h = 0;
    timeStr = `${String(h).padStart(2,'0')}:${m}`;
  }

  const receivedDate = envelope.date ? 
    new Date(envelope.date).toISOString().split('T')[0] : 
    new Date().toISOString().split('T')[0];

  return {
    id: `uid-${uid}-${Date.now()}`,
    date: dateMatch ? dateMatch[1] : receivedDate,
    time: timeStr,
    pax: paxMatch ? parseInt(paxMatch[1]) : 2,
    firstName: firstMatch ? firstMatch[1].trim() : '—',
    lastName: lastMatch ? lastMatch[1].trim() : '—',
    phone: phoneMatch ? phoneMatch[1].trim() : '—',
    email: emailMatch ? emailMatch[1].trim() : (envelope.from?.[0]?.address || '—'),
    receivedAt: receivedDate,
    subject: envelope.subject || ''
  };
}

// ── API Routen ───────────────────────────────────────────

// Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'E-Mail und Passwort erforderlich' });
  }

  try {
    // Test-Verbindung
    const client = new ImapFlow({
      host: 'imap.ionos.de',
      port: 993,
      secure: true,
      auth: { user: email, pass: password },
      logger: false,
      tls: { rejectUnauthorized: false }
    });
    await client.connect();
    await client.logout();

    // Session speichern
    req.session.email = email;
    req.session.password = password;
    res.json({ success: true });
  } catch(err) {
    res.status(401).json({ error: 'Anmeldung fehlgeschlagen. Bitte E-Mail und Passwort prüfen.' });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Auth-Check
app.get('/api/me', (req, res) => {
  if (req.session.email) {
    res.json({ email: req.session.email });
  } else {
    res.status(401).json({ error: 'Nicht angemeldet' });
  }
});

// Reservierungen abrufen
app.get('/api/reservations', async (req, res) => {
  if (!req.session.email) {
    return res.status(401).json({ error: 'Nicht angemeldet' });
  }

  try {
    const reservations = await fetchReservations(req.session.email, req.session.password);
    res.json({ reservations, count: reservations.length, cached: false });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// Cache leeren (für manuellen Refresh)
app.post('/api/refresh', async (req, res) => {
  if (!req.session.email) return res.status(401).json({ error: 'Nicht angemeldet' });
  delete reservationCache[req.session.email];
  delete lastFetch[req.session.email];
  try {
    const reservations = await fetchReservations(req.session.email, req.session.password);
    res.json({ reservations, count: reservations.length });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// Alle anderen Routen → Dashboard
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Server starten ───────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏔  Schwarzberghof Dashboard läuft auf http://localhost:${PORT}`);
  console.log(`   Öffne im Browser: http://localhost:${PORT}\n`);
});
