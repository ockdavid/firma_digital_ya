import path from "node:path";

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(
    `Falta la variable de entorno ${name}. Copia .env.example a .env.local y rellénala.`,
  );
}

export const config = {
  /** URL pública desde la que los firmantes abren su enlace. */
  appUrl: env("APP_URL", "http://localhost:3000").replace(/\/+$/, ""),
  /** Clave maestra: firma cookies y deriva el HMAC de los tokens. */
  appSecret: env("APP_SECRET"),
  /** Contraseña del panel de administración (solo tú). */
  adminPassword: env("ADMIN_PASSWORD"),
  /** Clave que usa el bot de Telegram para depositar contratos. Vacía = puerta cerrada. */
  botApiKey: process.env.BOT_API_KEY ?? "",
  /** Clave corta para abrir un borrador concreto desde el enlace del bot.
      Vacía = la pantalla /acceso no existe. Pensada para demos, no para el día a día. */
  accessCode: process.env.ACCESS_CODE ?? "",

  emailDriver: env("EMAIL_DRIVER", "console") as "console" | "resend",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  mailFrom: env("MAIL_FROM", "Firmaya <onboarding@resend.dev>"),

  dbPath: path.join(env("DATA_DIR", path.join(process.cwd(), "data")), "firmaya.db"),
  storageDir: env("STORAGE_DIR", path.join(process.cwd(), "storage")),

  tokenTtlDays: Number(env("TOKEN_TTL_DAYS", "30")),
  maxAuthAttempts: Number(env("MAX_AUTH_ATTEMPTS", "5")),
  lockMinutes: Number(env("LOCK_MINUTES", "15")),
  maxPdfMb: Number(env("MAX_PDF_MB", "25")),
} as const;
