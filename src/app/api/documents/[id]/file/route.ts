import { NextResponse } from "next/server";
import { getDocument, slug } from "@/lib/documents";
import { isAdmin } from "@/lib/session";
import { readFile } from "@/lib/storage";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { id } = await params;
  const document = getDocument(id);
  if (!document) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const original = new URL(request.url).searchParams.get("version") === "original";
  const bytes = await readFile(original ? document.original_path : document.current_path);
  const suffix = original ? "original" : document.status === "completed" ? "firmado" : "en-curso";

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${slug(document.title)}-${suffix}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
