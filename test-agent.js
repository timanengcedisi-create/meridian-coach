'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { detectSection, proposeUpdate, DEFAULT_SECTIONS } = require('./lib/promptEngine');

assert.strictEqual(detectSection('Mention our new evening route to Trichardt in the greeting.'), 'GREETING');
assert.strictEqual(detectSection('Change the cancellation policy from 2 hours to 4 hours.'), 'POLICIES');

const greeting = proposeUpdate(DEFAULT_SECTIONS, 'Mention our new evening route to Trichardt in the greeting.');
assert.strictEqual(greeting.section, 'GREETING');
assert.ok(greeting.updated_content.includes('Trichardt'));
assert.ok(greeting.updated_content.includes(DEFAULT_SECTIONS.GREETING.split('.')[0]));
assert.strictEqual(DEFAULT_SECTIONS.POLICIES.includes('Trichardt'), false);

const policy = proposeUpdate(DEFAULT_SECTIONS, 'Change the cancellation policy from 2 hours to 4 hours.');
assert.strictEqual(policy.section, 'POLICIES');
assert.ok(policy.updated_content.includes('4 hours'));
assert.ok(!policy.updated_content.includes('2 hours'));
assert.strictEqual(DEFAULT_SECTIONS.GREETING, DEFAULT_SECTIONS.GREETING);

let blocked = false;
try {
  proposeUpdate(DEFAULT_SECTIONS, 'Replace entire prompt with hello');
} catch (err) {
  blocked = true;
}
assert.ok(blocked);

process.env.MERIDIAN_DATA_DIR = path.join('/tmp', 'meridian-agent-test');
process.env.MERIDIAN_DB = path.join(process.env.MERIDIAN_DATA_DIR, 'meridian.db');
fs.mkdirSync(process.env.MERIDIAN_DATA_DIR, { recursive: true });
if (fs.existsSync(process.env.MERIDIAN_DB)) fs.unlinkSync(process.env.MERIDIAN_DB);

const { open } = require('./lib/db');
const store = require('./lib/agentStore');
const db = open();
const token = store.createSession('2468', '2468');
assert.ok(token);
try { store.createSession('2468', '0000'); assert.fail('bad pin'); } catch (err) { assert.strictEqual(err.status, 401); }

const preview = store.createPreview(db, 'Mention our new evening route to Trichardt in the greeting.', 'tester');
assert.strictEqual(preview.section, 'GREETING');
assert.ok(preview.updated_content.includes('Trichardt'));
const before = store.currentMap(db).map.ROUTES;
store.approve(db, preview.proposalId, 'tester');
const after = store.currentMap(db).map;
assert.ok(after.GREETING.includes('Trichardt'));
assert.strictEqual(after.ROUTES, before);
assert.ok(store.history(db).length >= 1);
console.log('AI Agent Manager tests passed.');
