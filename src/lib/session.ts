import { cookies } from "next/headers";
import { config } from "./config";
import { readSignedValue, signValue, verifySecret, hashSecret } from "./crypto";

const ADMIN_COOKIE = "firmaya_admin";
const ADMIN_TTL_MS = 12 * 60 * 60 * 1000;
const SIGNER_TTL_MS = 60 * 60 * 1000;

/* La contraseña de administración se hashea una vez al arrancar, así la
   comparación es en tiempo constante y no dependemos de === sobre un string. */
const adminHash = hashSecret(config.adminPassword);

export function checkAdminPassword(input: string): boolean {
  return verifySecret(input, adminHash);
}

const baseCookie = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export async function startAdminSession(): Promise<void> {
  const store = await cookies();
  store.set(ADMIN_COOKIE, signValue(`admin:${Date.now() + ADMIN_TTL_MS}`), {
    ...baseCookie,
    maxAge: ADMIN_TTL_MS / 1000,
  });
}

export async function endAdminSession(): Promise<void> {
  (await cookies()).delete(ADMIN_COOKIE);
}

export async function isAdmin(): Promise<boolean> {
  const raw = (await cookies()).get(ADMIN_COOKIE)?.value;
  const value = readSignedValue(raw);
  if (!value) return false;
  const [, expiresAt] = value.split(":");
  return Number(expiresAt) > Date.now();
}

/* ---- Sesión del firmante ----
   Se abre solo tras acertar el documento de identidad y va atada a ese firmante
   concreto: la cookie de un contrato no sirve para abrir otro. */

function signerCookieName(signerId: string): string {
  return `firmaya_sign_${signerId}`;
}

export async function startSignerSession(signerId: string): Promise<void> {
  const store = await cookies();
  store.set(signerCookieName(signerId), signValue(`${signerId}:${Date.now() + SIGNER_TTL_MS}`), {
    ...baseCookie,
    maxAge: SIGNER_TTL_MS / 1000,
  });
}

export async function hasSignerSession(signerId: string): Promise<boolean> {
  const raw = (await cookies()).get(signerCookieName(signerId))?.value;
  const value = readSignedValue(raw);
  if (!value) return false;
  const [id, expiresAt] = value.split(":");
  return id === signerId && Number(expiresAt) > Date.now();
}

export async function endSignerSession(signerId: string): Promise<void> {
  (await cookies()).delete(signerCookieName(signerId));
}
