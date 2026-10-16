import { config } from "./config";
import { db, writeTransaction, type DocumentKind, type DocumentRow, type SignerRow } from "./db";
import { hashSecret, id, newToken, sha256, tokenHash, verifySecret } from "./crypto";
import { DOC_ID_LABEL, maskDocId, validateDocId, type DocIdType } from "./dni";
import { AUDIT_LABEL, auditFor, logAudit, type AuditType } from "./audit";
import { appendSignaturePage, ingestPdf, stampAllPages } from "./pdf";
import { deleteFile, paths, readFile, saveFile } from "./storage";
import { CAJA_ALTO, CAJA_ANCHO, cajaGuardada, encajar, type Box } from "./box";
import { completedEmail, invitationEmail, sendMail, type Mail } from "./mail";

export interface NewSigner {
  name: string;
  email: string;
  role: string;
  docIdType: DocIdType;
  docId: string;
}

export interface Placement {
  signerId: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  /** Páginas (1..n) donde la firma va en otro sitio que el general. */
  pages?: { page: number; x: number; y: number; w?: number; h?: number }[];
}

/** La caja general del firmante, con el tamaño por defecto si es de antes. */
function cajaDe(signer: SignerRow): Box | null {
  return cajaGuardada(signer.pos_x, signer.pos_y, signer.pos_w, signer.pos_h);
}

/** Excepciones por página de un firmante, indexadas por número de página. */
function cajasPorPagina(signerId: string): Record<number, Box> {
  const rows = db
    .prepare("SELECT page, pos_x, pos_y, pos_w, pos_h FROM signer_page_boxes WHERE signer_id = ?")
    .all(signerId) as { page: number; pos_x: number; pos_y: number; pos_w: number; pos_h: number }[];
  const cajas: Record<number, Box> = {};
  for (const r of rows) cajas[r.page] = { x: r.pos_x, y: r.pos_y, w: r.pos_w, h: r.pos_h };
  return cajas;
}

/** Lo mismo para todo el expediente: lo que necesita la pantalla de colocación. */
export function getPageBoxes(documentId: string): Record<string, Record<number, Box>> {
  const todas: Record<string, Record<number, Box>> = {};
  for (const signer of getSigners(documentId)) {
    const cajas = cajasPorPagina(signer.id);
    if (Object.keys(cajas).length > 0) todas[signer.id] = cajas;
  }
  return todas;
}

/* ---------- Consultas ---------- */

export function listDocuments(): (DocumentRow & { signed: number; total: number })[] {
  return db
    .prepare(
      `SELECT d.*,
              (SELECT COUNT(*) FROM signers s WHERE s.document_id = d.id AND s.status = 'signed') AS signed,
              (SELECT COUNT(*) FROM signers s WHERE s.document_id = d.id) AS total
         FROM documents d
        ORDER BY d.created_at DESC`,
    )
    .all() as (DocumentRow & { signed: number; total: number })[];
}

export function getDocument(documentId: string): DocumentRow | undefined {
  return db.prepare("SELECT * FROM documents WHERE id = ?").get(documentId) as
    | DocumentRow
    | undefined;
}

export function getSigners(documentId: string): SignerRow[] {
  return db
    .prepare("SELECT * FROM signers WHERE document_id = ? ORDER BY order_index ASC")
    .all(documentId) as SignerRow[];
}

/** Busca por el HMAC del token: el valor en claro nunca se guarda. */
export function findSignerByToken(token: string): SignerRow | undefined {
  return db.prepare("SELECT * FROM signers WHERE token_hash = ?").get(tokenHash(token)) as
    | SignerRow
    | undefined;
}

/* ---------- Validacion ---------- */

