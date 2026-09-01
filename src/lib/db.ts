import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config";

export type DocumentKind = "alquiler_habitacion" | "gestion_habitaciones" | "otro";
export type DocumentStatus = "draft" | "sent" | "completed" | "cancelled";
export type SignerStatus = "pending" | "viewed" | "signed";

export interface DocumentRow {
  id: string;
  title: string;
  kind: DocumentKind;
  status: DocumentStatus;
  version: number;
  original_path: string;
  original_sha256: string;
  current_path: string;
  current_sha256: string;
  page_count: number;
  created_at: string;
  completed_at: string | null;
}

export interface SignerRow {
  id: string;
  document_id: string;
  name: string;
  email: string;
  role: string | null;
  order_index: number;
  doc_id_type: string;
  doc_id_hash: string;
  doc_id_masked: string;
  token_hash: string | null;
  token_expires_at: string | null;
  status: SignerStatus;
  /** Posición de la firma, normalizada 0..1 desde la esquina superior izquierda. */
  pos_x: number | null;
  pos_y: number | null;
  failed_attempts: number;
  locked_until: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  sign_ip: string | null;
  sign_user_agent: string | null;
}

export interface AuditRow {
  id: number;
  document_id: string;
  signer_id: string | null;
  type: string;
  detail: string | null;
  ip: string | null;
  user_agent: string | null;
  sha256_before: string | null;
  sha256_after: string | null;
  created_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'otro',
  status          TEXT NOT NULL DEFAULT 'draft',
  version         INTEGER NOT NULL DEFAULT 0,
  original_path   TEXT NOT NULL,
  original_sha256 TEXT NOT NULL,
  current_path    TEXT NOT NULL,
  current_sha256  TEXT NOT NULL,
  page_count      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  completed_at    TEXT
);

CREATE TABLE IF NOT EXISTS signers (
  id               TEXT PRIMARY KEY,
  document_id      TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  email            TEXT NOT NULL,
  role             TEXT,
  order_index      INTEGER NOT NULL DEFAULT 0,
  doc_id_type      TEXT NOT NULL DEFAULT 'dni',
  doc_id_hash      TEXT NOT NULL,
  doc_id_masked    TEXT NOT NULL,
  -- Vacíos mientras el documento es borrador: el enlace nace al enviarlo.
  token_hash       TEXT UNIQUE,
  token_expires_at TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  pos_x            REAL,
  pos_y            REAL,
  failed_attempts  INTEGER NOT NULL DEFAULT 0,
  locked_until     TEXT,
  viewed_at        TEXT,
  signed_at        TEXT,
  sign_ip          TEXT,
  sign_user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_signers_document ON signers(document_id);

-- Registro append-only. Es la prueba de qué pasó y cuándo.
CREATE TABLE IF NOT EXISTS audit_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id   TEXT NOT NULL,
  signer_id     TEXT,
  type          TEXT NOT NULL,
  detail        TEXT,
  ip            TEXT,
  user_agent    TEXT,
  sha256_before TEXT,
  sha256_after  TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_document ON audit_events(document_id, id);

-- Dónde firma cada parte en tus contratos habituales, para no recolocarlo cada vez.
CREATE TABLE IF NOT EXISTS placement_templates (
  kind  TEXT NOT NULL,
  slot  INTEGER NOT NULL,
  pos_x REAL NOT NULL,
  pos_y REAL NOT NULL,
  PRIMARY KEY (kind, slot)
);
`;

/** Columnas añadidas después de la primera versión, para bases ya creadas. */
const MIGRACIONES: { tabla: string; columna: string; definicion: string }[] = [
  { tabla: "signers", columna: "pos_x", definicion: "REAL" },
  { tabla: "signers", columna: "pos_y", definicion: "REAL" },
];

function migrar(database: Database.Database): void {
  for (const { tabla, columna, definicion } of MIGRACIONES) {
    const columnas = database.prepare(`PRAGMA table_info(${tabla})`).all() as { name: string }[];
    if (!columnas.some((c) => c.name === columna)) {
      database.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
    }
  }
}

function open(): Database.Database {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  fs.mkdirSync(config.storageDir, { recursive: true });
  const database = new Database(config.dbPath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.exec(SCHEMA);
  migrar(database);
  return database;
}

// Next.js recarga los módulos en desarrollo: sin esta caché abriríamos
// una conexión nueva en cada cambio de fichero.
const globalForDb = globalThis as unknown as { __firmayaDb?: Database.Database };
export const db: Database.Database = globalForDb.__firmayaDb ?? open();
if (process.env.NODE_ENV !== "production") globalForDb.__firmayaDb = db;

/**
 * Envuelve una escritura crítica en BEGIN IMMEDIATE: SQLite serializa los
 * escritores, así que dos firmantes que pulsan "Firmar" a la vez no pueden
 * estampar sobre la misma versión del PDF y perder una de las dos firmas.
 */
export function writeTransaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
