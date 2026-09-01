"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (response.ok) {
      router.replace("/");
      router.refresh();
      return;
    }
    const data = await response.json().catch(() => ({}));
    setError(data.error ?? "No se pudo entrar.");
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="card p-6">
      <label className="label" htmlFor="password">
        Contraseña
      </label>
      <input
        id="password"
        type="password"
        autoFocus
        autoComplete="current-password"
        className="input"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={busy || !password} className="btn-primary mt-5 w-full">
        {busy ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