function validateSigners(
  signers: NewSigner[],
  options: { allowEmptyDocIdUpTo?: number } = {},
): string | null {
  if (signers.length === 0) return "Añade al menos un firmante.";
  if (signers.length > 6) return "Máximo 6 firmantes.";

  for (const [index, signer] of signers.entries()) {
    if (!signer.name.trim()) return "Cada firmante necesita un nombre.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(signer.email)) {
      return `El correo de ${signer.name} no es válido.`;
    }
    // Un firmante que ya existía puede dejar el documento en blanco para
    // conservar el que tenía; uno nuevo tiene que aportarlo.
    const puedeOmitirlo = index < (options.allowEmptyDocIdUpTo ?? 0);
    if (!signer.docId.trim() && puedeOmitirlo) continue;
    const check = validateDocId(signer.docId, signer.docIdType);
    if (!check.ok) return `${signer.name}: ${check.error}`;
  }
  return null;
}

/* ---------- Plantillas de colocacion ---------- */

function templateFor(kind: DocumentKind): Map<number, Box> {
  const rows = db
    .prepare("SELECT slot, pos_x, pos_y, pos_w, pos_h FROM placement_templates WHERE kind = ?")
    .all(kind) as {
    slot: number;
    pos_x: number;
    pos_y: number;
    pos_w: number | null;
    pos_h: number | null;
  }[];
  const plantilla = new Map<number, Box>();
  for (const r of rows) {
    const caja = cajaGuardada(r.pos_x, r.pos_y, r.pos_w, r.pos_h);
    if (caja) plantilla.set(r.slot, caja);
  }
  return plantilla;
}

/**
 * Al enviar, recordamos donde firmo cada parte para el siguiente contrato igual.
 * Solo la caja general: las excepciones dependen del contenido de cada PDF.
 */
function saveTemplate(kind: DocumentKind, signers: SignerRow[]): void {
  const upsert = db.prepare(
    `INSERT INTO placement_templates (kind, slot, pos_x, pos_y, pos_w, pos_h)
          VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(kind, slot) DO UPDATE SET pos_x = excluded.pos_x, pos_y = excluded.pos_y,
                                             pos_w = excluded.pos_w, pos_h = excluded.pos_h`,
  );
  for (const signer of signers) {
    const caja = cajaDe(signer);
    if (caja) upsert.run(kind, signer.order_index, caja.x, caja.y, caja.w, caja.h);
  }
}

/* ---------- Borrador ---------- */

/**
 * Crea el expediente en estado borrador. No genera tokens ni envia nada: hasta
 * que confirmas el envio, todo es reversible.
 */
export async function createDraft(input: {
  title: string;
  kind: DocumentKind;
  pdf: Uint8Array;
  signers: NewSigner[];
}): Promise<{ ok: true; documentId: string } | { ok: false; error: string }> {
  if (!input.title.trim()) return { ok: false, error: "Ponle un título al documento." };
  const invalid = validateSigners(input.signers);
  if (invalid) return { ok: false, error: invalid };

  const ingested = await ingestPdf(input.pdf);
  if (!ingested.ok) return { ok: false, error: ingested.error };

  const documentId = id("doc");
  const originalSha = sha256(ingested.bytes);
  const basePath = paths.version(documentId, 0, id("v").slice(2));
  await saveFile(paths.original(documentId), ingested.bytes);
  await saveFile(basePath, ingested.bytes);

  const template = templateFor(input.kind);

  writeTransaction(() => {
    db.prepare(
      `INSERT INTO documents
         (id, title, kind, status, version, original_path, original_sha256,
          current_path, current_sha256, page_count, created_at)
       VALUES (?, ?, ?, 'draft', 0, ?, ?, ?, ?, ?, ?)`,
    ).run(
      documentId,
      input.title.trim(),
      input.kind,
      paths.original(documentId),
      originalSha,
      basePath,
      originalSha,
      ingested.pageCount,
      new Date().toISOString(),
    );

    input.signers.forEach((signer, index) => insertSigner(documentId, signer, index, template));

    logAudit({
      documentId,
      type: "documento_creado",
      detail: `Borrador con ${input.signers.length} firmante(s), ${ingested.pageCount} página(s)`,
      sha256After: originalSha,
    });
  });

  return { ok: true, documentId };
}

