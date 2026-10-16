import crypto from "node:crypto";
import { config } from "./config";

/* ─────────── Tokens de enlace ───────────
   El token en claro solo existe en el email del firmante.
   En base de datos guardamos un HMAC: si alguien lee la BD, no puede
   reconstruir ningún enlace, pero nosotros seguimos pudiendo buscar por token. */

export function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function tokenHash(token: string): string {
  return crypto.createHmac("sha256", config.appSecret).update(token).digest("hex");
}

/* ─────────── Secretos verificables (DNI/NIE, contraseña) ───────────
   scrypt con sal por registro. Irreversible: ni tú puedes leer el DNI
   de un firmante desde la base de datos. */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 } as const;

export function hashSecret(value: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(value, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifySecret(value: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(value, Buffer.from(saltHex, "hex"), expected.length, SCRYPT);
  return crypto.timingSafeEqual(expected, actual);
}

/* ─────────── Integridad del documento ─────────── */

export function sha256(data: Buffer | Uint8Array): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/* ─────────── Cookies firmadas ─────────── */

export function signValue(value: string): string {
  const mac = crypto.createHmac("sha256", config.appSecret).update(value).digest("base64url");
  return `${Buffer.from(value).toString("base64url")}.${mac}`;
}

export function readSignedValue(signed: string | undefined): string | null {
  if (!signed) return null;
  const [payload, mac] = signed.split(".");
  if (!payload || !mac) return null;
  let value: string;
  try {
    value = Buffer.from(payload, "base64url").toString();
  } catch {
    return null;
  }
  const expected = crypto.createHmac("sha256", config.appSecret).update(value).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return value;
}

export function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(9).toString("base64url")}`;
}
