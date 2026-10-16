import { NextResponse } from "next/server";
import { clientInfo } from "@/lib/audit";
import { rateLimit } from "@/lib/ratelimit";
import { accessCodeEnabled, checkAccessCode, startAdminSession } from "@/lib/session";

export async function POST(request: Request) {
  if (!accessCodeEnabled()) {
    return NextResponse.json({ error: "No disponible." }, { status: 404 });
  }

  const { ip } = clientInfo(request);
  const limit = rateLimit(`acceso:${ip ?? "local"}`, 10, 10 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Demasiados intentos. Espera ${limit.retryAfterSeconds} s.` },
      { status: 429 },
    );
  }

  const { code } = (await request.json()) as { code?: string };
  if (!code || !checkAccessCode(code.trim())) {
    return NextResponse.json({ error: "Clave incorrecta." }, { status: 401 });
  }

  await startAdminSession();
  return NextResponse.json({ ok: true });
}