function insertSigner(
  documentId: string,
  signer: NewSigner,
  index: number,
  positions: Map<number, Box>,
): void {
  const normalized = validateDocId(signer.docId, signer.docIdType);
  if (!normalized.ok) throw new Error(normalized.error);
  const position = positions.get(index);

  db.prepare(
    `INSERT INTO signers
       (id, document_id, name, email, role, order_index, doc_id_type, doc_id_hash,
        doc_id_masked, status, pos_x, pos_y, pos_w, pos_h)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
  ).run(
    id("sgn"),
    documentId,
    signer.name.trim(),
    signer.email.trim().toLowerCase(),
    signer.role.trim() || null,
    index,
    signer.docIdType,
    hashSecret(normalized.value),
    maskDocId(normalized.value),
    position?.x ?? null,
    position?.y ?? null,
    position?.w ?? null,
    position?.h ?? null,
  );
}

/**
 * Cambia los datos de un borrador, incluido el PDF si subiste el equivocado.
 * Solo mientras nadie tenga un enlace: en cuanto se envia, deja de ser editable.
 */
export async function updateDraft(
  documentId: string,
  input: { title: string; kind: DocumentKind; signers: NewSigner[]; pdf?: Uint8Array },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const document = getDocument(documentId);
  if (!document) return { ok: false, error: "Documento no encontrado." };
  if (document.status !== "draft") {
    return { ok: false, error: "Solo se pueden editar los borradores." };
  }
  if (!input.title.trim()) return { ok: false, error: "Ponle un título al documento." };

  const existing = getSigners(documentId);
  // Al editar, el documento de identidad puede venir vacío: significa "no lo
  // cambies". No podemos mostrarlo de vuelta porque solo guardamos su hash.
  const invalid = validateSigners(input.signers, {
    allowEmptyDocIdUpTo: existing.length,
  });
  if (invalid) return { ok: false, error: invalid };

  let replacement: { bytes: Uint8Array; pageCount: number; sha: string } | null = null;
  if (input.pdf) {
    const ingested = await ingestPdf(input.pdf);
    if (!ingested.ok) return { ok: false, error: ingested.error };
    replacement = {
      bytes: ingested.bytes,
      pageCount: ingested.pageCount,
      sha: sha256(ingested.bytes),
    };
  }

  let newBasePath: string | null = null;
  if (replacement) {
    newBasePath = paths.version(documentId, 0, id("v").slice(2));
    await saveFile(paths.original(documentId), replacement.bytes);
    await saveFile(newBasePath, replacement.bytes);
  }

  const oldPath = document.current_path;

  writeTransaction(() => {
    db.prepare("UPDATE documents SET title = ?, kind = ? WHERE id = ?").run(
      input.title.trim(),
      input.kind,
      documentId,
    );
    if (replacement && newBasePath) {
      db.prepare(
        `UPDATE documents
            SET original_sha256 = ?, current_path = ?, current_sha256 = ?, page_count = ?
          WHERE id = ?`,
      ).run(replacement.sha, newBasePath, replacement.sha, replacement.pageCount, documentId);
    }

    // Actualizamos por posición en lugar de borrar y reinsertar: así el
    // firmante conserva su documento de identidad y dónde firma.
    input.signers.forEach((signer, index) => {
      const previous = existing[index];
      if (!previous) {
        insertSigner(documentId, signer, index, new Map());
        return;
      }

      db.prepare(
        `UPDATE signers SET name = ?, email = ?, role = ?, doc_id_type = ? WHERE id = ?`,
      ).run(
        signer.name.trim(),
        signer.email.trim().toLowerCase(),
        signer.role.trim() || null,
        signer.docIdType,
        previous.id,
      );

      if (signer.docId.trim()) {
        const normalized = validateDocId(signer.docId, signer.docIdType);
        if (!normalized.ok) throw new Error(normalized.error);
        db.prepare("UPDATE signers SET doc_id_hash = ?, doc_id_masked = ? WHERE id = ?").run(
          hashSecret(normalized.value),
          maskDocId(normalized.value),
          previous.id,
        );
      }
    });

    for (const sobrante of existing.slice(input.signers.length)) {
      db.prepare("DELETE FROM signers WHERE id = ?").run(sobrante.id);
    }

    logAudit({
      documentId,
      type: "borrador_editado",
      detail: replacement ? "Datos y PDF sustituido" : "Datos del borrador",
      sha256After: replacement?.sha ?? null,
    });
  });

  if (replacement && oldPath !== paths.original(documentId)) await deleteFile(oldPath);
  return { ok: true };
}

export function savePlacement(
  documentId: string,
  placements: Placement[],
): { ok: true } | { ok: false; error: string } {
  const document = getDocument(documentId);
  if (!document) return { ok: false, error: "Documento no encontrado." };
  if (document.status !== "draft") {
    return { ok: false, error: "El documento ya se ha enviado." };
  }

  // El envío es la foto completa de la pantalla: quien no viene en la lista
  // se queda sin posición y su rúbrica irá al margen.
  const todos = getSigners(documentId).map((s) => s.id);
  const valid = new Set(todos);
  const update = db.prepare(
    "UPDATE signers SET pos_x = ?, pos_y = ?, pos_w = ?, pos_h = ? WHERE id = ?",
  );
  const borrarPaginas = db.prepare("DELETE FROM signer_page_boxes WHERE signer_id = ?");
  const insertarPagina = db.prepare(
    `INSERT INTO signer_page_boxes (signer_id, page, pos_x, pos_y, pos_w, pos_h)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  writeTransaction(() => {
    const colocados = new Set<string>();

    for (const placement of placements) {
      if (!valid.has(placement.signerId)) continue;
      colocados.add(placement.signerId);

      const general = encajar({
        x: placement.x,
        y: placement.y,
        w: placement.w ?? CAJA_ANCHO,
        h: placement.h ?? CAJA_ALTO,
      });
      update.run(general.x, general.y, general.w, general.h, placement.signerId);

      borrarPaginas.run(placement.signerId);
      for (const excepcion of placement.pages ?? []) {
        if (!Number.isInteger(excepcion.page)) continue;
        if (excepcion.page < 1 || excepcion.page > document.page_count) continue;
        const caja = encajar({
          x: excepcion.x,
          y: excepcion.y,
          w: excepcion.w ?? general.w,
          h: excepcion.h ?? general.h,
        });
        insertarPagina.run(placement.signerId, excepcion.page, caja.x, caja.y, caja.w, caja.h);
      }
    }

    for (const signerId of todos) {
      if (colocados.has(signerId)) continue;
      update.run(null, null, null, null, signerId);
      borrarPaginas.run(signerId);
    }
  });

  return { ok: true };
}

export async function discardDraft(
  documentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const document = getDocument(documentId);
  if (!document) return { ok: false, error: "Documento no encontrado." };
  if (document.status !== "draft") {
    return { ok: false, error: "Solo se pueden descartar borradores." };
  }

  await deleteFile(document.original_path);
  await deleteFile(document.current_path);
  writeTransaction(() => {
    db.prepare("DELETE FROM audit_events WHERE document_id = ?").run(documentId);
    db.prepare("DELETE FROM documents WHERE id = ?").run(documentId);
  });
  return { ok: true };
}

/* ---------- Correo ---------- */

/**
 * Manda un correo y deja constancia de como fue.
 *
 * Un fallo aqui no puede tumbar la operacion -el enlace ya existe y el
 * documento ya esta firmado- pero tampoco puede pasar desapercibido: se guarda
 * en el firmante para que salga en su ficha y se pueda reintentar.
 */
async function entregar(
  documentId: string,
  signer: { id: string; email: string },
  mail: Omit<Mail, "to">,
  tipos: { ok: AuditType; error: AuditType },
  detalle?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await sendMail({ to: signer.email, ...mail });
    db.prepare("UPDATE signers SET email_sent_at = ?, email_error = NULL WHERE id = ?").run(
      new Date().toISOString(),
      signer.id,
    );
    logAudit({ documentId, signerId: signer.id, type: tipos.ok, detail: detalle ?? signer.email });
    return { ok: true };
  } catch (error) {
    const mensaje = (error instanceof Error ? error.message : "envío fallido").slice(0, 300);
    db.prepare("UPDATE signers SET email_error = ? WHERE id = ?").run(mensaje, signer.id);
    logAudit({
      documentId,
      signerId: signer.id,
      type: tipos.error,
      detail: `${signer.email}: ${mensaje}`,
    });
    return { ok: false, error: mensaje };
  }
}

