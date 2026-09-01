import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

/**
 * pdf.js necesita su worker como fichero suelto servido por HTTP.
 * Lo copiamos a /public tras cada instalación para que siempre coincida con la
 * versión instalada de pdfjs-dist.
 */

const require = createRequire(import.meta.url);
const origen = path.join(
  path.dirname(require.resolve("pdfjs-dist/package.json")),
  "build",
  "pdf.worker.min.mjs",
);
const destino = path.join(process.cwd(), "public", "pdf.worker.min.mjs");

fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.copyFileSync(origen, destino);
console.log(`worker de pdf.js copiado a public/${path.basename(destino)}`);
