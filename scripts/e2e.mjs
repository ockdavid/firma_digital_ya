import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { PDFDocument, StandardFonts } from "pdf-lib";

const BASE = process.env.BASE ?? "http://localhost:3111";
const ADMIN = process.env.ADMIN_PASSWORD ?? "test-admin-pass";
const OUTBOX = process.env.OUTBOX;

let failures = 0;
function check(label, condition, extra = "") {
  const mark = condition ? "OK  " : "FAIL";
  if (!condition) failures++;
  console.log(`  [${mark}] ${label}${extra ? ` — ${extra}` : ""}`);
}

/* ---- PNG mínimo (RGBA) para simular el trazo de firma ---- */
function makePng(width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const i = row + 1 + x * 4;
      const ink = y > height / 3 && y < (height * 2) / 3;
      raw[i] = 10; raw[i + 1] = 10; raw[i + 2] = 20; raw[i + 3] = ink ? 255 : 0;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

async function makeContractPdf(pages, etiqueta = "Contrato de alquiler de habitacion") {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = pdf.addPage([595.28, 841.89]);
    page.drawText(`${etiqueta} - pagina ${i + 1}`, { x: 60, y: 760, size: 13, font });
  }
  return Buffer.from(await pdf.save());
}

function cookieJar() {
  const jar = new Map();
  return {
    absorb(response) {
      for (const raw of response.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(";");
        const idx = pair.indexOf("=");
        jar.set(pair.slice(0, idx), pair.slice(idx + 1));
      }
    },
    header() {
      return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    },
  };
}

const correos = () => (fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX) : []);
const invitaciones = () => correos().filter((f) => f.endsWith(".html"));

function tokenDe(patronCorreo) {
  const ficheros = invitaciones()
    .filter((f) => f.includes(patronCorreo))
    .sort();
  const ultimo = ficheros[ficheros.length - 1];
  if (!ultimo) return null;
  return fs.readFileSync(path.join(OUTBOX, ultimo), "utf8").match(/\/firmar\/([A-Za-z0-9_-]+)/)?.[1];
}

function formularioContrato({ titulo, pdf, signers, kind = "alquiler_habitacion" }) {
  const form = new FormData();
  form.set("title", titulo);
  form.set("kind", kind);
  if (pdf) form.set("pdf", new Blob([pdf], { type: "application/pdf" }), "contrato.pdf");
  form.set("signers", JSON.stringify(signers));
  return form;
}

