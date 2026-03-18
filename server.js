const path = require('path');
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(session({
  secret: 'schwarzberghof-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname)));

let reservationCache = {};
let lastFetch = {};

function deduplicateReservations(reservations) {
  const seen = new Map();
  return reservations.filter(r => {
    const key = `${r.firstName.toLowerCase()}-${r.lastName.toLowerCase()}-${r.date}-${r.time}`;
    if (seen.has(key)) return false;
    seen.set(key, true);
    return true;
  });
}

async function fetchReservations(email, password) {
  const now = Date.now();
  if (reservationCache[email] && (now - lastFetch[email]) < 5 * 60 * 1000) {
    return reservationCache[email];
  }
  const client = new ImapFlow({
    host: 'mail.biohost.de', port: 993, secure: true,
    auth: { user: email, pass: password }, logger: false,
    tls: { rejectUnauthorized: false }
  });
  const reservations = [];
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const messages = client.fetch('1:*', { envelope: true, source: true });
      for await (const msg of messages) {
        try {
          const subject = msg.envelope.subject || '';
          if (!subject.toLowerCase().includes('reservier') &&
              !subject.toLowerCase().includes('tisch') &&
              !subject.toLowerCase().includes('booking')) continue;
          const parsed = await simpleParser(msg.source);
          const body = parsed.text || parsed.html || '';
          const reservation = parseReservationEmail(body, msg.envelope, msg.uid);
          if (reservation) reservations.push(reservation);
        } catch(e) {}
      }
    } finally { lock.release(); }
    await client.logout();
  } catch(err) {
    throw new Error('IMAP-Verbindung fehlgeschlagen: ' + err.message);
  }
  const deduplicated = deduplicateReservations(reservations);
  reservationCache[email] = deduplicated;
  lastFetch[email] = now;
  return deduplicated;
}

function parseReservationEmail(body, envelope, uid) {
  const text = body.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const dateMatch  = text.match(/Datumsauswahl[:\s]*(\d{4}-\d{2}-\d{2})/i) || text.match(/Datum[:\s]*(\d{4}-\d{2}-\d{2})/i);
  const timeMatch  = text.match(/Uhrzeit[:\s]*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)/i) || text.match(/Zeit[:\s]*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)/i);
  const paxMatch   = text.match(/Anzahl Personen[:\s]*(\d+)/i) || text.match(/Personen[:\s]*(\d+)/i) || text.match(/Guests?[:\s]*(\d+)/i);
  const firstMatch = text.match(/Vorname[:\s]*([^\s,\n]+)/i);
  const lastMatch  = text.match(/Nachname[:\s]*([^\s,\n]+)/i) || text.match(/Familienname[:\s]*([^\s,\n]+)/i);
  const phoneMatch = text.match(/Telefon(?:nummer)?[:\s]*([\+\d\s\-\/\(\)]{7,20})/i) || text.match(/Tel[:\s]*([\+\d\s\-\/\(\)]{7,20})/i);
  const emailMatch = text.match(/E-?Mail(?:-Adresse)?[:\s]*([\w.\-+]+@[\w.\-]+\.\w+)/i) || text.match(/([\w.\-+]+@[\w.\-]+\.\w+)/);
  if (!dateMatch && !firstMatch && !lastMatch) return null;
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
  const receivedDate = envelope.date ? new Date(envelope.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
  return {
    id: `uid-${uid}`,
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

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'E-Mail und Passwort erforderlich' });
  try {
    const client = new ImapFlow({ host: 'mail.biohost.de', port: 993, secure: true, auth: { user: email, pass: password }, logger: false, tls: { rejectUnauthorized: false } });
    await client.connect();
    await client.logout();
    req.session.email = email;
    req.session.password = password;
    res.json({ success: true });
  } catch(err) {
    res.status(401).json({ error: 'Anmeldung fehlgeschlagen. Bitte E-Mail und Passwort prüfen.' });
  }
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

app.get('/api/me', (req, res) => {
  if (req.session.email) res.json({ email: req.session.email });
  else res.status(401).json({ error: 'Nicht angemeldet' });
});

app.get('/api/reservations', async (req, res) => {
  if (!req.session.email) return res.status(401).json({ error: 'Nicht angemeldet' });
  try {
    const reservations = await fetchReservations(req.session.email, req.session.password);
    res.json({ reservations, count: reservations.length });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/refresh', async (req, res) => {
  if (!req.session.email) return res.status(401).json({ error: 'Nicht angemeldet' });
  delete reservationCache[req.session.email];
  delete lastFetch[req.session.email];
  try {
    const reservations = await fetchReservations(req.session.email, req.session.password);
    res.json({ reservations, count: reservations.length });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/send-email', async (req, res) => {
  if (!req.session.email) return res.status(401).json({ error: 'Nicht angemeldet' });
  const { to, type, reservation } = req.body;
  const isConfirm = type === 'confirm';
  const dateFormatted = new Date(reservation.date).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const subject = isConfirm
    ? `Reservierungsbestätigung – ${dateFormatted} um ${reservation.time} Uhr`
    : `Ihre Reservierungsanfrage – ${dateFormatted}`;
  const text = isConfirm
    ? `Sehr geehrte/r ${reservation.firstName} ${reservation.lastName},\n\nwir freuen uns, Ihre Reservierung für ${reservation.pax} Person(en) am ${dateFormatted} um ${reservation.time} Uhr zu bestätigen.\n\nWir freuen uns auf Ihren Besuch!\n\nHerzliche Grüße\nIhr Schwarzberghof-Team\nClaus & Nicole Brummer\nwww.schwarzberghof.eu`
    : `Sehr geehrte/r ${reservation.firstName} ${reservation.lastName},\n\nleider müssen wir Ihre Reservierungsanfrage für den ${dateFormatted} um ${reservation.time} Uhr ablehnen, da wir zu diesem Zeitpunkt leider vollständig ausgebucht sind.\n\nWir würden uns freuen, Sie zu einem anderen Zeitpunkt bei uns begrüßen zu dürfen.\n\nHerzliche Grüße\nIhr Schwarzberghof-Team\nClaus & Nicole Brummer\nwww.schwarzberghof.eu`;
  try {
    const transporter = nodemailer.createTransport({ host: 'mail.biohost.de', port: 465, secure: true, auth: { user: req.session.email, pass: req.session.password } });
    await transporter.sendMail({ from: `"Schwarzberghof" <${req.session.email}>`, to, subject, text });
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ error: 'E-Mail konnte nicht gesendet werden: ' + err.message });
  }
});

app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

app.listen(PORT, () => { console.log(`\n🏔  Schwarzberghof Dashboard läuft auf http://localhost:${PORT}\n`); });
