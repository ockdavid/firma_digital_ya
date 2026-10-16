/**
 * Caja de firma: el hueco donde va la rubrica dentro de una pagina.
 *
 * Todo va normalizado 0..1 sobre la pagina "visual" (la enderezada, la que ve
 * el firmante), asi que sirve para cualquier zoom y cualquier tamano de hoja.
 * `x` e `y` son el CENTRO de la caja, no la esquina: asi las posiciones
 * antiguas, elegidas con un solo clic, siguen cayendo donde caian.
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Tamano por defecto cuando se coloca con un clic, sin llegar a dibujar. */
export const CAJA_ANCHO = 0.22;
export const CAJA_ALTO = 0.07;

/** Por debajo de esto, un arrastre cuenta como clic y no como caja dibujada. */
export const CAJA_MINIMA = 0.02;

function limitar(valor: number, min: number, max: number): number {
  return Math.min(Math.max(valor, min), Math.max(min, max));
}

/** Recorta la caja para que quepa entera dentro de la pagina. */
export function encajar(box: Box): Box {
  const w = limitar(box.w, CAJA_MINIMA, 1);
  const h = limitar(box.h, CAJA_MINIMA, 1);
  return {
    w,
    h,
    x: limitar(box.x, w / 2, 1 - w / 2),
    y: limitar(box.y, h / 2, 1 - h / 2),
  };
}

/** Caja a partir de dos esquinas opuestas: al dibujar y al redimensionar. */
export function desdeEsquinas(
  a: { x: number; y: number },
  b: { x: number; y: number },
): Box {
  return encajar({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  });
}

/** Reconstruye la caja de la base de datos. Las filas viejas no tienen tamano. */
export function cajaGuardada(
  x: number | null,
  y: number | null,
  w: number | null,
  h: number | null,
): Box | null {
  if (x === null || y === null) return null;
  return { x, y, w: w ?? CAJA_ANCHO, h: h ?? CAJA_ALTO };
}

export function mismaCaja(a: Box | undefined, b: Box | undefined): boolean {
  if (!a || !b) return a === b;
  const cerca = (p: number, q: number) => Math.abs(p - q) < 0.0005;
  return cerca(a.x, b.x) && cerca(a.y, b.y) && cerca(a.w, b.w) && cerca(a.h, b.h);
}
