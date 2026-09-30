"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Cancelar invalida todos los enlaces a la vez. Es la salida cuando ya se ha
 * enviado y descubres que el contrato o los datos estaban mal.
 */
export default function CancelButton({
  documentId,
  signedCount,
}: {
  documentId: string;
  signedCount: number;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function cancelar() {
    setOcupado(true);
    setError(null);
    const response = await fetch(`/api/documents/${documentId}/cancel`, { method: "POST" });
    if (response.ok) {
      router.refresh();
      return;
    }
    const data = await response.json().catch(() => ({}));
    setError(data.error ?? "No se pudo cancelar.");
    setOcupado(false);
  }

  if (!confirmando) {
    return (
      <button
        onClick={() => setConfirmando(true)}
        className="btn-small text-zinc-600 hover:border-red-300 hover:bg-red-50 hover:text-red-600"
      >
        Cancelar expediente
      </button>
    );
  }

  return (
    <div className="w-full rounded-lg border border-zinc-300 bg-zinc-50 p-4">
      <p className="text-sm font-medium">¿Cancelar este expediente?</p>
      <p className="mt-1 text-xs leading-relaxed text-zinc-600">
        Los enlaces de todas las partes dejarán de funcionar al instante.
        {signedCount > 0 &&
          ` ${signedCount} firma${signedCount === 1 ? "" : "s"} ya realizada${
            signedCount === 1 ? "" : "s"
          } se conserva${signedCount === 1 ? "" : "n"} en la traza como constancia.`}{" "}
        Para volver a intentarlo tendrás que crear un contrato nuevo.
      </p>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => setConfirmando(false)}
          disabled={ocupado}
          className="btn-secondary flex-1 px-3 py-2 text-xs"
        >
          Volver
        </button>
        <button
          onClick={cancelar}
          disabled={ocupado}
          className="btn flex-1 bg-red-600 px-3 py-2 text-xs text-white hover:bg-red-700"
        >
          {ocupado ? "Cancelando…" : "Sí, cancelar"}
        </button>
      </div>
    </div>
  );
}
