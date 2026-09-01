import {
  PDFDocument,
  PDFName,
  StandardFonts,
  degrees,
  rgb,
  type PDFPage,
  type PDFFont,
} from "pdf-lib";

/* --- Geometria ---
   Una pagina PDF puede llevar /Rotate 90, 180 o 270 (tipico en escaneados).
   Trabajamos siempre en "coordenadas visuales" -lo que el firmante ve en
   pantalla- y traducimos al sistema del PDF justo antes de dibujar. */

interface Visual {
  width: number;
  height: number;
  rotation: number;
  toPdf: (vx: number, vy: number) => { x: number; y: number };
}

function visual(page: PDFPage): Visual {
  const { width: w, height: h } = page.getSize();
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  switch (rotation) {
    case 90:
      return { width: h, height: w, rotation, toPdf: (vx, vy) => ({ x: w - vy, y: vx }) };
    case 180:
      return { width: w, height: h, rotation, toPdf: (vx, vy) => ({ x: w - vx, y: h - vy }) };
    case 270:
      return { width: h, height: w, rotation, toPdf: (vx, vy) => ({ x: vy, y: h - vx }) };
    default:
      return { width: w, height: h, rotation: 0, toPdf: (vx, vy) => ({ x: vx, y: vy }) };
  }
}

/** Helvetica usa WinAnsi: acentos y enye si, vinyetas y guiones tipograficos no. */
function ansi(text: string): string {
  return text
    .replace(/[•·]/g, "*")
    .replace(/[—–]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\xFF]/g, "?");
}

export interface StampInput {
  /** PNG en base64 (sin el prefijo data:) del trazo de la firma. */
  signaturePngBase64: string;
  name: string;
  slot: number;
  signedAt: Date;
  /**
   * Punto elegido al preparar el envio, normalizado 0..1 desde la esquina
   * superior izquierda de la pagina. Sin el, la rubrica cae en el margen.
   */
  position: { x: number; y: number } | null;
}

const RUBRIC_W = 58;
const RUBRIC_H = 22;
const PLACED_W = 130;
const PLACED_H = 44;
const MARGIN = 18;

/**
 * Estampa la rubrica del firmante en TODAS las paginas.
 *
 * Con posicion elegida va centrada en ese punto en cada pagina; sin ella, al
 * margen inferior derecho, con un hueco distinto por firmante para que dos
 * rubricas no se solapen.
 */
