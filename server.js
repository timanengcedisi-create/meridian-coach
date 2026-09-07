'use strict';

const path = require('path');
const express = require('express');
const { open } = require('./lib/db');
const charter = require('./lib/charter');
const agentStore = require('./lib/agentStore');

const app = express();
const db = open();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function sendError(res, err) {
  const status = err.status || 500;
  res.status(status).json({
    ok: false,
    error: err.message || 'Unexpected error',
    availability: err.availability || undefined
  });
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'Meridian Coach Operations', seatsPerCoach: charter.SEATS_PER_COACH });
});

app.get('/api/overview', (_req, res) => {
  const coaches = db.prepare(`SELECT status, COUNT(*) AS n FROM coaches GROUP BY status`).all();
  const bookings = db.prepare(`SELECT status, COUNT(*) AS n FROM bookings GROUP BY status`).all();
  const upcoming = db.prepare(`
    SELECT COUNT(*) AS n FROM bookings
    WHERE status = 'confirmed' AND datetime(departure_at) >= datetime('now')
  `).get().n;
  const assignedToday = db.prepare(`
    SELECT COUNT(*) AS n FROM booking_coaches bc
    JOIN bookings b ON b.id = bc.booking_id
    WHERE b.status IN ('confirmed','pending')
      AND date(b.departure_at) = date('now')
  `).get().n;
  const passengersToday = db.prepare(`
    SELECT COALESCE(SUM(passengers),0) AS n FROM bookings
    WHERE status = 'confirmed' AND date(departure_at) = date('now')
  `).get().n;
  const openLuggage = db.prepare(`SELECT COUNT(*) AS n FROM lost_luggage WHERE status='open'`).get().n;
  const waitingCalls = db.prepare(`SELECT COUNT(*) AS n FROM agent_queue WHERE status='waiting'`).get().n;
  res.json({
    ok: true,
    seatsPerCoach: charter.SEATS_PER_COACH,
    coaches,
    bookings,
    upcoming,
    assignedToday,
    passengersToday,
    openLuggage,
    waitingCalls,
    fleetSize: db.prepare(`SELECT COUNT(*) AS n FROM coaches WHERE status='active'`).get().n
  });
});

app.get('/api/coaches', (_req, res) => {
  const coaches = db.prepare(`SELECT * FROM coaches ORDER BY code`).all();
  res.json({ ok: true, coaches });
});

app.get('/api/routes', (_req, res) => {
  const routes = db.prepare(`SELECT * FROM routes ORDER BY name`).all();
  res.json({ ok: true, routes });
});

