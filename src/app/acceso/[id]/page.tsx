import { notFound, redirect } from "next/navigation";
import AccessForm from "@/components/AccessForm";
import { getDocument } from "@/lib/documents";
import { accessCodeEnabled, isAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Puerta corta para los enlaces que manda el bot de Telegram: una sola clave
 * y estás dentro del borrador. Vive mientras ACCESS_CODE esté en el .env.
 */
export default async function AccesoPage({ params }: PageProps<"/acceso/[id]">) {
  if (!accessCodeEnabled()) notFound();

  const { id } = await params;
  const document = getDocument(id);
  if (!document) notFound();

  const destino =
    document.status === "draft" ? `/documento/${id}/preparar` : `/documento/${id}`;
  if (await isAdmin()) redirect(destino);

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Firmaya</h1>
        <p className="mt-1 text-sm text-zinc-500">{document.title}</p>
        <p className="mt-6 mb-4 text-sm text-zinc-600">
          Este contrato llegó desde Telegram. Introduce la clave para prepararlo.
        </p>
        <AccessForm destino={destino} />
      </div>
    </main>
  );
}
