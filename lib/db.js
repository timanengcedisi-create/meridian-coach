'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.MERIDIAN_DATA_DIR || path.join('/tmp', 'meridian-coach-data');
const DB_PATH = process.env.MERIDIAN_DB || path.join(DATA_DIR, 'meridian.db');
const SCHEMA_PATH = path.join(__dirname, '..', 'schema.sql');

function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw err;
  }
}

function seed(db) {
  const count = db.prepare(`SELECT COUNT(*) AS n FROM coaches`).get().n;
  if (count === 0) {
    const insert = db.prepare(`INSERT INTO coaches (code, name, capacity, status) VALUES (?, ?, 65, 'active')`);
    const fleet = [
      ['MC-01', 'Meridian One'],
      ['MC-02', 'Meridian Two'],
      ['MC-03', 'Meridian Three'],
      ['MC-04', 'Meridian Four'],
      ['MC-05', 'Meridian Five'],
      ['MC-06', 'Meridian Six'],
      ['MC-07', 'Meridian Seven'],
      ['MC-08', 'Meridian Eight']
    ];
    transaction(db, () => {
      for (const [code, name] of fleet) insert.run(code, name);
    });
  }

  const routes = db.prepare(`SELECT COUNT(*) AS n FROM routes`).get().n;
  if (routes === 0) {
    const insertR = db.prepare(`INSERT INTO routes (name, origin, destination, typical_hours) VALUES (?, ?, ?, ?)`);
    insertR.run('Cape Town Waterfront Shuttle', 'Cape Town CBD', 'V&A Waterfront', 0.75);
    insertR.run('Airport Transfer', 'CPT International', 'City Bowl Hotels', 0.6);
    insertR.run('Garden Route Charter', 'Cape Town', 'Knysna', 6.5);
    insertR.run('Winelands Day Charter', 'Cape Town', 'Stellenbosch', 1.25);
    insertR.run('Johannesburg Airport Run', 'Sandton', 'OR Tambo', 0.7);
  }

  const queue = db.prepare(`SELECT COUNT(*) AS n FROM agent_queue`).get().n;
  if (queue === 0) {
    db.prepare(`INSERT INTO agent_queue (caller_name, phone, topic, status) VALUES (?, ?, ?, ?)`).run(
      'Lerato Mokoena', '082 441 2290', 'School charter quote — 150 pax', 'waiting'
    );
    db.prepare(`INSERT INTO agent_queue (caller_name, phone, topic, status) VALUES (?, ?, ?, ?)`).run(
      'James Petersen', '021 555 0188', 'Lost luggage follow-up', 'active'
    );
  }
}

function open() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = DELETE');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  try { db.exec('ALTER TABLE bookings ADD COLUMN total_capacity INTEGER NOT NULL DEFAULT 65'); } catch (_) {}
  seed(db);
  require('./agentStore').seedInstructions(db);
  db.transaction = (fn) => () => transaction(db, fn);
  return db;
}

module.exports = { open, DB_PATH, transaction };
