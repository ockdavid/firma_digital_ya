/**
 * Comprueba la puerta del bot y la clave corta de acceso.
 * Arranca su propio servidor con DATA_DIR/STORAGE_DIR aparte: no toca datos reales.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

const PORT = 3130;
const BASE = `http://127.0.0.1:${PORT}`;
const CLAVE_BOT = "clave-de-prueba-del-bot-1234567890";
const CLAVE_ACCESO = "12345678Z";
const raiz = mkdtempSync(path.join(tmpdir(), "firmaya-bot-"));

let fallos = 0;
function comprobar(nombre, ok, extra = "") {
  console.log(`${ok ? "OK  " : "FALLA"} ${nombre}${extra ? ` — ${extra}` : ""}`);
  if (!ok) fallos++;
}

async function pdfDePrueba(paginas = 2) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < paginas; i++) {
    pdf.addPage([595.28, 841.89]).drawText(`Contrato - pagina ${i + 1}`, {
      x: 60, y: 760, size: 13, font,
    });
  }
  return Buffer.from(await pdf.save());
}

function formulario(pdf, firmantes) {
  const form = new FormData();
  form.set("title", "Alquiler H3 - Prueba del bot");
  form.set("kind", "alquiler_habitacion");
  form.set("signers", JSON.stringify(firmantes));
  form.set("pdf", new Blob([pdf], { type: "application/pdf" }), "contrato.pdf");
  return form;
}

const servidor = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    DATA_DIR: path.join(raiz, "data"),
    STORAGE_DIR: path.join(raiz, "storage"),
    APP_URL: BASE,
    APP_SECRET: "secreto-de-prueba-que-no-se-usa-fuera-de-aqui",
    ADMIN_PASSWORD: "admin-de-prueba",
    BOT_API_KEY: CLAVE_BOT,
    ACCESS_CODE: CLAVE_ACCESO,
    EMAIL_DRIVER: "console",
  },
  stdio: "ignore",
});

async function esperar() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/login`);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

try {
  if (!(await esperar())) throw new Error("el servidor de prueba no arrancó");

  const pdf = await pdfDePrueba();
  const firmantes = [
    { name: "Ana Propietaria", email: "ana@ejemplo.com", role: "Arrendador",
      docIdType: "dni", docId: "12345678Z" },
    { name: "Luis Inquilino", email: "luis@ejemplo.com", role: "Arrendatario",
      docIdType: "dni", docId: "00000000T" },
  ];

  // 1. Sin clave -> rechazado
  let res = await fetch(`${BASE}/api/documents`, { method: "POST", body: formulario(pdf, firmantes) });
  comprobar("sin clave se rechaza", res.status === 401, `status ${res.status}`);

  // 2. Clave equivocada -> rechazado
  res = await fetch(`${BASE}/api/documents`, {
    method: "POST",
    headers: { Authorization: "Bearer clave-que-no-es" },
    body: formulario(pdf, firmantes),
  });
  comprobar("clave equivocada se rechaza", res.status === 401, `status ${res.status}`);

  // 3. Clave buena -> crea el borrador
  res = await fetch(`${BASE}/api/documents`, {
    method: "POST",
    headers: { Authorization: `Bearer ${CLAVE_BOT}` },
    body: formulario(pdf, firmantes),
  });
  const creado = await res.json();
  comprobar("el bot crea el borrador", res.ok && Boolean(creado.documentId), JSON.stringify(creado));
  const docId = creado.documentId;

  // 4. La pantalla de acceso existe para ese borrador
  res = await fetch(`${BASE}/acceso/${docId}`);
  const html = await res.text();
  comprobar("la pantalla de acceso carga", res.ok && html.includes("Clave de acceso"), `status ${res.status}`);

  // 5. Clave de acceso equivocada -> rechazada
  res = await fetch(`${BASE}/api/auth/acceso`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "99999999X" }),
  });
  comprobar("clave de acceso equivocada se rechaza", res.status === 401, `status ${res.status}`);

  // 6. Clave buena -> abre sesión
  res = await fetch(`${BASE}/api/auth/acceso`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: CLAVE_ACCESO }),
  });
  const cookies = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  comprobar("la clave de acceso abre sesión", res.ok && cookies.includes("firmaya_admin"), `status ${res.status}`);

  // 7. Con esa sesión se llega a la pantalla de preparación
  res = await fetch(`${BASE}/documento/${docId}/preparar`, { headers: { cookie: cookies } });
  const prep = await res.text();
  comprobar("se entra a preparar el contrato", res.ok && prep.includes("Ana Propietaria") && prep.includes("Luis Inquilino"),
    `status ${res.status}`);

  // 8. Un documento inexistente da 404
  res = await fetch(`${BASE}/acceso/doc_inventado`);
  comprobar("un borrador inexistente da 404", res.status === 404, `status ${res.status}`);
} catch (err) {
  console.log("FALLA excepción —", err.message);
  fallos++;
} finally {
  servidor.kill();
  await new Promise((r) => setTimeout(r, 800));
  rmSync(raiz, { recursive: true, force: true });
}

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} comprobacion(es) fallan`);
process.exit(fallos === 0 ? 0 : 1);
