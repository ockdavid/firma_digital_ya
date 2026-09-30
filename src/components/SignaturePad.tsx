"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  onChange: (dataUrl: string | null) => void;
}

/**
 * Lienzo de firma con eventos de puntero: el mismo código sirve para ratón,
 * dedo y stylus. Devuelve un PNG transparente ya recortado al trazo, para que
 * la rúbrica no lleve márgenes vacíos al estamparse en el PDF.
 */
export default function SignaturePad({ onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  /** Ancho con el que se preparó el lienzo, para no rehacerlo sin motivo. */
  const anchoPreparado = useRef(0);
  const [hasInk, setHasInk] = useState(false);
  /* Una vez firmado se puede echar el pestillo: el lienzo deja de escuchar al
     dedo, asi que ni se estropea la rubrica de un roce ni estorba al
     desplazarse por la pagina. */
  const [bloqueada, setBloqueada] = useState(false);

  const setup = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    anchoPreparado.current = Math.round(rect.width);
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0b0b12";
  }, []);

  useEffect(() => {
    setup();

    /* Solo se rehace el lienzo si cambia su ANCHO, que es lo unico que
       deforma el trazo. Antes bastaba cualquier "resize" de la ventana, y en
       un movil eso ocurre al desplazarse: la barra de direcciones se encoge,
       salta el evento y la firma recien dibujada se borraba sola. */
    const canvas = canvasRef.current;
    if (!canvas) return;

    const observador = new ResizeObserver(() => {
      const ancho = Math.round(canvas.getBoundingClientRect().width);
      if (ancho === 0 || ancho === anchoPreparado.current) return;
      setup();
      setHasInk(false);
      setBloqueada(false);
      onChange(null);
    });
    observador.observe(canvas);
    return () => observador.disconnect();
  }, [setup, onChange]);

  function pointFrom(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    if (bloqueada) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    last.current = pointFrom(event);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    const from = last.current;
    if (!ctx || !from) return;
    const to = pointFrom(event);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    last.current = to;
    if (!hasInk) setHasInk(true);
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    onChange(exportTrimmed(canvasRef.current));
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    setBloqueada(false);
    onChange(null);
  }

  return (
    <div>
      <div className="relative rounded-xl border-2 border-dashed border-zinc-300 bg-white">
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          onPointerCancel={end}
          className={`block h-44 w-full rounded-xl ${bloqueada ? "" : "touch-none"}`}
        />
        {!hasInk && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-zinc-400">
            Dibuja tu firma aquí
          </p>
        )}
        <div className="pointer-events-none absolute inset-x-8 bottom-8 border-b border-zinc-200" />
        {bloqueada && (
          <span className="pill absolute top-2 right-2 bg-emerald-50 text-emerald-700">
            Bloqueada
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {(hasInk || bloqueada) && (
          <button
            type="button"
            onClick={() => setBloqueada((b) => !b)}
            className="btn-small"
          >
            {bloqueada ? "Desbloquear para retocarla" : "Bloquear firma"}
          </button>
        )}
        <button
          type="button"
          onClick={clear}
          disabled={bloqueada}
          className="btn-small text-zinc-600"
        >
          Borrar y repetir
        </button>
      </div>

      {hasInk && !bloqueada && (
        <p className="mt-2 text-xs text-zinc-500">
          Bloquéala para que no se te estropee al desplazarte por la página.
        </p>
      )}
    </div>
  );
}

/** Recorta el lienzo a la caja que ocupa la tinta y añade un margen pequeño. */
function exportTrimmed(canvas: HTMLCanvasElement | null): string | null {
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;

  const pad = Math.round(Math.max(width, height) * 0.02);
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);

  const out = document.createElement("canvas");
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext("2d")?.drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}
