import { NextResponse } from "next/server";
import { createDraft } from "@/lib/documents";
import { parseDocumentForm } from "@/lib/documentForm";
import { isAdmin, isBot } from "@/lib/session";

export async function POST(request: Request) {
  // El panel entra con cookie; el bot de Telegram, con su clave de API.
  if (!(await isAdmin()) && !isBot(request)) {
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
