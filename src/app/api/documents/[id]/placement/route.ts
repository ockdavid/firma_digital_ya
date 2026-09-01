import { NextResponse } from "next/server";
import { savePlacement, type Placement } from "@/lib/documents";
import { isAdmin } from "@/lib/session";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { placements } = (await request.json()) as { placements?: Placement[] };
  if (!Array.isArray(placements)) {
    return NextResponse.json({ error: "Posiciones mal formadas." }, { status: 400 });
  }
  const valid = placements.every(
    (p) => typeof p?.signerId === "string" && Number.isFinite(p.x) && Number.isFinite(p.y),
  );
  if (!valid) return NextResponse.json({ error: "Posiciones mal formadas." }, { status: 400 });

  const { id } = await params;
  const result = savePlacement(id, placements);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
