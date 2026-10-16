import type { DocumentKind } from "./db";

export const KIND_LABEL: Record<DocumentKind, string> = {
  alquiler_habitacion: "Alquiler de habitación",
  gestion_habitaciones: "Gestión de habitaciones",
  otro: "Otro",
};

/** Roles habituales en tus dos tipos de contrato, para no teclearlos cada vez. */
export const ROLE_SUGGESTIONS: Record<DocumentKind, string[]> = {
  alquiler_habitacion: ["Arrendador", "Arrendatario", "Avalista"],
  gestion_habitaciones: ["Gestor", "Propietario", "Inversor"],
  otro: ["Parte A", "Parte B"],
};