/* ---------- Envio ---------- */

/** Genera los enlaces y los manda. Es el punto en que el documento sale de tus manos. */
export async function sendDocument(
  documentId: string,
  senderName: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const document = getDocument(documentId);
  if (!document) return { ok: false, error: "Documento no encontrado." };
  if (document.status !== "draft") {
    return { ok: false, error: "Este documento ya se envió." };
  }

  const signers = getSigners(documentId);
  if (signers.length === 0) return { ok: false, error: "El documento no tiene firmantes." };

  const expiresAt = new Date(Date.now() + config.tokenTtlDays * 24 * 60 * 60 * 1000);
  const tokens = signers.map((signer) => ({ signer, token: newToken() }));

  writeTransaction(() => {
    const update = db.prepare(
      "UPDATE signers SET token_hash = ?, token_expires_at = ? WHERE id = ?",
    );
    for (const { signer, token } of tokens) {
      update.run(tokenHash(token), expiresAt.toISOString(), signer.id);
    }
    db.prepare("UPDATE documents SET status = 'sent' WHERE id = ? AND status = 'draft'").run(
      documentId,
    );
    saveTemplate(document.kind, signers);
  });

  for (const { signer, token } of tokens) {
    const mail = invitationEmail({
      signerName: signer.name,
      senderName,
      documentTitle: document.title,
      docIdLabel: DOC_ID_LABEL[signer.doc_id_type as DocIdType],
      link: `${config.appUrl}/firmar/${token}`,
      expiresAt,
    });
    await entregar(documentId, signer, mail, {
      ok: "enlace_enviado",
      error: "enlace_fallido",
    });
  }

  return { ok: true };
}

