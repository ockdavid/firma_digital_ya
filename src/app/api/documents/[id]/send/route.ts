import { NextResponse } from "next/server";
import { sendDocument } from "@/lib/documents";
import { isAdmin } from "@/lib/session";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { senderName } = (await request.json().catch(() => ({}))) as { senderName?: string };
  const { id } = await params;

  const result = await sendDocument(id, senderName?.trim() || "El remitente");
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
