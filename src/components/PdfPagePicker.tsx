"use client";

import { useEffect, useRef, useState } from "react";
import { CAJA_ALTO, CAJA_ANCHO, CAJA_MINIMA, desdeEsquinas, encajar, type Box } from "@/lib/box";

export interface Marker {
  signerId: string;
  label: string;
  color: string;
}

interface Props {
  fileUrl: string;
  markers: Marker[];
  /** Caja general de cada firmante: la que vale para todas las páginas. */
  boxes: Record<string, Box | undefined>;
  /** Excepciones: firmante → número de página → caja. */
  pageBoxes: Record<string, Record<number, Box> | undefined>;
  activeSignerId: string;
  page: number;
  onPageChange: (page: number) => void;
  onPlace: (signerId: string, page: number, box: Box) => void;
}

interface PdfPage {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: object) => { promise: Promise<void>; cancel: () => void };
}

interface PdfDoc {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
}

type Modo = "crear" | "mover" | "tamano";

interface Arrastre {
  modo: Modo;
  signerId: string;
  /** Esquina que se queda quieta al crear o al redimensionar. */
  ancla: { x: number; y: number };
  /** Distancia del puntero al centro de la caja, al empezar a moverla. */
  desvio: { x: number; y: number };
  tamano: { w: number; h: number };
}

/** Lado del tirador de tamaño, en píxeles de pantalla. */
const TIRADOR = 14;

/**
 * Muestra el PDF y deja dibujar dónde firma cada parte.
 *
 * Las cajas se guardan normalizadas (0..1 desde arriba a la izquierda, con el
 * centro como referencia), no en píxeles: así valen para cualquier zoom y para
 * páginas de tamaños distintos. pdf.js ya devuelve la página enderezada, de
 * modo que lo que ves aquí es lo mismo que verá el firmante.
 */