/**
 * Cancela un expediente ya enviado: invalida todos los enlaces de golpe.
 *
 * No permitimos editar un documento enviado y reenviarlo con el mismo enlace:
 * alguien puede haberlo leido o firmado ya, y cambiar el PDF por debajo seria
 * indefendible. Cancelar y volver a enviar deja constancia de lo ocurrido.
 */
export function cancelDocument(documentId: string): { ok: true } | { ok: false; error: string } {
  const document = getDocument(documentId);
  if (!document) return { ok: false, error: "Documento no encontrado." };
  if (document.status === "completed") {
    return { ok: false, error: "Ya está firmado por todas las partes; no se puede cancelar." };
  }
  if (document.status === "cancelled") return { ok: true };

  writeTransaction(() => {
    db.prepare(
      "UPDATE signers SET token_hash = NULL, token_expires_at = NULL WHERE document_id = ?",
    ).run(documentId);
    db.prepare("UPDATE documents SET status = 'cancelled' WHERE id = ?").run(documentId);
    logAudit({ documentId, type: "documento_cancelado", detail: "Enlaces invalidados" });
  });

  return { ok: true };
}

/* ---------- Acceso del firmante ---------- */

export type AccessResult =
  | { ok: true; signer: SignerRow; document: DocumentRow }
  | { ok: false; reason: "desconocido" | "caducado" | "bloqueado" | "cancelado"; until?: string };

