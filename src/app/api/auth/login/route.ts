import { NextResponse } from "next/server";
import { clientInfo } from "@/lib/audit";
import { rateLimit } from "@/lib/ratelimit";
import { checkAdminPassword, startAdminSession } from "@/lib/session";

export async function POST(request: Request) {
  const { ip } = clientInfo(request);
  const limit = rateLimit(`login:${ip ?? "local"}`, 10, 10 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Demasiados intentos. Espera ${limit.retryAfterSeconds} s.` },
      { status: 429 },
    );
  }

  const { password } = (await request.json()) as { password?: string };
  if (!password || !checkAdminPassword(password)) {
    return NextResponse.json({ error: "Contraseña incorrecta." }, { status: 401 });
  }

  await startAdminSession();
  return NextResponse.json({ ok: true });
}
