'use strict';

const SEATS_PER_COACH = 65;

function parseCoachCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    const err = new Error('Number of coaches must be a whole number of 1 or more.');
    err.status = 400;
    throw err;
  }
  return n;
}

function totalCapacity(coachCount) {
  return parseCoachCount(coachCount) * SEATS_PER_COACH;
}

function capacityBreakdown(coachCount) {
  const n = parseCoachCount(coachCount);
  return {
    coaches: n,
    seatsPerCoach: SEATS_PER_COACH,
    parts: Array.from({ length: n }, () => SEATS_PER_COACH),
    expression: Array.from({ length: n }, () => String(SEATS_PER_COACH)).join(' + '),
    totalCapacity: n * SEATS_PER_COACH
  };
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  const as = new Date(aStart).getTime();
  const ae = new Date(aEnd || aStart).getTime();
  const bs = new Date(bStart).getTime();
  const be = new Date(bEnd || bStart).getTime();
  if (Number.isNaN(as) || Number.isNaN(bs)) return false;
  return as <= be && bs <= ae;
}

function nextReference(db) {
  const row = db.prepare(
    `SELECT reference FROM bookings WHERE reference LIKE 'MER-%' OR reference LIKE 'MC-%' ORDER BY id DESC LIMIT 1`
  ).get();
  let seq = 1;
  if (row && row.reference) {
    const part = Number(String(row.reference).split('-').pop());
    if (Number.isFinite(part)) seq = part + 1;
  }
  return `MER-${String(seq).padStart(3, '0')}`;
}

function bookedCoachIdsForWindow(db, departureAt, returnAt, excludeBookingId) {
  const bookings = db.prepare(
    `SELECT id, departure_at, return_at, status FROM bookings WHERE status IN ('pending','confirmed')`
  ).all();
  const ids = new Set();
  for (const b of bookings) {
    if (excludeBookingId && b.id === excludeBookingId) continue;
    if (!rangesOverlap(departureAt, returnAt, b.departure_at, b.return_at)) continue;
    const assigned = db.prepare(`SELECT coach_id FROM booking_coaches WHERE booking_id = ?`).all(b.id);
    for (const row of assigned) ids.add(row.coach_id);
  }
  return ids;
}

function availability(db, { numberOfCoaches, coachesRequired, departureAt, returnAt, excludeBookingId }) {
  const required = parseCoachCount(numberOfCoaches ?? coachesRequired);
  const calc = capacityBreakdown(required);
  const all = db.prepare(
    `SELECT * FROM coaches WHERE status = 'active' ORDER BY code`
  ).all();
  const busy = bookedCoachIdsForWindow(db, departureAt, returnAt, excludeBookingId);
  const available = all.filter((c) => !busy.has(c.id));
  const enough = available.length >= required;
  return {
    numberOfCoaches: required,
    coachesRequired: required,
    seatsPerCoach: SEATS_PER_COACH,
    capacityPerCoach: SEATS_PER_COACH,
    capacityExpression: calc.expression,
    totalCapacity: calc.totalCapacity,
    totalCapacityIfBooked: calc.totalCapacity,
    availableCoaches: available.length,
    totalFleetActive: all.length,
    enough,
    availableList: available,
    message: enough
      ? `${available.length} coach${available.length === 1 ? '' : 'es'} available. This booking requires ${required}.`
      : `Only ${available.length} coach${available.length === 1 ? '' : 'es'} ${available.length === 1 ? 'is' : 'are'} available. This booking requires ${required} coaches.`,
    blockMessage: enough
      ? null
      : `Only ${available.length} coach${available.length === 1 ? '' : 'es'} ${available.length === 1 ? 'is' : 'are'} available. This booking requires ${required} coaches.`
  };
}

function decorate(booking, coaches) {
  const count = coaches.length || booking.coaches_required;
  const calc = capacityBreakdown(count);
  return {
    ...booking,
    coaches,
    seats_per_coach: SEATS_PER_COACH,
    capacity_per_coach: SEATS_PER_COACH,
    capacity_expression: calc.expression,
    total_capacity: calc.totalCapacity
  };
}

function loadCoaches(db, bookingId) {
  return db.prepare(`
    SELECT c.id, c.code, c.name, bc.capacity
    FROM booking_coaches bc
    JOIN coaches c ON c.id = bc.coach_id
    WHERE bc.booking_id = ?
    ORDER BY c.code
  `).all(bookingId);
}

