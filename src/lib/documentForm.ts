import { config } from "./config";
import type { DocumentKind } from "./db";
import type { NewSigner } from "./documents";

const KINDS: DocumentKind[] = ["alquiler_habitacion", "gestion_habitaciones", "otro"];

export interface ParsedDocumentForm {
  title: string;
  kind: DocumentKind;
  signers: NewSigner[];
  pdf?: Uint8Array;
}

/**
 * Lee el formulario de alta o edición. El PDF es obligatorio al crear y
 * opcional al editar: si no viene, se conserva el que ya estaba.
 */
export async function parseDocumentForm(
  request: Request,
  { requirePdf }: { requirePdf: boolean },
): Promise<{ ok: true; value: ParsedDocumentForm } | { ok: false; error: string }> {
  const form = await request.formData();
  const file = form.get("pdf");

  let pdf: Uint8Array | undefined;
  if (file instanceof File && file.size > 0) {
    if (file.size > config.maxPdfMb * 1024 * 1024) {
      return { ok: false, error: `El PDF supera los ${config.maxPdfMb} MB.` };
    }
    if (file.type && file.type !== "application/pdf") {
      return { ok: false, error: "El fichero debe ser un PDF." };
    }
    pdf = new Uint8Array(await file.arrayBuffer());
  } else if (requirePdf) {
    return { ok: false, error: "Adjunta el PDF del contrato." };
  }

  let signers: NewSigner[];
  try {
    signers = JSON.parse(String(form.get("signers") ?? "[]")) as NewSigner[];
  } catch {
    return { ok: false, error: "Firmantes mal formados." };
  }
  if (!Array.isArray(signers)) return { ok: false, error: "Firmantes mal formados." };

  const kind = String(form.get("kind") ?? "otro") as DocumentKind;

  return {
    ok: true,
    value: {
      title: String(form.get("title") ?? ""),
      kind: KINDS.includes(kind) ? kind : "otro",
      signers,
      pdf,
    },
  };
}
