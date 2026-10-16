import { NextResponse } from "next/server";
import { clientInfo } from "@/lib/audit";
import { recordSignature, resolveToken } from "@/lib/documents";
import { rateLimit } from "@/lib/ratelimit";
import { endSignerSession, hasSignerSession } from "@/lib/session";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const client = clientInfo(request);
  const limit = rateLimit(`sign-submit:${client.ip ?? "local"}`, 15, 10 * 60 * 1000);
  if (!limit.ok) {
    return NextResponse.json({ error: "Demasiadas peticiones." }, { status: 429 });
  }

  const { token } = await params;
  const access = resolveToken(token);
  if (!access.ok) {
    return NextResponse.json({ error: "Enlace no válido." }, { status: 403 });
  }
  if (!(await hasSignerSession(access.signer.id))) {
    return NextResponse.json({ error: "Tu sesión ha caducado. Vuelve a entrar." }, { status: 401 });
  }

  const { signature, consent } = (await request.json()) as {
    signature?: string;
    consent?: boolean;
  };
  if (!consent) {
    return NextResponse.json(
      { error: "Marca la casilla de consentimiento para firmar." },
      { status: 400 },
    );
  }

  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(signature ?? "");
  if (!match) {
    return NextResponse.json({ error: "Dibuja tu firma antes de continuar." }, { status: 400 });
  }

  // El navegador manda solo el trazo. El PDF se sella aquí: el cliente nunca
  // devuelve un documento, así que no puede colar una versión alterada.
  const result = await recordSignature(access.signer.id, match[1], client);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, alreadySigned: result.alreadySigned }, {
      status: result.alreadySigned ? 409 : 400,
    });
  }

  await endSignerSession(access.signer.id);
  return NextResponse.json({ ok: true, completed: result.completed });
}
