"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function AccessForm({ destino }: { destino: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch("/api/auth/acceso", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (response.ok) {
      router.replace(destino);
      router.refresh();
      return;
    }
    const data = await response.json().catch(() => ({}));
    setError(data.error ?? "No se pudo entrar.");
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="card p-6">
      <label className="label" htmlFor="code">
        Clave de acceso
      </label>
      <input
        id="code"
        type="text"
        autoFocus
        autoComplete="off"
        inputMode="text"
        className="input"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={busy || !code} className="btn-primary mt-5 w-full">
        {busy ? "Abriendo…" : "Abrir el contrato"}
      </button>
    </form>
  );
}
