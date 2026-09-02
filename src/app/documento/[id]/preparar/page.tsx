import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import PrepareFlow from "@/components/PrepareFlow";
import { getDocument, getPageBoxes, getSigners } from "@/lib/documents";
import { KIND_LABEL } from "@/lib/labels";
import { isAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function PrepararPage({ params }: PageProps<"/documento/[id]/preparar">) {
  if (!(await isAdmin())) redirect("/login");

  const { id } = await params;
  const document = getDocument(id);
  if (!document) notFound();
  // Ya enviado: la preparación no tiene sentido, la ficha sí.
  if (document.status !== "draft") redirect(`/documento/${id}`);

  const signers = getSigners(id);
  const pageBoxes = getPageBoxes(id);

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <Link href="/" className="text-sm text-zinc-500 transition hover:text-zinc-900">
          ← Contratos
        </Link>
        <div className="mt-4">
          <PrepareFlow
            documentId={id}
            title={document.title}
            kindLabel={KIND_LABEL[document.kind]}
            pageCount={document.page_count}
            pageBoxes={pageBoxes}
            signers={signers.map((s) => ({
              id: s.id,
              name: s.name,
              email: s.email,
              role: s.role,
              docIdType: s.doc_id_type,
              docIdMasked: s.doc_id_masked,
              posX: s.pos_x,
              posY: s.pos_y,
              posW: s.pos_w,
              posH: s.pos_h,
            }))}
          />
        </div>
      </main>
    </>
  );
}
