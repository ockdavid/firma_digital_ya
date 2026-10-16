import { NextResponse } from "next/server";
import { getSigners, resendInvitation } from "@/lib/documents";
import { isAdmin } from "@/lib/session";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { id } = await params;
  const { signerId, senderName } = (await request.json()) as {
    signerId?: string;
    senderName?: string;
  };

  // El firmante tiene que pertenecer a este documento: sin esta comprobación,
  // la ruta permitiría reenviar el enlace de cualquier expediente.
  if (!signerId || !getSigners(id).some((s) => s.id === signerId)) {
    return NextResponse.json({ error: "Firmante no válido." }, { status: 400 });
  }

  const result = await resendInvitation(signerId, senderName?.trim() || "El remitente");
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
