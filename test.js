'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { totalCapacity, capacityBreakdown, SEATS_PER_COACH } = require('./lib/charter');

const cases = [
  [1, 65],
  [2, 130],
  [3, 195],
  [4, 260],
  [5, 325]
];

console.log('=== Capacity calculation tests ===');
for (const [coaches, seats] of cases) {
  const got = totalCapacity(coaches);
  const calc = capacityBreakdown(coaches);
  assert.strictEqual(got, seats);
  assert.strictEqual(calc.expression.split(' + ').length, coaches);
  assert.strictEqual(calc.totalCapacity, seats);
  console.log(`  PASS  ${coaches} coach(es) → ${calc.expression} = ${got} seats`);
}
assert.strictEqual(SEATS_PER_COACH, 65);

process.env.MERIDIAN_DATA_DIR = path.join('/tmp', 'meridian-coach-test');
process.env.MERIDIAN_DB = path.join(process.env.MERIDIAN_DATA_DIR, 'meridian.db');
fs.mkdirSync(process.env.MERIDIAN_DATA_DIR, { recursive: true });
if (fs.existsSync(process.env.MERIDIAN_DB)) fs.unlinkSync(process.env.MERIDIAN_DB);

const { open } = require('./lib/db');
const charter = require('./lib/charter');
const db = open();

const departure = '2026-10-12T07:00';
const back = '2026-10-12T19:00';

function book(coaches, name) {
  return charter.createBooking(db, {
    customerName: name,
    companyName: 'ABC School',
    phone: '0210000000',
    email: 'ops@example.com',
    pickupLocation: 'Cape Town',
    destination: 'Stellenbosch',
    departureAt: departure,
    returnAt: back,
    numberOfCoaches: coaches,
    numberOfDays: 1
  });
}

console.log('\n=== Multi-coach booking tests ===');

const b1 = book(1, 'One Coach Client');
assert.strictEqual(b1.coaches.length, 1);
assert.strictEqual(b1.total_capacity, 65);
assert.ok(String(b1.reference).startsWith('MER-'));
console.log(`  PASS  1 coach ${b1.reference} → 65 seats (${b1.coaches[0].code})`);
charter.cancelBooking(db, b1.id);

const b2 = book(2, 'Two Coach Client');
assert.strictEqual(b2.coaches.length, 2);
assert.strictEqual(b2.total_capacity, 130);
assert.strictEqual(b2.capacity_expression, '65 + 65');
console.log(`  PASS  2 coaches ${b2.reference} → 130 seats under one reference`);
charter.cancelBooking(db, b2.id);

const b3 = book(3, 'ABC School');
assert.strictEqual(b3.coaches.length, 3);
assert.strictEqual(b3.total_capacity, 195);
assert.strictEqual(new Set(b3.coaches.map((c) => c.code)).size, 3);
b3.coaches.forEach((c) => assert.strictEqual(c.capacity, 65));
console.log(`  PASS  3 coaches ${b3.reference} → 65+65+65 = 195`);

const b4 = book(4, 'Four Coach Client');
assert.strictEqual(b4.coaches.length, 4);
assert.strictEqual(b4.total_capacity, 260);
console.log(`  PASS  4 coaches ${b4.reference} → 260 seats`);

console.log('\n=== Overbooking protection ===');
let blocked = false;
try {
  book(3, 'Should Fail');
} catch (err) {
  blocked = true;
  assert.ok(/Only .* coach/.test(err.message));
  console.log(`  PASS  blocked extra 3-coach booking: ${err.message}`);
}
assert.ok(blocked);

const remaining = charter.availability(db, {
  numberOfCoaches: 1,
  departureAt: departure,
  returnAt: back
});
assert.strictEqual(remaining.availableCoaches, 1);
console.log(`  PASS  remaining available coaches that day: ${remaining.availableCoaches}`);

const otherDay = charter.createBooking(db, {
  customerName: 'Different Day',
  phone: '0211111111',
  pickupLocation: 'Durbanville',
  destination: 'Paarl',
  departureAt: '2026-11-01T08:00',
  returnAt: '2026-11-01T18:00',
  numberOfCoaches: 3
});
assert.strictEqual(otherDay.coaches.length, 3);
console.log(`  PASS  same fleet reusable on another date (${otherDay.reference})`);

console.log('\nAll tests passed.');
process.exit(0);