function createBooking(db, payload) {
  const required = parseCoachCount(payload.numberOfCoaches ?? payload.coachesRequired);
  if (!payload.customerName || !payload.phone || !payload.pickupLocation || !payload.destination || !payload.departureAt) {
    const err = new Error('Customer name, phone, pickup, destination and departure date are required.');
    err.status = 400;
    throw err;
  }

  const avail = availability(db, {
    numberOfCoaches: required,
    departureAt: payload.departureAt,
    returnAt: payload.returnAt || payload.departureAt
  });

  if (!avail.enough) {
    const err = new Error(avail.blockMessage);
    err.status = 409;
    err.availability = avail;
    throw err;
  }

  const assigned = avail.availableList.slice(0, required);
  const pricePer = Number(payload.pricePerCoach ?? db.prepare(`SELECT value FROM settings WHERE key='price_per_coach'`).get()?.value ?? 8500);
  const days = Math.max(1, Number(payload.numberOfDays) || 1);
  const total = pricePer * required * days;
  const capacity = totalCapacity(required);
  const reference = nextReference(db);

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO bookings (
        reference, customer_name, company_name, phone, email,
        pickup_location, destination, departure_at, return_at,
        passengers, coaches_required, total_capacity, number_of_days,
        special_requirements, internal_notes,
        price_per_coach, total_price, status
      ) VALUES (
        @reference, @customer_name, @company_name, @phone, @email,
        @pickup_location, @destination, @departure_at, @return_at,
        @passengers, @coaches_required, @total_capacity, @number_of_days,
        @special_requirements, @internal_notes,
        @price_per_coach, @total_price, 'confirmed'
      )
    `).run({
      reference,
      customer_name: payload.customerName.trim(),
      company_name: payload.companyName?.trim() || null,
      phone: payload.phone.trim(),
      email: payload.email?.trim() || null,
      pickup_location: payload.pickupLocation.trim(),
      destination: payload.destination.trim(),
      departure_at: payload.departureAt,
      return_at: payload.returnAt || null,
      passengers: capacity,
      coaches_required: required,
      total_capacity: capacity,
      number_of_days: days,
      special_requirements: payload.specialRequirements?.trim() || null,
      internal_notes: payload.internalNotes?.trim() || null,
      price_per_coach: pricePer,
      total_price: total
    });

    const bookingId = info.lastInsertRowid;
    const insertAssign = db.prepare(
      `INSERT INTO booking_coaches (booking_id, coach_id, capacity) VALUES (?, ?, 65)`
    );
    for (const coach of assigned) insertAssign.run(bookingId, coach.id);

    db.prepare(
      `INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)`
    ).run(
      'operations',
      'booking.confirmed',
      'booking',
      reference,
      `Assigned ${required} coach(es) [${assigned.map((c) => c.code).join(', ')}]. Capacity ${avail.capacityExpression} = ${capacity}`
    );

    return bookingId;
  });

  return getBooking(db, tx());
}

function getBooking(db, idOrRef) {
  const booking = db.prepare(
    `SELECT * FROM bookings WHERE id = ? OR reference = ?`
  ).get(idOrRef, String(idOrRef));
  if (!booking) return null;
  return decorate(booking, loadCoaches(db, booking.id));
}

function listBookings(db) {
  const rows = db.prepare(`SELECT * FROM bookings ORDER BY datetime(departure_at) DESC, id DESC`).all();
  return rows.map((b) => decorate(b, loadCoaches(db, b.id)));
}

function cancelBooking(db, id) {
  const booking = getBooking(db, id);
  if (!booking) {
    const err = new Error('Booking not found.');
    err.status = 404;
    throw err;
  }
  db.prepare(`UPDATE bookings SET status='cancelled', updated_at=datetime('now') WHERE id=?`).run(booking.id);
  db.prepare(
    `INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)`
  ).run('operations', 'booking.cancelled', 'booking', booking.reference, 'Coaches released back to fleet');
  return getBooking(db, booking.id);
}

function markNotify(db, id, channel) {
  const col = channel === 'whatsapp' ? 'whatsapp_sent' : 'sms_sent';
  const booking = getBooking(db, id);
  if (!booking) {
    const err = new Error('Booking not found.');
    err.status = 404;
    throw err;
  }
  db.prepare(`UPDATE bookings SET ${col}=1, updated_at=datetime('now') WHERE id=?`).run(booking.id);
  db.prepare(
    `INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)`
  ).run('operations', `notify.${channel}`, 'booking', booking.reference, `${channel.toUpperCase()} confirmation marked sent`);
  return getBooking(db, booking.id);
}

module.exports = {
  SEATS_PER_COACH,
  parseCoachCount,
  totalCapacity,
  capacityBreakdown,
  availability,
  createBooking,
  getBooking,
  listBookings,
  cancelBooking,
  markNotify
};
