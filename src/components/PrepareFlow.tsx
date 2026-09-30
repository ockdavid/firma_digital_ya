"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import PdfPagePicker from "./PdfPagePicker";
import { cajaGuardada, mismaCaja, type Box } from "@/lib/box";

export interface PrepareSigner {
  id: string;
  name: string;
  email: string;
  role: string | null;
  docIdType: string;
  docIdMasked: string;
  posX: number | null;
  posY: number | null;
  posW: number | null;
  posH: number | null;
}

interface Props {
  documentId: string;
  title: string;
  kindLabel: string;
  pageCount: number;
  signers: PrepareSigner[];
  /** Excepciones ya guardadas: firmante → número de página → caja. */
  pageBoxes: Record<string, Record<number, Box>>;
}

const COLORES = ["#2563eb", "#c2410c", "#7c3aed", "#0f766e", "#be123c", "#a16207"];

export default function PrepareFlow({
  documentId,
  title,
  kindLabel,
  pageCount,
  signers,
  pageBoxes,
}: Props) {
  const router = useRouter();
  const [paso, setPaso] = useState<"colocar" | "revisar">("colocar");
  const [activo, setActivo] = useState(signers[0]?.id ?? "");
  const [pagina, setPagina] = useState(1);
  // Caja general de cada firmante, la que se repite en todas las páginas.
  const [cajas, setCajas] = useState<Record<string, Box | undefined>>(() =>
    Object.fromEntries(
      signers.map((s) => [s.id, cajaGuardada(s.posX, s.posY, s.posW, s.posH) ?? undefined]),
    ),
  );
  // Excepciones: páginas donde la firma no cabe en el sitio general.
  const [porPagina, setPorPagina] = useState<Record<string, Record<number, Box>>>(
    () => ({ ...pageBoxes }),
  );
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const marcadores = signers.map((s, i) => ({
    signerId: s.id,
    label: s.name.split(/\s+/)[0],
    color: COLORES[i % COLORES.length],
  }));

  const nombreActivo = signers.find((s) => s.id === activo)?.name ?? "";
  const excepcionesActivo = porPagina[activo] ?? {};
  const paginaEsPropia = Boolean(excepcionesActivo[pagina]);

  /**
   * La primera caja que dibujas vale para todo el documento. A partir de ahí,
   * moverla en una página concreta solo cambia esa página.
   */
  function colocar(signerId: string, page: number, box: Box) {
    if (!cajas[signerId]) {
      setCajas((prev) => ({ ...prev, [signerId]: box }));
      return;
    }
    setPorPagina((prev) => {
      const suyas = { ...(prev[signerId] ?? {}) };
      if (mismaCaja(box, cajas[signerId])) delete suyas[page];
      else suyas[page] = box;
      return { ...prev, [signerId]: suyas };
    });
  }

  /** Esta página vuelve a usar la posición general. */
  function usarGeneral() {
    setPorPagina((prev) => {
      const suyas = { ...(prev[activo] ?? {}) };
      delete suyas[pagina];
      return { ...prev, [activo]: suyas };
    });
  }

  /** La posición de esta página pasa a ser la de todas. */
  function aplicarATodas() {
    const caja = excepcionesActivo[pagina];
    if (!caja) return;
    setCajas((prev) => ({ ...prev, [activo]: caja }));
    setPorPagina((prev) => ({ ...prev, [activo]: {} }));
  }

  /** Sin caja, la rúbrica se va al margen inferior derecho. */
  function quitarPosicion() {
    setCajas((prev) => ({ ...prev, [activo]: undefined }));
    setPorPagina((prev) => ({ ...prev, [activo]: {} }));
  }

  async function guardarPosiciones(): Promise<boolean> {
    const placements = signers
      .filter((s) => cajas[s.id])
      .map((s) => {
        const caja = cajas[s.id]!;
        return {
          signerId: s.id,
          x: caja.x,
          y: caja.y,
          w: caja.w,
          h: caja.h,
          pages: Object.entries(porPagina[s.id] ?? {}).map(([page, propia]) => ({
            page: Number(page),
            x: propia.x,
            y: propia.y,
            w: propia.w,
            h: propia.h,
          })),
        };
      });

    const response = await fetch(`/api/documents/${documentId}/placement`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placements }),
    });
    if (response.ok) return true;
    const data = await response.json().catch(() => ({}));
    setError(data.error ?? "No se pudieron guardar las posiciones.");
    return false;
  }

  async function continuar() {
    setOcupado(true);
    setError(null);
    if (await guardarPosiciones()) setPaso("revisar");
    setOcupado(false);
  }

  async function enviar() {
    setOcupado(true);
    setError(null);
    const response = await fetch(`/api/documents/${documentId}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senderName: localStorage.getItem("firmaya:sender") ?? "" }),
    });
    if (response.ok) {
      router.push(`/documento/${documentId}`);
      router.refresh();
      return;
    }
    const data = await response.json().catch(() => ({}));
    setError(data.error ?? "No se pudo enviar.");
    setOcupado(false);
  }

  async function descartar() {
    if (!confirm("¿Descartar este borrador? Se borrará el PDF subido.")) return;
    setOcupado(true);
    const response = await fetch(`/api/documents/${documentId}`, { method: "DELETE" });
    if (response.ok) {
      router.push("/");
      router.refresh();
      return;
    }
    setError("No se pudo descartar el borrador.");
    setOcupado(false);
  }

  const sinColocar = signers.filter((s) => !cajas[s.id]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="pill bg-zinc-100 text-zinc-600">Borrador</span>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {kindLabel} · {pageCount} páginas · todavía no se ha enviado nada
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/documento/${documentId}/editar`} className="btn-secondary">
            Editar datos
          </Link>
          <button onClick={descartar} disabled={ocupado} className="btn-secondary">
            Descartar
          </button>
        </div>
      </div>

      {paso === "colocar" ? (
        <>
          <div className="card p-5">
            <h2 className="text-sm font-semibold">Dónde firma cada uno</h2>
            <p className="mt-1 mb-4 text-xs leading-relaxed text-zinc-500">
              Elige a una persona y dibuja arrastrando la caja donde debe ir su firma; un clic
              suelto la pone con el tamaño de siempre. Después puedes arrastrarla para moverla o
              tirar de su esquina para cambiarle el tamaño. La primera caja vale para las{" "}
              {pageCount} páginas: si la mueves dentro de una página concreta, solo cambia esa. Si
              no marcas a alguien, su rúbrica irá al margen inferior derecho.
            </p>

            <div className="flex flex-wrap gap-2">
              {signers.map((signer, i) => {
                const color = COLORES[i % COLORES.length];
                const colocado = Boolean(cajas[signer.id]);
                const esActivo = signer.id === activo;
                return (
                  <button
                    key={signer.id}
                    type="button"
                    onClick={() => setActivo(signer.id)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                      esActivo
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-300 bg-white hover:bg-zinc-50"
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="font-medium">{signer.name}</span>
                    <span className={esActivo ? "text-zinc-300" : "text-zinc-400"}>
                      {colocado ? "colocado" : "sin colocar"}
                    </span>
                  </button>
                );
              })}
            </div>

            {paginaEsPropia && (
              <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5">
                <p className="text-xs text-zinc-600">
                  En la página {pagina}, {nombreActivo} firma en un sitio distinto al general.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={usarGeneral} className="btn-small">
                    Usar la posición general
                  </button>
                  <button type="button" onClick={aplicarATodas} className="btn-small">
                    Aplicar esta a todas las páginas
                  </button>
                </div>
              </div>
            )}

            {cajas[activo] && (
              <button
                type="button"
                onClick={quitarPosicion}
                className="btn-small mt-3 text-zinc-600"
              >
                Quitar la posición de {nombreActivo} y dejarla al margen
              </button>
            )}
          </div>

          <PdfPagePicker
            fileUrl={`/api/documents/${documentId}/file`}
            markers={marcadores}
            boxes={cajas}
            pageBoxes={porPagina}
            activeSignerId={activo}
            page={pagina}
            onPageChange={setPagina}
            onPlace={colocar}
          />

          {error && <ErrorBox mensaje={error} />}

          <button onClick={continuar} disabled={ocupado} className="btn-primary w-full">
            {ocupado ? "Guardando…" : "Continuar a la revisión"}
          </button>
        </>
      ) : (
        <>
          <div className="card divide-y divide-zinc-100">
            <div className="px-5 py-4">
              <h2 className="text-sm font-semibold">Revisa antes de enviar</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Al confirmar se generan los enlaces y salen los correos. A partir de ahí solo
                podrás cancelar el expediente, no editarlo.
              </p>
            </div>

            {signers.map((signer, i) => {
              const propias = Object.keys(porPagina[signer.id] ?? {}).length;
              return (
                <div key={signer.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: COLORES[i % COLORES.length] }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">
                      {signer.name}
                      {signer.role && (
                        <span className="ml-2 font-normal text-zinc-400">{signer.role}</span>
                      )}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-zinc-500">
                      {signer.email} · le pediremos su {signer.docIdType.toUpperCase()}{" "}
                      {signer.docIdMasked}
                    </p>
                  </div>
                  <span className="pill bg-zinc-100 text-zinc-600">
                    {!cajas[signer.id]
                      ? "al margen"
                      : propias === 0
                        ? "posición marcada"
                        : `posición marcada · ${propias} página${propias === 1 ? "" : "s"} aparte`}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="card px-5 py-4">
            <a
              href={`/api/documents/${documentId}/file`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium underline-offset-2 hover:underline"
            >
              Abrir el PDF que se va a enviar
            </a>
            <p className="mt-1 text-xs text-zinc-500">
              Compruébalo si no estás seguro de haber subido el contrato correcto.
            </p>
          </div>

          {sinColocar.length > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              {sinColocar.map((s) => s.name).join(", ")}{" "}
              {sinColocar.length === 1 ? "firmará" : "firmarán"} en el margen inferior derecho de
              cada página, porque no marcaste su posición.
            </p>
          )}

          {error && <ErrorBox mensaje={error} />}

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={() => setPaso("colocar")}
              disabled={ocupado}
              className="btn-secondary sm:flex-1"
            >
              Volver a colocar
            </button>
            <button onClick={enviar} disabled={ocupado} className="btn-primary sm:flex-[2]">
              {ocupado ? "Enviando…" : `Enviar para firma a ${signers.length} persona${signers.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ErrorBox({ mensaje }: { mensaje: string }) {
  return (
    <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {mensaje}
    </p>
  );
}
