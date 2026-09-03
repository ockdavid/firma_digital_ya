import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import CancelButton from "@/components/CancelButton";
import Header from "@/components/Header";
import ResendButton from "@/components/ResendButton";
import { AUDIT_LABEL, auditFor, type AuditType } from "@/lib/audit";
import { getDocument, getSigners } from "@/lib/documents";
import { KIND_LABEL } from "@/lib/labels";
import { formatDateTime } from "@/lib/pdf";
import { isAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DocumentPage({ params }: PageProps<"/documento/[id]">) {
  if (!(await isAdmin())) redirect("/login");

  const { id } = await params;
  const document = getDocument(id);
  if (!document) notFound();
  // Un borrador se termina de preparar, no se consulta.
  if (document.status === "draft") redirect(`/documento/${id}/preparar`);

  const signers = getSigners(id);
  const events = auditFor(id);
  const byId = new Map(signers.map((s) => [s.id, s.name]));
  const completed = document.status === "completed";
  const cancelled = document.status === "cancelled";
  const signedCount = signers.filter((s) => s.status === "signed").length;
  // Un correo que no sale deja el expediente a medias sin que se note: el
  // enlace existe, pero su destinatario no sabe que tiene que firmar.
  const sinCorreo = signers.filter((s) => s.email_error);

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <Link href="/" className="text-sm text-zinc-500 transition hover:text-zinc-900">
          ← Contratos
        </Link>

        <div className="mt-4 mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">{document.title}</h1>
          <p className="mt-1.5 text-sm text-zinc-500">
            {KIND_LABEL[document.kind]} · {document.page_count} páginas · creado el{" "}
            {formatDateTime(new Date(document.created_at))}
          </p>
        </div>

        <div
          className={`card mb-6 flex flex-wrap items-center justify-between gap-3 px-5 py-4 ${
            completed ? "border-emerald-200 bg-emerald-50/60" : cancelled ? "bg-zinc-50" : ""
          }`}
        >
          <p className="text-sm font-medium">
            {completed
              ? `Firmado por todas las partes el ${formatDateTime(new Date(document.completed_at!))}`
              : cancelled
                ? "Expediente cancelado. Los enlaces ya no funcionan."
                : `Faltan ${signers.length - signedCount} de ${signers.length} firmas`}
          </p>
          <div className="flex gap-2">
            <a href={`/api/documents/${id}/file?version=original`} className="btn-secondary">
              Original
            </a>
            <a href={`/api/documents/${id}/file`} className="btn-primary">
              {completed ? "Descargar firmado" : "Ver estado actual"}
            </a>
          </div>
        </div>

        {sinCorreo.length > 0 && !cancelled && (
          <div className="card mb-6 border-red-200 bg-red-50/70 px-5 py-4">
            <p className="text-sm font-semibold text-red-800">
              {sinCorreo.length === 1
                ? "Un correo no llegó a salir"
                : `${sinCorreo.length} correos no llegaron a salir`}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-red-700">
              {sinCorreo.map((s) => s.name).join(", ")}{" "}
              {sinCorreo.length === 1 ? "no ha recibido" : "no han recibido"} nada. El expediente
              está en circulación igualmente: comprueba la dirección y vuelve a enviarle el enlace
              desde su ficha.
            </p>
          </div>
        )}

        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold">Firmantes</h2>
          <ul className="space-y-2.5">
            {signers.map((signer) => (
              <li key={signer.id} className="card flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {signer.name}
                    {signer.role && (
                      <span className="ml-2 font-normal text-zinc-400">{signer.role}</span>
                    )}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">
                    {signer.email} · {signer.doc_id_type.toUpperCase()} {signer.doc_id_masked}
                  </p>
                  {signer.signed_at && (
                    <p className="mt-0.5 text-xs text-emerald-700">
                      Firmado el {formatDateTime(new Date(signer.signed_at))}
                      {signer.sign_ip && ` desde ${signer.sign_ip}`}
                    </p>
                  )}
                  {signer.email_error && (
                    <p className="mt-0.5 text-xs text-red-700">
                      No se pudo enviar el correo: {signer.email_error}
                    </p>
                  )}
                </div>
                {signer.status === "signed" ? (
                  <span className="pill bg-emerald-50 text-emerald-700">Firmado</span>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="pill bg-amber-50 text-amber-700">Pendiente</span>
                    {!cancelled && <ResendButton documentId={id} signerId={signer.id} />}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {!completed && !cancelled && (
            <div className="mt-4 flex justify-end">
              <CancelButton documentId={id} signedCount={signedCount} />
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold">Traza de auditoría</h2>
          <div className="card divide-y divide-zinc-100">
            {events.map((event) => (
              <div key={event.id} className="flex flex-wrap items-baseline gap-x-3 px-5 py-2.5">
                <span className="w-32 shrink-0 font-mono text-xs text-zinc-400">
                  {formatDateTime(new Date(event.created_at))}
                </span>
                <span className="text-xs font-semibold">
                  {AUDIT_LABEL[event.type as AuditType] ?? event.type}
                </span>
                <span className="text-xs text-zinc-500">
                  {event.signer_id ? (byId.get(event.signer_id) ?? "—") : "Tú"}
                  {event.detail ? ` · ${event.detail}` : ""}
                  {event.ip ? ` · ${event.ip}` : ""}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 font-mono text-[11px] leading-relaxed break-all text-zinc-400">
            SHA-256 original: {document.original_sha256}
            <br />
            SHA-256 actual: {document.current_sha256}
          </p>
        </section>
      </main>
    </>
  );
}
