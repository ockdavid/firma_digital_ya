import { NextResponse } from "next/server";
import { discardDraft, updateDraft } from "@/lib/documents";
import { parseDocumentForm } from "@/lib/documentForm";
import { isAdmin } from "@/lib/session";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const parsed = await parseDocumentForm(request, { requirePdf: false });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { id } = await params;
  const result = await updateDraft(id, parsed.value);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { id } = await params;
  const result = await discardDraft(id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
