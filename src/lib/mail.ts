import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";

export interface Attachment {
  filename: string;
  content: Buffer;
}

export interface Mail {
  to: string;
  subject: string;
  html: string;
  attachments?: Attachment[];
}

/**
 * En desarrollo (EMAIL_DRIVER=console) no se envía nada: el correo se guarda en
 * storage/outbox y el enlace se imprime en la terminal. Así puedes probar el
 * circuito completo sin dar de alta un dominio.
 */
export async function sendMail(mail: Mail): Promise<void> {
  if (config.emailDriver === "resend") {
    const { Resend } = await import("resend");
    const resend = new Resend(config.resendApiKey);
    const { error } = await resend.emails.send({
      from: config.mailFrom,
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      attachments: mail.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content.toString("base64"),
      })),
    });
    if (error) throw new Error(`Resend: ${error.message}`);
    return;
  }

  const dir = path.join(config.storageDir, "outbox");
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeTo = mail.to.replace(/[^a-zA-Z0-9@._-]/g, "_");
  await fs.writeFile(path.join(dir, `${stamp}--${safeTo}.html`), mail.html, "utf8");
  for (const a of mail.attachments ?? []) {
    await fs.writeFile(path.join(dir, `${stamp}--${a.filename}`), a.content);
  }
  console.log(`\n[correo simulado] Para: ${mail.to}\n  Asunto: ${mail.subject}`);
  const link = mail.html.match(/https?:\/\/[^"'\s<]+\/firmar\/[^"'\s<]+/)?.[0];
  if (link) console.log(`  Enlace de firma: ${link}\n`);
}

/* --- Plantillas --- */

function layout(body: string): string {
  return `<!doctype html><html lang="es"><body style="margin:0;padding:32px 16px;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:12px;border:1px solid #e4e4e7">
      <tr><td style="padding:32px">${body}</td></tr>
    </table>
    <p style="max-width:520px;margin:16px auto 0;font-size:11px;line-height:1.6;color:#a1a1aa;text-align:left">
      Enviado por Firmaya. Si no esperabas este correo, ignóralo: sin tu documento de identidad el enlace no abre nada.
    </p>
  </td></tr></table>
</body></html>`;
}

export function invitationEmail(opts: {
  signerName: string;
  senderName: string;
  documentTitle: string;
  docIdLabel: string;
  link: string;
  expiresAt: Date;
}): { subject: string; html: string } {
  return {
    subject: `Firma pendiente: ${opts.documentTitle}`,
    html: layout(`
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6">Hola ${escapeHtml(opts.signerName)},</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6">
        ${escapeHtml(opts.senderName)} te pide que firmes <strong>${escapeHtml(opts.documentTitle)}</strong>.
      </p>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6">
        Para abrirlo necesitarás tu <strong>${escapeHtml(opts.docIdLabel)}</strong>. El enlace es personal: no lo reenvíes.
      </p>
      <a href="${opts.link}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font-size:15px;font-weight:600">Revisar y firmar</a>
      <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#71717a">
        Caduca el ${opts.expiresAt.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}.
      </p>
      <p style="margin:8px 0 0;font-size:12px;line-height:1.6;color:#a1a1aa;word-break:break-all">${opts.link}</p>
    `),
  };
}

export function completedEmail(opts: {
  signerName: string;
  documentTitle: string;
  signerNames: string[];
  sha256: string;
}): { subject: string; html: string } {
  return {
    subject: `Documento firmado: ${opts.documentTitle}`,
    html: layout(`
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6">Hola ${escapeHtml(opts.signerName)},</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6">
        <strong>${escapeHtml(opts.documentTitle)}</strong> ya está firmado por todas las partes.
        Adjuntamos la copia final.
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:#52525b">Firmantes:</p>
      <ul style="margin:0 0 20px;padding-left:18px;font-size:13px;line-height:1.8;color:#52525b">
        ${opts.signerNames.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}
      </ul>
      <p style="margin:0;font-size:11px;line-height:1.6;color:#a1a1aa;word-break:break-all">
        Huella SHA-256 del documento final:<br>${opts.sha256}
      </p>
    `),
  };
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
