import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import DocumentForm from "@/components/DocumentForm";
import Header from "@/components/Header";
import { getDocument, getSigners } from "@/lib/documents";
import type { DocIdType } from "@/lib/dni";
import { isAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function EditarPage({ params }: PageProps<"/documento/[id]/editar">) {
  if (!(await isAdmin())) redirect("/login");

  const { id } = await params;
  const document = getDocument(id);
  if (!document) notFound();
  // Enviado ya no se edita: solo se cancela desde la ficha.
  if (document.status !== "draft") redirect(`/documento/${id}`);

  const signers = getSigners(id);

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
        <Link
          href={`/documento/${id}/preparar`}
          className="text-sm text-zinc-500 transition hover:text-zinc-900"
        >
          ← Volver a preparar
        </Link>
        <h1 className="mt-4 mb-8 text-2xl font-semibold tracking-tight">Editar borrador</h1>
        <DocumentForm
          documentId={id}
          initial={{
            title: document.title,
            kind: document.kind,
            signers: signers.map((s) => ({
              name: s.name,
              email: s.email,
              role: s.role ?? "",
              docIdType: s.doc_id_type as DocIdType,
              docId: "",
              docIdMasked: s.doc_id_masked,
            })),
          }}
        />
      </main>
    </>
  );
}
