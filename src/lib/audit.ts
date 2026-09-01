import { db, type AuditRow } from "./db";

export type AuditType =
  | "documento_creado"
  | "borrador_editado"
  | "documento_cancelado"
  | "enlace_enviado"
  | "enlace_abierto"
  | "identidad_ok"
  | "identidad_fallida"
  | "enlace_bloqueado"
  | "documento_visualizado"
  | "firmado"
  | "documento_completado"
  | "copia_final_enviada";

export const AUDIT_LABEL: Record<AuditType, string> = {
  documento_creado: "Documento creado",
  borrador_editado: "Borrador editado",
  documento_cancelado: "Expediente cancelado",
  enlace_enviado: "Enlace enviado",
  enlace_abierto: "Enlace abierto",
  identidad_ok: "Identidad verificada",
  identidad_fallida: "Identidad incorrecta",
  enlace_bloqueado: "Enlace bloqueado",
  documento_visualizado: "Documento visualizado",
  firmado: "Firmado",
  documento_completado: "Documento completado",
  copia_final_enviada: "Copia final enviada",
};

const insert = db.prepare(`
  INSERT INTO audit_events
    (document_id, signer_id, type, detail, ip, user_agent, sha256_before, sha256_after, created_at)
  VALUES
    (@document_id, @signer_id, @type, @detail, @ip, @user_agent, @sha256_before, @sha256_after, @created_at)
`);

export function logAudit(event: {
  documentId: string;
  signerId?: string | null;
  type: AuditType;
  detail?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  sha256Before?: string | null;
  sha256After?: string | null;
}): void {
  insert.run({
    document_id: event.documentId,
    signer_id: event.signerId ?? null,
    type: event.type,
    detail: event.detail ?? null,
    ip: event.ip ?? null,
    user_agent: event.userAgent?.slice(0, 300) ?? null,
    sha256_before: event.sha256Before ?? null,
    sha256_after: event.sha256After ?? null,
    created_at: new Date().toISOString(),
  });
}

export function auditFor(documentId: string): AuditRow[] {
  return db
    .prepare("SELECT * FROM audit_events WHERE document_id = ? ORDER BY id ASC")
    .all(documentId) as AuditRow[];
}

/** IP y navegador del firmante. Sin esto, la traza de auditoría no prueba nada. */
export function clientInfo(request: Request): { ip: string | null; userAgent: string | null } {
  const headers = request.headers;
  const forwarded = headers.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    headers.get("cf-connecting-ip") ||
    null;
  return { ip, userAgent: headers.get("user-agent") };
}