export function resolveToken(token: string): AccessResult {
  const signer = findSignerByToken(token);
  if (!signer) return { ok: false, reason: "desconocido" };

  const document = getDocument(signer.document_id);
  if (!document) return { ok: false, reason: "desconocido" };
  if (document.status === "cancelled") return { ok: false, reason: "cancelado" };
  if (document.status === "draft") return { ok: false, reason: "desconocido" };

  if (
    signer.status !== "signed" &&
    (!signer.token_expires_at || new Date(signer.token_expires_at) < new Date())
  ) {
    return { ok: false, reason: "caducado" };
  }
  if (signer.locked_until && new Date(signer.locked_until) > new Date()) {
    return { ok: false, reason: "bloqueado", until: signer.locked_until };
  }

  return { ok: true, signer, document };
}

/**
 * Comprueba el documento de identidad. Cuenta los fallos y bloquea el enlace
 * temporalmente para que nadie pueda probar DNIs a lo bruto.
 */
export function verifyIdentity(
  signer: SignerRow,
  rawDocId: string,
  client: { ip: string | null; userAgent: string | null },
): { ok: true } | { ok: false; error: string; remaining?: number } {
  const parsed = validateDocId(rawDocId, signer.doc_id_type as DocIdType);
  const candidate = parsed.ok ? parsed.value : rawDocId.toUpperCase().replace(/[^0-9A-Z]/g, "");

  if (candidate && verifySecret(candidate, signer.doc_id_hash)) {
    db.prepare("UPDATE signers SET failed_attempts = 0, locked_until = NULL WHERE id = ?").run(
      signer.id,
    );
    logAudit({
      documentId: signer.document_id,
      signerId: signer.id,
      type: "identidad_ok",
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return { ok: true };
  }

  const attempts = signer.failed_attempts + 1;
  const shouldLock = attempts >= config.maxAuthAttempts;
  const lockedUntil = shouldLock
    ? new Date(Date.now() + config.lockMinutes * 60 * 1000).toISOString()
    : null;

  db.prepare("UPDATE signers SET failed_attempts = ?, locked_until = ? WHERE id = ?").run(
    shouldLock ? 0 : attempts,
    lockedUntil,
    signer.id,
  );

  logAudit({
    documentId: signer.document_id,
    signerId: signer.id,
    type: shouldLock ? "enlace_bloqueado" : "identidad_fallida",
    detail: shouldLock ? `Bloqueado ${config.lockMinutes} min` : `Intento ${attempts}`,
    ip: client.ip,
    userAgent: client.userAgent,
  });

  if (shouldLock) {
    return {
      ok: false,
      error: `Demasiados intentos. Vuelve a probar dentro de ${config.lockMinutes} minutos.`,
    };
  }
  return {
    ok: false,
    error: parsed.ok ? "Ese documento no coincide con el del firmante." : parsed.error,
    remaining: config.maxAuthAttempts - attempts,
  };
}

/* ---------- Firma ---------- */

export type SignResult =
  | { ok: true; completed: boolean }
  | { ok: false; error: string; alreadySigned?: boolean };

/**
 * Estampa la firma en todas las paginas y publica la nueva version.
 *
 * El estampado es asincrono y SQLite no puede mantener la fila bloqueada
 * mientras tanto, asi que usamos control optimista: se sella una copia a partir
 * de la version N y solo se acepta si la version sigue siendo N al confirmar.
 * Si otro firmante se ha adelantado, se descarta el fichero y se reintenta
 * sobre la version nueva. Sin esto, dos firmas simultaneas se pisarian.
 */
export async function recordSignature(
  signerId: string,
  signaturePngBase64: string,
  client: { ip: string | null; userAgent: string | null },
): Promise<SignResult> {
  const png = Buffer.from(signaturePngBase64, "base64");
  if (png.length < 200 || png.length > 2 * 1024 * 1024) {
    return { ok: false, error: "La firma no es válida. Vuelve a dibujarla." };
  }
  if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    return { ok: false, error: "La firma debe ser una imagen PNG." };
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    const signer = db.prepare("SELECT * FROM signers WHERE id = ?").get(signerId) as
      | SignerRow
      | undefined;
    if (!signer) return { ok: false, error: "Firmante no encontrado." };
    if (signer.status === "signed") {
      return { ok: false, error: "Este documento ya está firmado por ti.", alreadySigned: true };
    }

    const document = getDocument(signer.document_id);
    if (!document) return { ok: false, error: "Documento no encontrado." };
    if (document.status !== "sent") {
      return { ok: false, error: "Este documento ya no admite firmas." };
    }
    if (!signer.token_expires_at || new Date(signer.token_expires_at) < new Date()) {
      return { ok: false, error: "El enlace ha caducado. Pide uno nuevo." };
    }

    const baseVersion = document.version;
    const current = await readFile(document.current_path);
    if (sha256(current) !== document.current_sha256) {
      return {
        ok: false,
        error: "El documento no coincide con su huella registrada. Avisa al remitente.",
      };
    }

    const stamped = await stampAllPages(current, {
      signaturePngBase64,
      name: signer.name,
      slot: signer.order_index,
      signedAt: new Date(),
      box: cajaDe(signer),
      pageBoxes: cajasPorPagina(signer.id),
    });

    const nextVersion = baseVersion + 1;
    const nextPath = paths.version(document.id, nextVersion, id("v").slice(2));
    const nextSha = sha256(stamped);
    await saveFile(nextPath, stamped);
    await saveFile(paths.signature(document.id, signer.id), png);

    const signedAt = new Date().toISOString();
    const committed = writeTransaction(() => {
      const advanced = db
        .prepare(
          `UPDATE documents SET current_path = ?, current_sha256 = ?, version = ?
            WHERE id = ? AND version = ? AND status = 'sent'`,
        )
        .run(nextPath, nextSha, nextVersion, document.id, baseVersion).changes;
      if (advanced === 0) return false;

      const marked = db
        .prepare(
          `UPDATE signers SET status = 'signed', signed_at = ?, sign_ip = ?, sign_user_agent = ?
            WHERE id = ? AND status <> 'signed'`,
        )
        .run(signedAt, client.ip, client.userAgent?.slice(0, 300) ?? null, signer.id).changes;
      if (marked === 0) throw new Error("carrera-firmante");

      logAudit({
        documentId: document.id,
        signerId: signer.id,
        type: "firmado",
        detail: `Versión ${nextVersion}`,
        ip: client.ip,
        userAgent: client.userAgent,
        sha256Before: document.current_sha256,
        sha256After: nextSha,
      });
      return true;
    });

    if (!committed) {
      await deleteFile(nextPath); // otro firmante se adelantó: reintentamos sobre su versión
      continue;
    }

    const pending = db
      .prepare("SELECT COUNT(*) AS n FROM signers WHERE document_id = ? AND status <> 'signed'")
      .get(document.id) as { n: number };

    if (pending.n === 0) {
      await completeDocument(document.id);
      return { ok: true, completed: true };
    }
    return { ok: true, completed: false };
  }

  return { ok: false, error: "El documento estaba ocupado. Inténtalo de nuevo." };
}

/** Añade la hoja de firmas, cierra el expediente y manda la copia final a todos. */
async function completeDocument(documentId: string): Promise<void> {
  const document = getDocument(documentId);
  if (!document || document.status !== "sent") return;

  const signers = getSigners(documentId);
  const events = auditFor(documentId);
  const byId = new Map(signers.map((s) => [s.id, s]));

  const signatures = await Promise.all(
    signers.map(async (s) => ({
      name: s.name,
      email: s.email,
      role: s.role,
      docIdType: s.doc_id_type,
      docIdMasked: s.doc_id_masked,
      signedAt: s.signed_at!,
      ip: s.sign_ip,
      signaturePngBase64: (await readFile(paths.signature(documentId, s.id))).toString("base64"),
    })),
  );

  const current = await readFile(document.current_path);
  const final = await appendSignaturePage(current, {
    title: document.title,
    documentId: document.id,
    originalSha256: document.original_sha256,
    signatures,
    audit: events.map((e) => ({
      createdAt: e.created_at,
      type: AUDIT_LABEL[e.type as AuditType] ?? e.type,
      who: e.signer_id ? (byId.get(e.signer_id)?.name ?? "-") : "Remitente",
      detail: [e.detail, e.ip].filter(Boolean).join(" "),
    })),
  });

  const finalVersion = document.version + 1;
  const finalPath = paths.version(documentId, finalVersion, id("v").slice(2));
  const finalSha = sha256(final);
  await saveFile(finalPath, final);

  const closed = writeTransaction(() => {
    const changes = db
      .prepare(
        `UPDATE documents
            SET current_path = ?, current_sha256 = ?, version = ?, status = 'completed', completed_at = ?
          WHERE id = ? AND status = 'sent'`,
      )
      .run(finalPath, finalSha, finalVersion, new Date().toISOString(), documentId).changes;
    if (changes === 0) return false;
    logAudit({
      documentId,
      type: "documento_completado",
      detail: `Versión final ${finalVersion}`,
      sha256Before: document.current_sha256,
      sha256After: finalSha,
    });
    return true;
  });
  if (!closed) return;

  const filename = `${slug(document.title)}-firmado.pdf`;
  for (const signer of signers) {
    const mail = completedEmail({
      signerName: signer.name,
      documentTitle: document.title,
      signerNames: signers.map((s) => s.name),
      sha256: finalSha,
    });
    await entregar(
      documentId,
      signer,
      { ...mail, attachments: [{ filename, content: Buffer.from(final) }] },
      { ok: "copia_final_enviada", error: "copia_final_fallida" },
    );
  }
}

/** Invalida el enlace anterior y manda uno nuevo. */
export async function resendInvitation(
  signerId: string,
  senderName: string,
): Promise<{ ok: boolean; error?: string }> {
  const signer = db.prepare("SELECT * FROM signers WHERE id = ?").get(signerId) as
    | SignerRow
    | undefined;
  if (!signer) return { ok: false, error: "Firmante no encontrado." };
  if (signer.status === "signed") return { ok: false, error: "Ese firmante ya ha firmado." };

  const document = getDocument(signer.document_id);
  if (!document) return { ok: false, error: "Documento no encontrado." };
  if (document.status !== "sent") {
    return { ok: false, error: "El expediente no está en circulación." };
  }

  const token = newToken();
  const expiresAt = new Date(Date.now() + config.tokenTtlDays * 24 * 60 * 60 * 1000);
  db.prepare(
    `UPDATE signers SET token_hash = ?, token_expires_at = ?, failed_attempts = 0, locked_until = NULL
      WHERE id = ?`,
  ).run(tokenHash(token), expiresAt.toISOString(), signerId);

  const mail = invitationEmail({
    signerName: signer.name,
    senderName,
    documentTitle: document.title,
    docIdLabel: DOC_ID_LABEL[signer.doc_id_type as DocIdType],
    link: `${config.appUrl}/firmar/${token}`,
    expiresAt,
  });
  const entregado = await entregar(
    document.id,
    signer,
    mail,
    { ok: "enlace_enviado", error: "enlace_fallido" },
    `Reenviado a ${signer.email}`,
  );
  // El enlace anterior ya está invalidado: si el correo no sale, hay que
  // reintentarlo hasta que salga, no dejarlo a medias.
  if (!entregado.ok) {
    return {
      ok: false,
      error: `No se pudo enviar el correo: ${entregado.error}. El enlace anterior ya no vale, vuelve a intentarlo.`,
    };
  }
  return { ok: true };
}

export function slug(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "documento"
  );
}
