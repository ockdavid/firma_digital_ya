import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

/**
 * pdf.js necesita su worker como fichero suelto servido por HTTP.
 * Lo copiamos a /public tras cada instalación para que siempre coincida con la
 * versión instalada de pdfjs-dist.
 *
 * Se copia el de "legacy" porque es el que carga el visor: la compilación
 * normal usa Map.prototype.getOrInsertComputed, que Safari aún no tiene.
 * Worker y visor deben salir de la misma compilación.
 */

const require = createRequire(import.meta.url);
const origen = path.join(
  path.dirname(require.resolve("pdfjs-dist/package.json")),
  "legacy",
  "build",
  "pdf.worker.min.mjs",
);
const destino = path.join(process.cwd(), "public", "pdf.worker.min.mjs");

fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.copyFileSync(origen, destino);
console.log(`worker de pdf.js copiado a public/${path.basename(destino)}`);