async function main() {
  const admin = cookieJar();

  console.log("\n1. Panel de administracion");
  let res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "incorrecta" }),
  });
  check("rechaza contraseña incorrecta", res.status === 401);

  res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: ADMIN }),
  });
  admin.absorb(res);
  check("acepta contraseña correcta", res.ok);

  res = await fetch(`${BASE}/api/documents`, { method: "POST", body: new FormData() });
  check("bloquea creacion sin sesion", res.status === 401);

  console.log("\n2. Borrador");
  const pdfMalo = await makeContractPdf(1, "CONTRATO EQUIVOCADO");
  const pdfBueno = await makeContractPdf(3);
  const signers = [
    { name: "David Perez", email: "david@example.com", role: "Arrendador", docIdType: "dni", docId: "12345678Z" },
    { name: "Lucia Gomez", email: "lucia@example.com", role: "Arrendataria", docIdType: "nie", docId: "X1234567L" },
  ];

  res = await fetch(`${BASE}/api/documents`, {
    method: "POST",
    headers: { Cookie: admin.header() },
    body: formularioContrato({
      titulo: "Contrato",
      pdf: pdfBueno,
      signers: [{ ...signers[0], docId: "12345678A" }],
    }),
  });
  check("rechaza DNI con letra invalida", res.status === 400, (await res.json()).error);

  const correosAntes = invitaciones().length;
  res = await fetch(`${BASE}/api/documents`, {
    method: "POST",
    headers: { Cookie: admin.header() },
    body: formularioContrato({
      titulo: "Contrato de alquiler - Habitacion 2",
      pdf: pdfMalo,
      signers,
    }),
  });
  const created = await res.json();
  const documentId = created.documentId;
  check("crea el borrador", res.ok && Boolean(documentId), documentId ?? created.error);
  check("crear NO envia ningun correo", invitaciones().length === correosAntes);

  res = await fetch(`${BASE}/api/documents/${documentId}/file`, {
    headers: { Cookie: admin.header() },
  });
  let actual = await PDFDocument.load(Buffer.from(await res.arrayBuffer()));
  check("el borrador guarda el PDF subido", actual.getPageCount() === 1);

  console.log("\n3. Correccion antes de enviar");
  res = await fetch(`${BASE}/api/documents/${documentId}`, {
    method: "PATCH",
    headers: { Cookie: admin.header() },
    body: formularioContrato({
      titulo: "Contrato de alquiler - Habitacion 2 (corregido)",
      pdf: pdfBueno,
      signers: [
        { ...signers[0], email: "david.nuevo@example.com", docId: "" },
        { ...signers[1], docId: "" },
      ],
    }),
  });
  check("sustituye el PDF equivocado", res.ok, res.ok ? "" : (await res.json()).error);

  res = await fetch(`${BASE}/api/documents/${documentId}/file`, {
    headers: { Cookie: admin.header() },
  });
  actual = await PDFDocument.load(Buffer.from(await res.arrayBuffer()));
  check("ahora el borrador tiene el PDF bueno", actual.getPageCount() === 3);

  console.log("\n4. Colocacion de las firmas");
  res = await fetch(`${BASE}/api/documents/${documentId}/placement`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: admin.header() },
    body: JSON.stringify({ placements: [{ signerId: "sgn_inventado", x: "no" }] }),
  });
  check("rechaza posiciones mal formadas", res.status === 400);

  // No hay endpoint que liste firmantes: los sacamos de la pagina de preparacion.
  const preparar = await (
    await fetch(`${BASE}/documento/${documentId}/preparar`, { headers: { Cookie: admin.header() } })
  ).text();
  const signerIds = [...new Set([...preparar.matchAll(/sgn_[A-Za-z0-9_-]{12}/g)].map((m) => m[0]))];
  check("la pagina de preparacion expone los dos firmantes", signerIds.length === 2, signerIds.join(","));

  res = await fetch(`${BASE}/api/documents/${documentId}/placement`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: admin.header() },
    body: JSON.stringify({
      placements: [
        { signerId: signerIds[0], x: 0.25, y: 0.82 },
        { signerId: signerIds[1], x: 0.72, y: 0.82 },
      ],
    }),
  });
  check("guarda las posiciones", res.ok);

  console.log("\n5. Envio");
  res = await fetch(`${BASE}/api/sign/${"x".repeat(30)}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ docId: "12345678Z" }),
  });
  check("un token inventado nunca abre nada", res.status === 403);

  res = await fetch(`${BASE}/api/documents/${documentId}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: admin.header() },
    body: JSON.stringify({ senderName: "David" }),
  });
  check("envia el expediente", res.ok, res.ok ? "" : (await res.json()).error);
  check("ahora si salen los dos correos", invitaciones().length === correosAntes + 2);

  res = await fetch(`${BASE}/api/documents/${documentId}`, {
    method: "PATCH",
    headers: { Cookie: admin.header() },
    body: formularioContrato({ titulo: "Intento de cambiazo", signers }),
  });
  check("un expediente enviado ya no se puede editar", res.status === 400);

  res = await fetch(`${BASE}/api/documents/${documentId}/placement`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: admin.header() },
    body: JSON.stringify({ placements: [{ signerId: signerIds[0], x: 0.1, y: 0.1 }] }),
  });
  check("tampoco se recolocan las firmas", res.status === 400);

  const tokenDavid = tokenDe("david.nuevo@example.com");
  const tokenLucia = tokenDe("lucia@example.com");
  check("cada firmante recibe un token distinto", Boolean(tokenDavid && tokenLucia) && tokenDavid !== tokenLucia);

  console.log("\n6. Puerta de identidad");
  res = await fetch(`${BASE}/api/sign/${tokenDavid}/pdf`);
  check("el PDF no sale sin verificar identidad", res.status === 401);

  res = await fetch(`${BASE}/api/sign/${tokenDavid}/auth`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ docId: "87654321X" }),
  });
  check("rechaza un DNI que no es el suyo", res.status === 401);

  res = await fetch(`${BASE}/api/sign/${tokenDavid}/auth`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ docId: "X1234567L" }),
  });
  check("el DNI del OTRO firmante tampoco abre este enlace", res.status === 401);

  const david = cookieJar();
  res = await fetch(`${BASE}/api/sign/${tokenDavid}/auth`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ docId: "12345678-Z" }),
  });
  david.absorb(res);
  check("acepta el DNI correcto con guiones", res.ok);

  res = await fetch(`${BASE}/api/sign/${tokenDavid}/pdf`, { headers: { Cookie: david.header() } });
  check("ya puede leer el PDF", res.ok && res.headers.get("content-type") === "application/pdf");

  res = await fetch(`${BASE}/api/sign/${tokenLucia}/pdf`, { headers: { Cookie: david.header() } });
  check("su cookie no abre el enlace de la otra parte", res.status === 401);

  console.log("\n7. Firma");
  const png = `data:image/png;base64,${makePng(160, 60).toString("base64")}`;

  res = await fetch(`${BASE}/api/sign/${tokenDavid}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: david.header() },
    body: JSON.stringify({ signature: png, consent: false }),
  });
  check("exige el consentimiento", res.status === 400);

  const lucia = cookieJar();
  res = await fetch(`${BASE}/api/sign/${tokenLucia}/auth`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ docId: "x1234567l" }),
  });
  lucia.absorb(res);
  check("el NIE en minusculas tambien vale", res.ok);

  // Las dos firmas salen a la vez: es la carrera que puede perder una firma.
  console.log("  ...enviando las dos firmas simultaneamente");
  const [r1, r2] = await Promise.all([
    fetch(`${BASE}/api/sign/${tokenDavid}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: david.header() },
      body: JSON.stringify({ signature: png, consent: true }),
    }),
    fetch(`${BASE}/api/sign/${tokenLucia}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: lucia.header() },
      body: JSON.stringify({ signature: png, consent: true }),
    }),
  ]);
  const [b1, b2] = [await r1.json(), await r2.json()];
  check("ambas firmas se aceptan", r1.ok && r2.ok, JSON.stringify([b1, b2]));
  check("solo una cierra el expediente", [b1.completed, b2.completed].filter(Boolean).length === 1);

  res = await fetch(`${BASE}/api/sign/${tokenDavid}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: david.header() },
    body: JSON.stringify({ signature: png, consent: true }),
  });
  check("no se puede firmar dos veces", res.status === 401 || res.status === 409);

  console.log("\n8. Documento final");
  res = await fetch(`${BASE}/api/documents/${documentId}/file`, {
    headers: { Cookie: admin.header() },
  });
  const finalBytes = Buffer.from(await res.arrayBuffer());
  const finalPdf = await PDFDocument.load(finalBytes);
  check("el final tiene las 3 paginas + hoja de firmas", finalPdf.getPageCount() === 4,
    `${finalPdf.getPageCount()} paginas`);
  check("se adjunta el PDF firmado a cada parte",
    correos().filter((f) => f.endsWith("-firmado.pdf")).length >= 2);

  res = await fetch(`${BASE}/api/documents/${documentId}/cancel`, {
    method: "POST", headers: { Cookie: admin.header() },
  });
  check("un documento ya firmado no se puede cancelar", res.status === 400);

  res = await fetch(`${BASE}/api/documents/${documentId}/file`);
  check("nadie sin sesion descarga el contrato", res.status === 401);

  console.log("\n9. Cancelacion de un expediente enviado");
  res = await fetch(`${BASE}/api/documents`, {
    method: "POST",
    headers: { Cookie: admin.header() },
    body: formularioContrato({
      titulo: "Contrato a cancelar",
      pdf: pdfBueno,
      signers: [{ ...signers[0], email: "cancelar@example.com" }],
    }),
  });
  const cancelable = (await res.json()).documentId;

  await fetch(`${BASE}/api/documents/${cancelable}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: admin.header() },
    body: JSON.stringify({ senderName: "David" }),
  });
  const tokenCancelable = tokenDe("cancelar@example.com");

  res = await fetch(`${BASE}/api/sign/${tokenCancelable}/auth`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ docId: "12345678Z" }),
  });
  check("antes de cancelar, el enlace funciona", res.ok);

  res = await fetch(`${BASE}/api/documents/${cancelable}/cancel`, {
    method: "POST", headers: { Cookie: admin.header() },
  });
  check("cancela el expediente", res.ok);

  res = await fetch(`${BASE}/api/sign/${tokenCancelable}/auth`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ docId: "12345678Z" }),
  });
  check("tras cancelar, el enlace deja de funcionar", res.status === 403);

  console.log("\n10. Descarte de borradores");
  res = await fetch(`${BASE}/api/documents`, {
    method: "POST",
    headers: { Cookie: admin.header() },
    body: formularioContrato({
      titulo: "Borrador a descartar",
      pdf: pdfBueno,
      signers: [{ ...signers[0], email: "descartar@example.com" }],
    }),
  });
  const descartable = (await res.json()).documentId;

  res = await fetch(`${BASE}/api/documents/${descartable}`, {
    method: "DELETE", headers: { Cookie: admin.header() },
  });
  check("descarta el borrador", res.ok);

  res = await fetch(`${BASE}/api/documents/${descartable}/file`, {
    headers: { Cookie: admin.header() },
  });
  check("el borrador descartado ya no existe", res.status === 404);

  res = await fetch(`${BASE}/api/documents/${documentId}`, {
    method: "DELETE", headers: { Cookie: admin.header() },
  });
  check("un expediente firmado no se puede borrar", res.status === 400);

  console.log(`\n${failures === 0 ? "TODO OK" : `${failures} COMPROBACIONES FALLIDAS`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
