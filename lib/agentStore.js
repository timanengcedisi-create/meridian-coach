'use strict';

const crypto = require('crypto');
const { SECTIONS, DEFAULT_SECTIONS, proposeUpdate } = require('./promptEngine');

const pending = new Map();
const sessions = new Map();

function seedInstructions(db) {
  const count = db.prepare(`SELECT COUNT(*) AS n FROM agent_instructions`).get().n;
  if (count === 0) {
    const insert = db.prepare(
      `INSERT INTO agent_instructions (section, content, version) VALUES (?, ?, 1)`
    );
    for (const section of SECTIONS) {
      insert.run(section, DEFAULT_SECTIONS[section]);
    }
    snapshot(db, 'system', 'Initial approved instructions');
  }
}

function currentMap(db) {
  const rows = db.prepare(`SELECT section, content, version, updated_at FROM agent_instructions ORDER BY id`).all();
  const map = {};
  for (const row of rows) map[row.section] = row.content;
  return { rows, map };
}

function snapshot(db, actor, note) {
  const { rows } = currentMap(db);
  const payload = {};
  for (const row of rows) payload[row.section] = row.content;
  db.prepare(
    `INSERT INTO agent_instruction_versions (actor, note, snapshot_json) VALUES (?, ?, ?)`
  ).run(actor, note || null, JSON.stringify(payload));
}

function requireStaff(pinExpected, pinGiven) {
  if (!pinGiven || String(pinGiven) !== String(pinExpected)) {
    const err = new Error('Authorised staff PIN required.');
    err.status = 401;
    throw err;
  }
}

function createSession(pinExpected, pinGiven) {
  requireStaff(pinExpected, pinGiven);
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { createdAt: Date.now() });
  return token;
}

function checkToken(token) {
  if (!token || !sessions.has(token)) {
    const err = new Error('Sign in with the staff PIN to manage AI instructions.');
    err.status = 401;
    throw err;
  }
}

function createPreview(db, instruction, actor) {
  const { map } = currentMap(db);
  const result = proposeUpdate(map, instruction);
  const proposalId = crypto.randomBytes(12).toString('hex');
  pending.set(proposalId, {
    ...result,
    previous: map[result.section],
    instruction,
    actor,
    createdAt: Date.now()
  });
  return {
    proposalId,
    section: result.section,
    previous: map[result.section],
    updated_content: result.updated_content
  };
}

function approve(db, proposalId, actor) {
  const item = pending.get(proposalId);
  if (!item) {
    const err = new Error('That preview has expired or was cancelled.');
    err.status = 404;
    throw err;
  }
  snapshot(db, actor, `Before update to ${item.section}`);
  db.prepare(
    `UPDATE agent_instructions SET content = ?, version = version + 1, updated_at = datetime('now'), updated_by = ? WHERE section = ?`
  ).run(item.updated_content, actor, item.section);
  db.prepare(
    `INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)`
  ).run(actor, 'agent.instruction.approved', 'agent_instructions', item.section, item.instruction);
  pending.delete(proposalId);
  return currentMap(db);
}

function cancelProposal(proposalId) {
  pending.delete(proposalId);
}

function history(db) {
  return db.prepare(
    `SELECT id, actor, note, created_at FROM agent_instruction_versions ORDER BY id DESC LIMIT 50`
  ).all();
}

function restore(db, versionId, actor) {
  const row = db.prepare(`SELECT * FROM agent_instruction_versions WHERE id = ?`).get(versionId);
  if (!row) {
    const err = new Error('Version not found.');
    err.status = 404;
    throw err;
  }
  snapshot(db, actor, `Before restore of version ${versionId}`);
  const payload = JSON.parse(row.snapshot_json);
  const update = db.prepare(
    `UPDATE agent_instructions SET content = ?, version = version + 1, updated_at = datetime('now'), updated_by = ? WHERE section = ?`
  );
  for (const section of SECTIONS) {
    if (payload[section]) update.run(payload[section], actor, section);
  }
  db.prepare(
    `INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)`
  ).run(actor, 'agent.instruction.restored', 'agent_instruction_versions', String(versionId), row.note || '');
  return currentMap(db);
}

function compiledPrompt(db) {
  const { rows } = currentMap(db);
  return rows.map((r) => `[${r.section}]\n${r.content}`).join('\n\n');
}

module.exports = {
  seedInstructions,
  currentMap,
  createSession,
  checkToken,
  createPreview,
  approve,
  cancelProposal,
  history,
  restore,
  compiledPrompt,
  sessions
};
