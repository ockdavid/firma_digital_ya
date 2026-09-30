"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Reenviar invalida el enlace anterior y emite uno nuevo. */
export default function ResendButton({
  documentId,
  signerId,
}: {
  documentId: string;
  signerId: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");

  async function resend() {
    setState("busy");
    const response = await fetch(`/api/documents/${documentId}/resend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signerId,
        senderName: localStorage.getItem("firmaya:sender") ?? "",
      }),
    });
    setState(response.ok ? "sent" : "error");
    if (response.ok) router.refresh();
  }

  if (state === "sent") {
    return <span className="text-xs font-medium text-emerald-700">Enlace reenviado</span>;
  }

  return (
    <button
      onClick={resend}
      disabled={state === "busy"}
      className="btn-small text-zinc-600"
    >
      {state === "busy" ? "Enviando…" : state === "error" ? "Reintentar" : "Reenviar enlace"}
    </button>
  );
}
