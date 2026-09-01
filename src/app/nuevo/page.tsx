import Link from "next/link";
import { redirect } from "next/navigation";
import DocumentForm from "@/components/DocumentForm";
import Header from "@/components/Header";
import { isAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NewDocumentPage() {
  if (!(await isAdmin())) redirect("/login");

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
        <Link href="/" className="text-sm text-zinc-500 transition hover:text-zinc-900">
          ← Contratos
        </Link>
        <h1 className="mt-4 mb-8 text-2xl font-semibold tracking-tight">Nuevo contrato</h1>
        <DocumentForm />
      </main>
    </>
  );
}
