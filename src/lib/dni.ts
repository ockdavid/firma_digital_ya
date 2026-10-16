/**
 * Validación de documentos de identidad españoles.
 * El documento actúa como segundo factor: el enlace por sí solo no abre el contrato.
 */

const CHECK_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
const NIE_PREFIX: Record<string, string> = { X: "0", Y: "1", Z: "2" };

export type DocIdType = "dni" | "nie" | "pasaporte";

/** Mayúsculas y sin espacios, guiones ni puntos. Es la forma canónica que se hashea. */
export function normalizeDocId(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

function checkLetter(digits: string): string {
  return CHECK_LETTERS[Number(digits) % 23];
}

export function validateDocId(
  raw: string,
  type: DocIdType,
): { ok: true; value: string } | { ok: false; error: string } {
  const value = normalizeDocId(raw);
  if (!value) return { ok: false, error: "Introduce tu documento de identidad." };

  if (type === "dni") {
    if (!/^\d{8}[A-Z]$/.test(value)) {
      return { ok: false, error: "El DNI debe tener 8 números y una letra." };
    }
    if (value[8] !== checkLetter(value.slice(0, 8))) {
      return { ok: false, error: "La letra del DNI no es correcta." };
    }
    return { ok: true, value };
  }

  if (type === "nie") {
    if (!/^[XYZ]\d{7}[A-Z]$/.test(value)) {
      return { ok: false, error: "El NIE debe empezar por X, Y o Z, seguido de 7 números y una letra." };
    }
    const digits = NIE_PREFIX[value[0]] + value.slice(1, 8);
    if (value[8] !== checkLetter(digits)) {
      return { ok: false, error: "La letra del NIE no es correcta." };
    }
    return { ok: true, value };
  }

  // Pasaporte u otro documento extranjero: no hay dígito de control que comprobar.
  if (value.length < 6) {
    return { ok: false, error: "El número de pasaporte es demasiado corto." };
  }
  return { ok: true, value };
}

/** Solo para que tú reconozcas al firmante en el panel. Nunca se muestra al firmante. */
export function maskDocId(value: string): string {
  const tail = value.slice(-4);
  return "•".repeat(Math.max(0, value.length - 4)) + tail;
}

export const DOC_ID_LABEL: Record<DocIdType, string> = {
  dni: "DNI",
  nie: "NIE",
  pasaporte: "Pasaporte",
};