export async function stampAllPages(
  pdfBytes: Uint8Array,
  input: StampInput,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(pdfBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const png = await pdf.embedPng(Buffer.from(input.signaturePngBase64, "base64"));
  const fecha = formatDate(input.signedAt);

  const maxW = input.position ? PLACED_W : RUBRIC_W;
  const maxH = input.position ? PLACED_H : RUBRIC_H;
  const scale = Math.min(maxW / png.width, maxH / png.height);
  const imgW = png.width * scale;
  const imgH = png.height * scale;

  for (const page of pdf.getPages()) {
    const v = visual(page);

    let x: number;
    let y: number;
    if (input.position) {
      // El punto marcado es el centro del bloque de firma.
      const cx = input.position.x * v.width;
      const cy = (1 - input.position.y) * v.height;
      x = clamp(cx - imgW / 2, MARGIN, v.width - imgW - MARGIN);
      y = clamp(cy - imgH / 2, MARGIN + 7, v.height - imgH - MARGIN);
    } else {
      x = v.width - MARGIN - (input.slot + 1) * (RUBRIC_W + 8) + 8;
      if (x < MARGIN) continue; // demasiados firmantes para el ancho de pagina
      y = MARGIN + 10;
    }

    const img = v.toPdf(x, y);
    page.drawImage(png, {
      x: img.x,
      y: img.y,
      width: imgW,
      height: imgH,
      rotate: degrees(v.rotation),
      opacity: 0.95,
    });

    const caption = v.toPdf(x, y - 7);
    page.drawText(ansi(`${shortName(input.name)} ${fecha}`), {
      x: caption.x,
      y: caption.y,
      size: 5,
      font,
      color: rgb(0.35, 0.35, 0.4),
      rotate: degrees(v.rotation),
    });
  }

  return pdf.save({ useObjectStreams: false });
}

export interface SignatureSummary {
  name: string;
  email: string;
  role: string | null;
  docIdType: string;
  docIdMasked: string;
  signedAt: string;
  ip: string | null;
  signaturePngBase64: string;
}

export interface AuditLine {
  createdAt: string;
  type: string;
  who: string;
  detail: string;
}

/**
 * Anyade la hoja de firmas al final: bloque por firmante y traza de auditoria.
 * Es lo que convierte un dibujo pegado en un documento defendible.
 */
export async function appendSignaturePage(
  pdfBytes: Uint8Array,
  opts: {
    title: string;
    documentId: string;
    originalSha256: string;
    signatures: SignatureSummary[];
    audit: AuditLine[];
  },
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(pdfBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([595.28, 841.89]); // A4
  let y = 800;

  const write = (text: string, size: number, f: PDFFont, color = rgb(0.1, 0.1, 0.12)) => {
    page.drawText(ansi(text), { x: 48, y, size, font: f, color });
    y -= size + 5;
  };

  const breakIfNeeded = (needed: number) => {
    if (y - needed < 60) {
      page = pdf.addPage([595.28, 841.89]);
      y = 800;
    }
  };

  write("Hoja de firmas electronicas", 17, bold);
  y -= 4;
  write(opts.title, 10, font, rgb(0.35, 0.35, 0.4));
  write(`Expediente ${opts.documentId}`, 8, font, rgb(0.45, 0.45, 0.5));
  write(
    `Huella SHA-256 del documento original: ${opts.originalSha256}`,
    6.5,
    font,
    rgb(0.45, 0.45, 0.5),
  );
  y -= 12;

  for (const s of opts.signatures) {
    breakIfNeeded(120);
    page.drawLine({
      start: { x: 48, y },
      end: { x: 547, y },
      thickness: 0.5,
      color: rgb(0.85, 0.85, 0.88),
    });
    y -= 16;

    const png = await pdf.embedPng(Buffer.from(s.signaturePngBase64, "base64"));
    const scale = Math.min(150 / png.width, 52 / png.height);
    page.drawImage(png, {
      x: 380,
      y: y - 46,
      width: png.width * scale,
      height: png.height * scale,
    });

    write(s.name, 11, bold);
    if (s.role) write(s.role, 8.5, font, rgb(0.4, 0.4, 0.45));
    write(`${s.docIdType.toUpperCase()} ${s.docIdMasked}`, 8.5, font, rgb(0.3, 0.3, 0.35));
    write(s.email, 8.5, font, rgb(0.4, 0.4, 0.45));
    write(
      `Firmado el ${formatDateTime(new Date(s.signedAt))}${s.ip ? `  -  IP ${s.ip}` : ""}`,
      8,
      font,
      rgb(0.4, 0.4, 0.45),
    );
    y -= 22;
  }

  breakIfNeeded(140);
  y -= 10;
  write("Traza de auditoria", 12, bold);
  y -= 2;

  for (const line of opts.audit) {
    breakIfNeeded(16);
    page.drawText(ansi(formatDateTime(new Date(line.createdAt))), {
      x: 48,
      y,
      size: 7,
      font,
      color: rgb(0.45, 0.45, 0.5),
    });
    page.drawText(ansi(line.type), {
      x: 158,
      y,
      size: 7,
      font: bold,
      color: rgb(0.2, 0.2, 0.25),
    });
    page.drawText(ansi(`${line.who}${line.detail ? ` - ${line.detail}` : ""}`.slice(0, 78)), {
      x: 268,
      y,
      size: 7,
      font,
      color: rgb(0.3, 0.3, 0.35),
    });
    y -= 11;
  }

  y -= 16;
  breakIfNeeded(40);
  const legal = [
    "Firma electronica simple conforme al Reglamento (UE) 910/2014 (eIDAS). La identidad de cada",
    "firmante se verifico mediante un enlace personal enviado a su correo y su documento de identidad.",
  ];
  legal.forEach((line, i) => {
    page.drawText(ansi(line), {
      x: 48,
      y: y - i * 9,
      size: 6.5,
      font,
      color: rgb(0.5, 0.5, 0.55),
    });
  });

  return pdf.save({ useObjectStreams: false });
}

/**
 * Comprueba que el fichero es un PDF legible y le quita lo que puede ejecutarse:
 * JavaScript embebido, acciones de apertura y campos de formulario.
 */
export async function ingestPdf(
  bytes: Uint8Array,
): Promise<{ ok: true; bytes: Uint8Array; pageCount: number } | { ok: false; error: string }> {
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/encrypt/i.test(message)) {
      return {
        ok: false,
        error: "El PDF está protegido con contraseña. Quítasela y vuelve a subirlo.",
      };
    }
    return { ok: false, error: "El fichero no es un PDF válido." };
  }

  if (pdf.getPageCount() === 0) return { ok: false, error: "El PDF no tiene páginas." };

  pdf.catalog.delete(PDFName.of("Names"));
  pdf.catalog.delete(PDFName.of("OpenAction"));
  pdf.catalog.delete(PDFName.of("AA"));
  try {
    pdf.getForm().flatten();
  } catch {
    // Sin formulario, o con campos que no se pueden aplanar: seguimos igual.
  }

  return {
    ok: true,
    bytes: await pdf.save({ useObjectStreams: false }),
    pageCount: pdf.getPageCount(),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0];
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDateTime(d: Date): string {
  return d.toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Madrid",
  });
}
