import { NextResponse } from "next/server";
import { createDraft } from "@/lib/documents";
import { parseDocumentForm } from "@/lib/documentForm";
import { isAdmin } from "@/lib/session";

export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const parsed = await parseDocumentForm(request, { requirePdf: true });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const result = await createDraft({
    title: parsed.value.title,
    kind: parsed.value.kind,
    pdf: parsed.value.pdf!,
    signers: parsed.value.signers,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, documentId: result.documentId });
}
