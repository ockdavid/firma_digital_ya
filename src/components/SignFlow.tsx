"use client";

import { useState } from "react";
import SignaturePad from "./SignaturePad";

interface Props {
  token: string;
  signerName: string;
  signerRole: string | null;
  documentTitle: string;
  pageCount: number;
  docIdLabel: string;
  authenticated: boolean;
}

export default function SignFlow(props: Props) {
  const [step, setStep] = useState<"identidad" | "firma" | "hecho">(
    props.authenticated ? "firma" : "identidad",
  );
  const [completed, setCompleted] = useState(false);

  if (step === "hecho") {
    return (
      <Shell title={props.documentTitle}>
        <div className="card p-8 text-center">
          <div
            className="mx-auto mb-5 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-lg text-emerald-600"
            aria-hidden
          >
            ✓
          </div>
          <h2 className="text-lg font-semibold tracking-tight">Firma registrada</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500">
            {completed
              ? "Todas las partes han firmado. Te llega la copia final por correo en unos segundos."
              : "Faltan otras firmas. Cuando el documento esté completo recibirás la copia final por correo."}
          </p>
          <p className="mt-4 text-xs text-zinc-400">Ya puedes cerrar esta página.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title={props.documentTitle}>
      {step === "identidad" ? (
        <IdentityGate {...props} onSuccess={() => setStep("firma")} />
      ) : (
        <SignStep
          {...props}
          onSigned={(wasCompleted) => {
            setCompleted(wasCompleted);
            setStep("hecho");
          }}
        />
      )}
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <p className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Firmaya</p>
      <h1 className="mt-1.5 mb-7 text-xl font-semibold tracking-tight">{title}</h1>
      {children}
    </main>
  );
}

function IdentityGate({
  token,
  signerName,
  docIdLabel,
  onSuccess,
}: Props & { onSuccess: () => void }) {
  const [docId, setDocId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/sign/${token}/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docId }),
    });
    if (response.ok) return onSuccess();
    const data = await response.json().catch(() => ({}));
    setError(data.error ?? "No se pudo verificar tu identidad.");
    setRemaining(typeof data.remaining === "number" ? data.remaining : null);
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="card p-6">
      <p className="text-sm leading-relaxed">
        Hola <strong>{signerName}</strong>. Para abrir el contrato, introduce tu{" "}
        <strong>{docIdLabel}</strong>.
      </p>
      <p className="mt-2 mb-6 text-xs leading-relaxed text-zinc-500">
        Es la comprobación que impide que alguien que reciba tu enlace por error pueda leer el
        documento.
      </p>

      <label className="label" htmlFor="docId">
        {docIdLabel}
      </label>
      <input
        id="docId"
        autoFocus
        autoComplete="off"
        spellCheck={false}
        className="input font-mono tracking-wider uppercase"
        placeholder="12345678Z"
        value={docId}
        onChange={(e) => setDocId(e.target.value)}
      />

      {error && (
        <p className="mt-3 text-sm text-red-600">
          {error}
          {remaining !== null && remaining > 0 && (
            <span className="block text-xs text-red-500">
              Te quedan {remaining} intento{remaining === 1 ? "" : "s"}.
            </span>
          )}
        </p>
      )}

      <button type="submit" disabled={busy || !docId} className="btn-primary mt-5 w-full">
        {busy ? "Comprobando…" : "Abrir contrato"}
      </button>
    </form>
  );
}

function SignStep({
  token,
  signerName,
  signerRole,
  pageCount,
  onSigned,
}: Props & { onSigned: (completed: boolean) => void }) {
  const [signature, setSignature] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sign() {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/sign/${token}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signature, consent }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) return onSigned(Boolean(data.completed));
    if (data.alreadySigned) return onSigned(false);
    setError(data.error ?? "No se pudo registrar la firma.");
    setConfirming(false);
    setBusy(false);
  }

  return (
    <div className="space-y-5">
      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3">
          <h2 className="text-sm font-semibold">El documento</h2>
          <a
            href={`/api/sign/${token}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline"
          >
            Abrir en pestaña nueva
          </a>
        </div>
        <iframe
          src={`/api/sign/${token}/pdf`}
          title="Contrato"
          className="h-[60vh] w-full bg-zinc-100"
        />
      </section>

      <section className="card p-5">
        <h2 className="mb-1 text-sm font-semibold">Tu firma</h2>
        <p className="mb-4 text-xs text-zinc-500">
          {signerName}
          {signerRole ? ` · ${signerRole}` : ""}
        </p>
        <SignaturePad onChange={setSignature} />

        <label className="mt-5 flex cursor-pointer items-start gap-3 text-xs leading-relaxed text-zinc-600">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-zinc-900"
          />
          <span>
            He leído el documento y acepto firmarlo electrónicamente. Entiendo que mi firma se
            estampará en las {pageCount} páginas y que se registrarán la fecha, la hora y mi
            dirección IP como prueba.
          </span>
        </label>

        {error && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {!confirming ? (
          <button
            type="button"
            disabled={!signature || !consent}
            onClick={() => setConfirming(true)}
            className="btn-primary mt-5 w-full"
          >
            Firmar todas las páginas
          </button>
        ) : (
          <div className="mt-5 rounded-lg border border-zinc-300 bg-zinc-50 p-4">
            <p className="text-sm font-medium">
              ¿Confirmas la firma de las {pageCount} páginas?
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Una vez confirmada no podrás deshacerla desde aquí.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="btn-secondary flex-1"
              >
                Volver
              </button>
              <button type="button" onClick={sign} disabled={busy} className="btn-primary flex-1">
                {busy ? "Firmando…" : "Sí, firmar"}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
