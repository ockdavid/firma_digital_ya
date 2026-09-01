import { headers } from "next/headers";
import SignFlow from "@/components/SignFlow";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { resolveToken } from "@/lib/documents";
import { DOC_ID_LABEL, type DocIdType } from "@/lib/dni";
import { hasSignerSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SignPage({ params }: PageProps<"/firmar/[token]">) {
  const { token } = await params;
  const access = resolveToken(token);

  if (!access.ok) {
    const messages: Record<string, string> = {
      desconocido: "Este enlace no existe o ya se ha invalidado.",
      caducado: "Este enlace ha caducado. Pide al remitente que te envíe uno nuevo.",
      bloqueado: "El enlace está bloqueado temporalmente tras varios intentos fallidos.",
      cancelado: "El remitente ha cancelado este documento.",
    };
    return <Notice title="No podemos abrir el documento" body={messages[access.reason]} />;
  }

  const { signer, document } = access;

  if (signer.status === "signed") {
    return (
      <Notice
        title="Ya has firmado"
        body={`Firmaste "${document.title}". Cuando el resto de partes firme, recibirás la copia final en ${signer.email}.`}
        tone="ok"
      />
    );
  }

  // Solo la primera apertura genera evento: si no, recargar la página inflaría
  // la traza de auditoría con ruido.
  if (!signer.viewed_at) {
    const headerList = await headers();
    db.prepare("UPDATE signers SET viewed_at = ?, status = 'viewed' WHERE id = ?").run(
      new Date().toISOString(),
      signer.id,
    );
    logAudit({
      documentId: document.id,
      signerId: signer.id,
      type: "enlace_abierto",
      ip: headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: headerList.get("user-agent"),
    });
  }

  return (
    <SignFlow
      token={token}
      signerName={signer.name}
      signerRole={signer.role}
      documentTitle={document.title}
      pageCount={document.page_count}
      docIdLabel={DOC_ID_LABEL[signer.doc_id_type as DocIdType]}
      authenticated={await hasSignerSession(signer.id)}
    />
  );
}

function Notice({
  title,
  body,
  tone = "neutral",
}: {
  title: string;
  body: string;
  tone?: "neutral" | "ok";
}) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="card w-full max-w-md p-8 text-center">
        <div
          className={`mx-auto mb-5 flex h-11 w-11 items-center justify-center rounded-full text-lg ${
            tone === "ok" ? "bg-emerald-50 text-emerald-600" : "bg-zinc-100 text-zinc-500"
          }`}
          aria-hidden
        >
          {tone === "ok" ? "✓" : "!"}
        </div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-500">{body}</p>
      </div>
    </main>
  );
}