app.post('/api/availability', (req, res) => {
  try {
    const body = req.body || {};
    const numberOfCoaches = body.numberOfCoaches ?? body.coachesRequired;
    const result = charter.availability(db, {
      numberOfCoaches,
      departureAt: body.departureAt,
      returnAt: body.returnAt
    });
    const checking = `Required coaches: ${result.numberOfCoaches}. Checking coach availability...`;
    res.json({ ok: true, checking, ...result });
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/bookings', (_req, res) => {
  res.json({ ok: true, bookings: charter.listBookings(db) });
});

app.get('/api/bookings/:id', (req, res) => {
  const booking = charter.getBooking(db, req.params.id);
  if (!booking) return res.status(404).json({ ok: false, error: 'Booking not found.' });
  res.json({ ok: true, booking });
});

app.post('/api/bookings', (req, res) => {
  try {
    const booking = charter.createBooking(db, req.body || {});
    res.status(201).json({ ok: true, booking });
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/bookings/:id/cancel', (req, res) => {
  try {
    const booking = charter.cancelBooking(db, req.params.id);
    res.json({ ok: true, booking });
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/bookings/:id/notify', (req, res) => {
  try {
    const channel = req.body?.channel === 'whatsapp' ? 'whatsapp' : 'sms';
    const booking = charter.markNotify(db, req.params.id, channel);
    res.json({ ok: true, booking, message: `${channel.toUpperCase()} confirmation queued for ${booking.phone}` });
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/passengers', (_req, res) => {
  const rows = db.prepare(`
    SELECT p.*, b.reference, b.customer_name
    FROM passenger_records p
    JOIN bookings b ON b.id = p.booking_id
    ORDER BY p.id DESC
  `).all();
  res.json({ ok: true, passengers: rows });
});

app.post('/api/passengers', (req, res) => {
  const { bookingId, fullName, phone, notes } = req.body || {};
  if (!bookingId || !fullName) return res.status(400).json({ ok: false, error: 'Booking and full name are required.' });
  const info = db.prepare(
    `INSERT INTO passenger_records (booking_id, full_name, phone, notes) VALUES (?, ?, ?, ?)`
  ).run(bookingId, fullName, phone || null, notes || null);
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

app.get('/api/luggage', (_req, res) => {
  const rows = db.prepare(`
    SELECT l.*, b.reference, c.code AS coach_code
    FROM lost_luggage l
    LEFT JOIN bookings b ON b.id = l.booking_id
    LEFT JOIN coaches c ON c.id = l.coach_id
    ORDER BY l.id DESC
  `).all();
  res.json({ ok: true, items: rows });
});

app.post('/api/luggage', (req, res) => {
  const { bookingId, coachId, description } = req.body || {};
  if (!description) return res.status(400).json({ ok: false, error: 'Description is required.' });
  const info = db.prepare(
    `INSERT INTO lost_luggage (booking_id, coach_id, description) VALUES (?, ?, ?)`
  ).run(bookingId || null, coachId || null, description);
  db.prepare(`INSERT INTO audit_log (action, entity, entity_id, detail) VALUES (?, ?, ?, ?)`).run(
    'luggage.reported', 'lost_luggage', String(info.lastInsertRowid), description
  );
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

app.get('/api/queue', (_req, res) => {
  const rows = db.prepare(`SELECT * FROM agent_queue ORDER BY id DESC`).all();
  res.json({ ok: true, queue: rows });
});

function staffPin() {
  return process.env.MERIDIAN_STAFF_PIN || db.prepare(`SELECT value FROM settings WHERE key='staff_pin'`).get()?.value || '2468';
}

function voiceKey() {
  return process.env.MERIDIAN_VOICE_API_KEY || db.prepare(`SELECT value FROM settings WHERE key='voice_api_key'`).get()?.value || 'meridian-voice-local';
}

function staffAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.body?.token || req.query.token;
    agentStore.checkToken(token);
    req.staffActor = 'authorised-staff';
    next();
  } catch (err) {
    sendError(res, err);
  }
}

app.post('/api/staff/login', (req, res) => {
  try {
    const token = agentStore.createSession(staffPin(), req.body?.pin);
    res.json({ ok: true, token });
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/agent-instructions', staffAuth, (_req, res) => {
  const data = agentStore.currentMap(db);
  res.json({ ok: true, sections: data.rows });
});

app.post('/api/agent-instructions/preview', staffAuth, (req, res) => {
  try {
    const instruction = String(req.body?.instruction || '').trim();
    const preview = agentStore.createPreview(db, instruction, req.staffActor);
    res.json({
      ok: true,
      proposalId: preview.proposalId,
      section: preview.section,
      updated_content: preview.updated_content,
      previous: preview.previous
    });
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/agent-instructions/approve', staffAuth, (req, res) => {
  try {
    const data = agentStore.approve(db, req.body?.proposalId, req.staffActor);
    res.json({ ok: true, sections: data.rows });
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/agent-instructions/cancel', staffAuth, (req, res) => {
  agentStore.cancelProposal(req.body?.proposalId);
  res.json({ ok: true });
});

app.get('/api/agent-instructions/history', staffAuth, (_req, res) => {
  res.json({ ok: true, versions: agentStore.history(db) });
});

app.post('/api/agent-instructions/restore', staffAuth, (req, res) => {
  try {
    const data = agentStore.restore(db, Number(req.body?.versionId), req.staffActor);
    res.json({ ok: true, sections: data.rows });
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/voice-agent/instructions', (req, res) => {
  const key = req.headers['x-voice-key'] || req.query.key;
  if (key !== voiceKey()) {
    return res.status(401).json({ ok: false, error: 'Voice agent key required.' });
  }
  const data = agentStore.currentMap(db);
  res.json({
    ok: true,
    provider: 'vapi',
    prompt: agentStore.compiledPrompt(db),
    sections: data.rows.map((r) => ({ section: r.section, content: r.content, version: r.version }))
  });
});

app.get('/api/audit', (_req, res) => {
  const rows = db.prepare(`SELECT * FROM audit_log ORDER BY id DESC LIMIT 200`).all();
  res.json({ ok: true, events: rows });
});

app.post('/api/desk', (req, res) => {
  const q = String(req.body?.question || '').toLowerCase();
  let answer = 'Meridian charters complete 65-seat coaches. Staff select the number of coaches. Total capacity = number of coaches × 65. One booking reference can hold many coaches. Individual seats are never sold.';
  if (q.includes('seat') && !q.includes('65')) {
    answer = 'Individual seats are never sold. The customer chooses 1, 2, 3 or more complete coaches.';
  } else if (q.includes('65') || q.includes('capacity')) {
    answer = 'Each coach has exactly 65 seats. 1 coach = 65, 2 = 65+65 = 130, 3 = 195, 4 = 260, 5 = 325.';
  } else if (q.includes('how many') || q.includes('calculate')) {
    answer = 'Total capacity = number of coaches × 65. The form does not guess coaches from a passenger range.';
  }
  res.json({ ok: true, answer });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Meridian Coach Operations running on http://localhost:${PORT}`);
  });
}

module.exports = { app, db };