export default function PdfPagePicker({
  fileUrl,
  markers,
  boxes,
  pageBoxes,
  activeSignerId,
  page,
  onPageChange,
  onPlace,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PdfDoc | null>(null);
  const arrastreRef = useRef<Arrastre | null>(null);

  const [pages, setPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Última página realmente pintada: de aquí sale el indicador de carga, sin
  // tener que tocar estado nada más entrar en el efecto.
  const [pintada, setPintada] = useState(0);
  const [redibujar, setRedibujar] = useState(0);
  // Caja que se está dibujando o moviendo ahora mismo, para verla en vivo.
  const [previa, setPrevia] = useState<Box | null>(null);
  const [cursor, setCursor] = useState("crosshair");
  const cargando = pages === 0 || pintada !== page;

  const cajaDe = (signerId: string): Box | undefined =>
    pageBoxes[signerId]?.[page] ?? boxes[signerId];
  const esPropia = (signerId: string): boolean => Boolean(pageBoxes[signerId]?.[page]);
  const cajaActiva = previa ?? cajaDe(activeSignerId);

  useEffect(() => {
    let vivo = true;

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const doc = (await pdfjs.getDocument({ url: fileUrl }).promise) as unknown as PdfDoc;
        if (!vivo) return;
        docRef.current = doc;
        setPages(doc.numPages);
      } catch {
        if (vivo) setError("No se pudo abrir el PDF para colocarlo.");
      }
    })();

    return () => {
      vivo = false;
      docRef.current = null;
    };
  }, [fileUrl]);

  useEffect(() => {
    if (pages === 0) return;

    let vivo = true;
    let tarea: { promise: Promise<void>; cancel: () => void } | null = null;

    (async () => {
      const doc = docRef.current;
      const canvas = canvasRef.current;
      const wrapper = wrapperRef.current;
      if (!doc || !canvas || !wrapper) return;

      const pintar = async (ratio: number) => {
        const pdfPage = await doc.getPage(page);
        if (!vivo) return;

        const base = pdfPage.getViewport({ scale: 1 });
        const ancho = wrapper.clientWidth || 640;
        const viewport = pdfPage.getViewport({ scale: (ancho / base.width) * ratio });

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = "100%";
        canvas.style.height = "auto";

        tarea = pdfPage.render({ canvas, viewport });
        await tarea.promise;
        if (vivo) setPintada(page);
      };

      // Cancelar un render en curso lanza: no es un error que mostrar.
      const cancelado = (e: unknown) =>
        (e as { name?: string })?.name === "RenderingCancelledException";

      try {
        // Safari en movil se queda sin memoria con los lienzos grandes, asi que
        // el nitido se limita a 2x y, si aun asi falla, se reintenta a 1x.
        await pintar(Math.min(window.devicePixelRatio || 1, 2));
      } catch (e) {
        if (cancelado(e) || !vivo) return;
        try {
          await pintar(1);
        } catch (e2) {
          if (cancelado(e2) || !vivo) return;
          // El detalle importa: sin el, un fallo en el movil no hay quien lo
          // diagnostique, porque alli no se puede abrir la consola.
          const detalle = e2 instanceof Error ? `${e2.name}: ${e2.message}` : String(e2);
          setError(`No se pudo dibujar esta pagina. (${detalle})`);
        }
      }
    })();

    // Solo se cancela cuando este render queda superado por otro. Cancelar al
    // entrar dejaba la página a medio pintar si llegaban dos avisos seguidos.
    return () => {
      vivo = false;
      tarea?.cancel();
    };
  }, [pages, page, redibujar]);

  // Al cambiar el ancho hay que rehacer el lienzo. Con espera: al arrastrar,
  // el navegador dispara decenas de eventos y cada uno abortaría el anterior.
  useEffect(() => {
    let temporizador: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(temporizador);
      temporizador = setTimeout(() => setRedibujar((n) => n + 1), 200);
    };
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(temporizador);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  /* --- Dibujar, mover y redimensionar --- */

  function punto(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      rect,
      p: {
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height,
      },
    };
  }

  /** Qué hay bajo el puntero: el tirador de tamaño, la caja, o la página. */
  function zona(p: { x: number; y: number }, rect: DOMRect): Modo {
    const caja = cajaDe(activeSignerId);
    if (!caja) return "crear";
    const derecha = (caja.x + caja.w / 2) * rect.width;
    const abajo = (caja.y + caja.h / 2) * rect.height;
    if (Math.abs(p.x * rect.width - derecha) <= TIRADOR && Math.abs(p.y * rect.height - abajo) <= TIRADOR) {
      return "tamano";
    }
    const dentro = Math.abs(p.x - caja.x) <= caja.w / 2 && Math.abs(p.y - caja.y) <= caja.h / 2;
    return dentro ? "mover" : "crear";
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !activeSignerId) return;
    const sitio = punto(event);
    if (!sitio) return;

    const modo = zona(sitio.p, sitio.rect);
    const caja = cajaDe(activeSignerId);

    arrastreRef.current = {
      modo,
      signerId: activeSignerId,
      // Al redimensionar se queda quieta la esquina de arriba a la izquierda.
      ancla:
        modo === "tamano" && caja
          ? { x: caja.x - caja.w / 2, y: caja.y - caja.h / 2 }
          : sitio.p,
      desvio: caja ? { x: sitio.p.x - caja.x, y: sitio.p.y - caja.y } : { x: 0, y: 0 },
      tamano: caja ? { w: caja.w, h: caja.h } : { w: CAJA_ANCHO, h: CAJA_ALTO },
    };

    event.currentTarget.setPointerCapture(event.pointerId);
    setCursor(modo === "mover" ? "grabbing" : modo === "tamano" ? "nwse-resize" : "crosshair");
    if (modo === "crear") setPrevia({ ...sitio.p, w: 0, h: 0 });
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const sitio = punto(event);
    if (!sitio) return;
    const arrastre = arrastreRef.current;

    // Sin arrastre solo cambia el cursor: cruz para dibujar, mano para mover.
    if (!arrastre) {
      const modo = zona(sitio.p, sitio.rect);
      setCursor(modo === "mover" ? "grab" : modo === "tamano" ? "nwse-resize" : "crosshair");
      return;
    }

    if (arrastre.modo === "mover") {
      setPrevia(
        encajar({
          x: sitio.p.x - arrastre.desvio.x,
          y: sitio.p.y - arrastre.desvio.y,
          w: arrastre.tamano.w,
          h: arrastre.tamano.h,
        }),
      );
      return;
    }
    setPrevia(desdeEsquinas(arrastre.ancla, sitio.p));
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const arrastre = arrastreRef.current;
    arrastreRef.current = null;
    if (!arrastre) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const sitio = punto(event);
    const dibujada = previa;
    setPrevia(null);
    setCursor("crosshair");
    if (!sitio || !dibujada) return;

    // Un arrastre demasiado corto se entiende como un clic: caja por defecto.
    const minuscula = dibujada.w <= CAJA_MINIMA || dibujada.h <= CAJA_MINIMA;
    const caja =
      arrastre.modo === "crear" && minuscula
        ? encajar({ ...sitio.p, w: CAJA_ANCHO, h: CAJA_ALTO })
        : dibujada;

    onPlace(arrastre.signerId, page, caja);
  }

  function onPointerCancel() {
    arrastreRef.current = null;
    setPrevia(null);
    setCursor("crosshair");
  }

  if (error) {
    return <div className="card px-5 py-10 text-center text-sm text-red-600">{error}</div>;
  }

  return (
    <div>
      <div ref={wrapperRef} className="card overflow-hidden">
        <div
          className="relative select-none"
          /* pan-y: en el movil el dedo desplaza la pagina como en cualquier
             sitio. Un toque suelto sigue colocando la caja, y para arrastrarla
             esta el agarre de abajo, que si captura el gesto. */
          style={{ cursor, touchAction: "pan-y" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          <canvas ref={canvasRef} className="block w-full" />

          {markers.map((marker) => {
            const activo = marker.signerId === activeSignerId;
            const caja = activo ? cajaActiva : cajaDe(marker.signerId);
            if (!caja) return null;
            return (
              <div
                key={marker.signerId}
                className={`pointer-events-none absolute flex items-center justify-center overflow-hidden rounded-md border-2 text-[10px] font-semibold whitespace-nowrap ${
                  esPropia(marker.signerId) ? "border-dashed" : ""
                }`}
                style={{
                  left: `${(caja.x - caja.w / 2) * 100}%`,
                  top: `${(caja.y - caja.h / 2) * 100}%`,
                  width: `${caja.w * 100}%`,
                  height: `${caja.h * 100}%`,
                  borderColor: marker.color,
                  backgroundColor: `${marker.color}1f`,
                  color: marker.color,
                  opacity: activo ? 1 : 0.6,
                }}
              >
                {marker.label}
              </div>
            );
          })}

          {/* Encima de la caja activa, el dedo arrastra en vez de desplazar.
              Se estira un poco por abajo y por la derecha para que el tirador
              de tamaño entre dentro. */}
          {cajaActiva && (
            <div
              className="absolute"
              style={{
                left: `${(cajaActiva.x - cajaActiva.w / 2) * 100}%`,
                top: `${(cajaActiva.y - cajaActiva.h / 2) * 100}%`,
                width: `calc(${cajaActiva.w * 100}% + ${TIRADOR}px)`,
                height: `calc(${cajaActiva.h * 100}% + ${TIRADOR}px)`,
                touchAction: "none",
              }}
            />
          )}

          {/* Tirador para cambiar el tamaño de la caja del firmante activo. */}
          {cajaActiva && !previa && (
            <div
              className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-white bg-zinc-900 shadow"
              style={{
                left: `${(cajaActiva.x + cajaActiva.w / 2) * 100}%`,
                top: `${(cajaActiva.y + cajaActiva.h / 2) * 100}%`,
              }}
            />
          )}

          {cargando && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm text-zinc-500">
              Cargando página…
            </div>
          )}
        </div>
      </div>

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page === 1}
            className="btn-secondary px-3 py-1.5"
          >
            Anterior
          </button>
          <span className="text-xs text-zinc-500">
            Página {page} de {pages}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(Math.min(pages, page + 1))}
            disabled={page === pages}
            className="btn-secondary px-3 py-1.5"
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}
