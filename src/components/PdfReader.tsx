"use client";

import { useEffect, useRef, useState } from "react";

interface PdfPage {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: object) => { promise: Promise<void>; cancel: () => void };
}

interface PdfDoc {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
}

/**
 * Visor de solo lectura, pagina a pagina.
 *
 * No se usa un <iframe>: Safari en iPhone pinta ahi la primera pagina y no
 * deja pasar de ella, que es justo lo que no puede ocurrirle a quien tiene que
 * leer lo que firma. Dibujando con pdf.js se ve igual en cualquier navegador.
 * Una pagina cada vez, y no todas a la vez, porque un contrato largo en un
 * movil se queda sin memoria.
 */
export default function PdfReader({ fileUrl }: { fileUrl: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PdfDoc | null>(null);

  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [pintada, setPintada] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;

    (async () => {
      try {
        // Compilacion legacy: la normal usa Map.prototype.getOrInsertComputed,
        // que Safari todavia no trae. Ver scripts/copiar-worker.mjs.
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const doc = (await pdfjs.getDocument({ url: fileUrl }).promise) as unknown as PdfDoc;
        if (!vivo) return;
        docRef.current = doc;
        setPages(doc.numPages);
      } catch {
        if (vivo) setError("No se pudo abrir el documento.");
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

      const cancelado = (e: unknown) =>
        (e as { name?: string })?.name === "RenderingCancelledException";

      try {
        await pintar(Math.min(window.devicePixelRatio || 1, 2));
      } catch (e) {
        if (cancelado(e) || !vivo) return;
        try {
          await pintar(1);
        } catch (e2) {
          if (cancelado(e2) || !vivo) return;
          const detalle = e2 instanceof Error ? `${e2.name}: ${e2.message}` : String(e2);
          setError(`No se pudo dibujar esta pagina. (${detalle})`);
        }
      }
    })();

    return () => {
      vivo = false;
      tarea?.cancel();
    };
  }, [pages, page]);

  if (error) {
    return <div className="px-5 py-10 text-center text-sm text-red-600">{error}</div>;
  }

  return (
    <div>
      <div ref={wrapperRef} className="relative bg-zinc-100">
        <canvas ref={canvasRef} className="block w-full" />
        {pintada !== page && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">
            Cargando página…
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-zinc-200 px-5 py-3">
        <button
          type="button"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
          className="btn-small"
        >
          Anterior
        </button>
        <span className="text-xs text-zinc-500">
          Página {page} de {pages || "…"}
        </span>
        <button
          type="button"
          onClick={() => setPage((p) => Math.min(pages, p + 1))}
          disabled={pages === 0 || page >= pages}
          className="btn-small"
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}
