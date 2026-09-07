-- Meridian Coach Operations Platform
-- Whole-coach charter: staff select NUMBER OF COACHES
-- Total capacity = coaches × 65
-- ONE booking -> MANY coaches (booking_coaches)

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS coaches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 65 CHECK (capacity = 65),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'retired')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  company_name TEXT,
  phone TEXT NOT NULL,
  email TEXT,
  pickup_location TEXT NOT NULL,
  destination TEXT NOT NULL,
  departure_at TEXT NOT NULL,
  return_at TEXT,
  passengers INTEGER NOT NULL DEFAULT 65,
  coaches_required INTEGER NOT NULL CHECK (coaches_required >= 1),
  total_capacity INTEGER NOT NULL DEFAULT 65,
  number_of_days INTEGER NOT NULL DEFAULT 1 CHECK (number_of_days >= 1),
  special_requirements TEXT,
  internal_notes TEXT,
  price_per_coach REAL NOT NULL DEFAULT 8500,
  total_price REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  sms_sent INTEGER NOT NULL DEFAULT 0,
  whatsapp_sent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Junction: one booking may own many whole coaches
CREATE TABLE IF NOT EXISTS booking_coaches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  coach_id INTEGER NOT NULL REFERENCES coaches(id),
  capacity INTEGER NOT NULL DEFAULT 65 CHECK (capacity = 65),
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (booking_id, coach_id)
);

CREATE INDEX IF NOT EXISTS idx_booking_coaches_booking ON booking_coaches(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_coaches_coach ON booking_coaches(coach_id);
CREATE INDEX IF NOT EXISTS idx_bookings_departure ON bookings(departure_at);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

CREATE TABLE IF NOT EXISTS routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  typical_hours REAL,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS passenger_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lost_luggage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  coach_id INTEGER REFERENCES coaches(id),
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'closed')),
  reported_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caller_name TEXT,
  phone TEXT,
  topic TEXT,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL DEFAULT 'operations',
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_instructions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_instruction_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  note TEXT,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO settings(key, value) VALUES
  ('seats_per_coach', '65'),
  ('price_per_coach', '8500'),
  ('company_name', 'Meridian Coach'),
  ('booking_prefix', 'MER'),
  ('staff_pin', '2468'),
  ('voice_api_key', 'meridian-voice-local');
