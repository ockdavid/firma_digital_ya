import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";

/**
 * Todos los ficheros viven fuera de /public: solo se sirven a través de rutas
 * que comprueban antes quién pregunta. Nunca hay una URL pública a un contrato.
 */

function resolve(relativePath: string): string {
  const full = path.resolve(config.storageDir, relativePath);
  if (!full.startsWith(path.resolve(config.storageDir) + path.sep)) {
    throw new Error("Ruta de almacenamiento fuera de rango");
  }
  return full;
}

export async function saveFile(relativePath: string, data: Uint8Array): Promise<string> {
  const full = resolve(relativePath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data);
  return relativePath;
}

export async function readFile(relativePath: string): Promise<Buffer> {
  return fs.readFile(resolve(relativePath));
}

export async function deleteFile(relativePath: string): Promise<void> {
  await fs.rm(resolve(relativePath), { force: true });
}

export const paths = {
  original: (docId: string) => `${docId}/original.pdf`,
  /**
   * El nonce hace única cada tentativa de versión. Sin él, dos firmantes
   * simultáneos escribirían ambos en `v1.pdf` y el que perdiera la carrera
   * borraría, al limpiar, el fichero que el ganador acababa de publicar.
   */
  version: (docId: string, version: number, nonce: string) =>
    `${docId}/v${version}-${nonce}.pdf`,
  signature: (docId: string, signerId: string) => `${docId}/firma-${signerId}.png`,
};
