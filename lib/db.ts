// SQLite access for the tracker, using Node's built-in `node:sqlite` (no external
// dependency, no native module, no DB server). Used by BOTH the Next.js reader
// (lib/store.ts) and the standalone indexer (scripts/index.ts).
//
// The whole site runs on one box (node + indexer + web server share this file),
// so a local SQLite file is the simplest, fastest fit: one writer (the indexer),
// many cheap reads (page renders). WAL mode lets reads proceed while the indexer
// writes. To relocate the file, set DCFT_DB; otherwise it lives at ./.data/dcft.sqlite.

import { DatabaseSync, type StatementResultingChanges } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DEFAULT_PATH = ".data/dcft.sqlite";

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!db) {
    const path = process.env.DCFT_DB ?? DEFAULT_PATH;
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    db = new DatabaseSync(path);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    ensureSchema(db);
  }
  return db;
}

/** Create tables if absent. Safe to call repeatedly (idempotent DDL). */
export function ensureSchema(d: DatabaseSync = getDb()): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS blocks (
      height     INTEGER PRIMARY KEY,
      hash       TEXT NOT NULL,
      time       INTEGER NOT NULL,
      scanned_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS commitments (
      height   INTEGER NOT NULL REFERENCES blocks(height) ON DELETE CASCADE,
      slot     INTEGER NOT NULL,
      hstar    TEXT NOT NULL,
      fee_sats INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (height, slot, hstar)
    );
    CREATE INDEX IF NOT EXISTS commitments_slot_idx ON commitments (slot);

    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

// ── Thin query helpers (synchronous — node:sqlite is a sync API) ──────────────

export function get<T = Record<string, unknown>>(
  sql: string,
  ...params: (string | number | bigint | null)[]
): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}

export function all<T = Record<string, unknown>>(
  sql: string,
  ...params: (string | number | bigint | null)[]
): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

export function run(
  sql: string,
  ...params: (string | number | bigint | null)[]
): StatementResultingChanges {
  return getDb().prepare(sql).run(...params);
}

/** Run `fn` inside a single transaction (rolls back on throw). */
export function tx(fn: () => void): void {
  const d = getDb();
  d.exec("BEGIN");
  try {
    fn();
    d.exec("COMMIT");
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}

export function getMeta(key: string): string | null {
  const row = get<{ value: string }>(
    "SELECT value FROM meta WHERE key = ?",
    key,
  );
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  run(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    key,
    value,
  );
}
