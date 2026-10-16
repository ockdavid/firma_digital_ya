import { NextResponse } from "next/server";
import { savePlacement, type Placement } from "@/lib/documents";
import { isAdmin } from "@/lib/session";

/** Números finitos donde toca; el tamaño y las excepciones son opcionales. */
function cajaValida(caja: { x: unknown; y: unknown; w?: unknown; h?: unknown }): boolean {
  return (
    Number.isFinite(caja.x) &&
    Number.isFinite(caja.y) &&
    (caja.w === undefined || Number.isFinite(caja.w)) &&
    (caja.h === undefined || Number.isFinite(caja.h))
  );
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { placements } = (await request.json()) as { placements?: Placement[] };
  if (!Array.isArray(placements)) {
    return NextResponse.json({ error: "Posiciones mal formadas." }, { status: 400 });
  }
  const valid = placements.every(
    (p) =>
      typeof p?.signerId === "string" &&
      cajaValida(p) &&
      (p.pages === undefined ||
        (Array.isArray(p.pages) &&
          p.pages.every((e) => Number.isInteger(e?.page) && cajaValida(e)))),
  );
  if (!valid) return NextResponse.json({ error: "Posiciones mal formadas." }, { status: 400 });

  const { id } = await params;
  const result = savePlacement(id, placements);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
