import { NextResponse } from "next/server";
import { clientInfo } from "@/lib/audit";
import { resolveToken, verifyIdentity } from "@/lib/documents";
import { rateLimit } from "@/lib/ratelimit";
import { startSignerSession } from "@/lib/session";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const client = clientInfo(request);
  const limit = rateLimit(`sign-auth:${client.ip ?? "local"}`, 20, 10 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Demasiados intentos. Espera ${limit.retryAfterSeconds} s.` },
      { status: 429 },
    );
  }

  const { token } = await params;
  const access = resolveToken(token);
  if (!access.ok) {
    // Respuesta genérica: no revelamos si el enlace existe o solo ha caducado.
    return NextResponse.json({ error: "Este enlace ya no es válido." }, { status: 403 });
  }

  const { docId } = (await request.json()) as { docId?: string };
  const verification = verifyIdentity(access.signer, String(docId ?? ""), client);
  if (!verification.ok) {
    return NextResponse.json(
      { error: verification.error, remaining: verification.remaining },
      { status: 401 },
    );
  }

  await startSignerSession(access.signer.id);
  return NextResponse.json({ ok: true });
}
