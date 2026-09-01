"use client";

import { useEffect, useRef, useState } from "react";

export interface Marker {
  signerId: string;
  label: string;
  color: string;
}

export interface Position {
  x: number;
  y: number;
}

interface Props {
  fileUrl: string;
  markers: Marker[];
  positions: Record<string, Position | undefined>;
  activeSignerId: string;
  onPlace: (signerId: string, position: Position) => void;
}

interface PdfPage {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: object) => { promise: Promise<void>; cancel: () => void };
}

interface PdfDoc {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
}

/**
 * Muestra el PDF y deja marcar dónde firma cada parte.
 *
 * Las coordenadas se guardan normalizadas (0..1 desde arriba a la izquierda),
 * no en píxeles: así valen para cualquier zoom y para páginas de tamaños
 * distintos. pdf.js ya devuelve la página enderezada, de modo que lo que ves
 * aquí es lo mismo que verá el firmante.
 */
export default function PdfPagePicker({
  fileUrl,
  markers,
  positions,
  activeSignerId,
  onPlace,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PdfDoc | null>(null);

  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  // Última página realmente pintada: de aquí sale el indicador de carga, sin
  // tener que tocar estado nada más entrar en el efecto.
  const [pintada, setPintada] = useState(0);
  const [redibujar, setRedibujar] = useState(0);
  const cargando = pages === 0 || pintada !== page;

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

      try {
        const pdfPage = await doc.getPage(page);
        if (!vivo) return;

        const base = pdfPage.getViewport({ scale: 1 });
        const ancho = wrapper.clientWidth || 640;
        const ratio = window.devicePixelRatio || 1;
        const viewport = pdfPage.getViewport({ scale: (ancho / base.width) * ratio });

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = "100%";
        canvas.style.height = "auto";

        tarea = pdfPage.render({ canvas, viewport });
        await tarea.promise;
        if (vivo) setPintada(page);
      } catch (e) {
        // Cancelar un render en curso lanza: no es un error que mostrar.
        const cancelado = (e as { name?: string })?.name === "RenderingCancelledException";
        if (vivo && !cancelado) setError("No se pudo dibujar esta página.");
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

  function place(event: React.MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    onPlace(activeSignerId, {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    });
  }

  if (error) {
    return <div className="card px-5 py-10 text-center text-sm text-red-600">{error}</div>;
  }

  return (
    <div>
      <div ref={wrapperRef} className="card overflow-hidden">
        <div className="relative cursor-crosshair select-none" onClick={place}>
          <canvas ref={canvasRef} className="block w-full" />

          {markers.map((marker) => {
            const position = positions[marker.signerId];
            if (!position) return null;
            const activo = marker.signerId === activeSignerId;
            return (
              <div
                key={marker.signerId}
                className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md border-2 text-[10px] font-semibold whitespace-nowrap"
                style={{
                  left: `${position.x * 100}%`,
                  top: `${position.y * 100}%`,
                  width: "22%",
                  height: "7%",
                  borderColor: marker.color,
                  backgroundColor: `${marker.color}1f`,
                  color: marker.color,
                  opacity: activo ? 1 : 0.65,
                }}
              >
                {marker.label}
              </div>
            );
          })}

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
            onClick={() => setPage((p) => Math.max(1, p - 1))}
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
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
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
