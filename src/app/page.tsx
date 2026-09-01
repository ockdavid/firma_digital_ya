import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import { listDocuments } from "@/lib/documents";
import { KIND_LABEL } from "@/lib/labels";
import { formatDateTime } from "@/lib/pdf";
import { isAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  if (!(await isAdmin())) redirect("/login");
  const documents = listDocuments();

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Contratos</h1>
            <p className="mt-1 text-sm text-zinc-500">
              {documents.length === 0
                ? "Todavía no has enviado ninguno."
                : `${documents.length} expediente${documents.length === 1 ? "" : "s"}.`}
            </p>
          </div>
          <Link href="/nuevo" className="btn-primary shrink-0">
            Nuevo contrato
          </Link>
        </div>

        {documents.length === 0 ? (
          <div className="card px-6 py-16 text-center">
            <p className="text-sm text-zinc-500">
              Sube un PDF, añade a quién debe firmarlo y Firmaya enviará a cada uno su enlace.
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {documents.map((doc) => (
              <li key={doc.id}>
                <Link
                  href={
                    doc.status === "draft"
                      ? `/documento/${doc.id}/preparar`
                      : `/documento/${doc.id}`
                  }
                  className="card flex items-center gap-4 px-5 py-4 transition hover:border-zinc-300 hover:shadow-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{doc.title}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {KIND_LABEL[doc.kind]} · {doc.page_count} pág. ·{" "}
                      {formatDateTime(new Date(doc.created_at))}
                    </p>
                  </div>
                  <StatusPill
                    status={doc.status}
                    signed={doc.signed}
                    total={doc.total}
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}

function StatusPill({
  status,
  signed,
  total,
}: {
  status: string;
  signed: number;
  total: number;
}) {
  if (status === "draft") {
    return <span className="pill bg-blue-50 text-blue-700">Borrador sin enviar</span>;
  }
  if (status === "completed") {
    return <span className="pill bg-emerald-50 text-emerald-700">Firmado</span>;
  }
  if (status === "cancelled") {
    return <span className="pill bg-zinc-100 text-zinc-500">Cancelado</span>;
  }
  return (
    <span className="pill bg-amber-50 text-amber-700">
      {signed} de {total} firmas
    </span>
  );
}
