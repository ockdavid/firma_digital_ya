import { NextResponse } from "next/server";
import { resolveToken, slug } from "@/lib/documents";
import { hasSignerSession } from "@/lib/session";
import { readFile } from "@/lib/storage";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const access = resolveToken(token);
  if (!access.ok) {
    return NextResponse.json({ error: "Enlace no válido." }, { status: 403 });
  }
  // El PDF solo sale de aquí si esa persona ya ha acreditado su identidad.
  if (!(await hasSignerSession(access.signer.id))) {
    return NextResponse.json({ error: "Verifica tu identidad primero." }, { status: 401 });
  }

  const bytes = await readFile(access.document.current_path);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${slug(access.document.title)}.pdf"`,
      "Cache-Control": "no-store, private",
    },
  });
}
