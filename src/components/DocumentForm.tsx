"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { DocumentKind } from "@/lib/db";
import { KIND_LABEL, ROLE_SUGGESTIONS } from "@/lib/labels";
import { DOC_ID_LABEL, validateDocId, type DocIdType } from "@/lib/dni";

interface SignerDraft {
  name: string;
  email: string;
  role: string;
  docIdType: DocIdType;
  docId: string;
  /** Lo que ya había guardado, solo para enseñarlo: el valor real está hasheado. */
  docIdMasked?: string;
}

export interface DocumentFormInitial {
  title: string;
  kind: DocumentKind;
  signers: SignerDraft[];
}

interface Props {
  documentId?: string;
  initial?: DocumentFormInitial;
}

const emptySigner = (role = ""): SignerDraft => ({
  name: "",
  email: "",
  role,
  docIdType: "dni",
  docId: "",
});

export default function DocumentForm({ documentId, initial }: Props) {
  const router = useRouter();
  const editando = Boolean(documentId);
  const yaExistentes = initial?.signers.length ?? 0;

  const [title, setTitle] = useState(initial?.title ?? "");
  const [kind, setKind] = useState<DocumentKind>(initial?.kind ?? "alquiler_habitacion");
  const senderRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [signers, setSigners] = useState<SignerDraft[]>(
    initial?.signers ?? [emptySigner("Arrendador"), emptySigner("Arrendatario")],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Tu nombre aparece en cada invitación; se recuerda para no reescribirlo.
  // El campo va sin estado de React: así rellenarlo al montar es escribir en el
  // DOM, no un setState en cascada dentro del efecto.
  useEffect(() => {
    const saved = localStorage.getItem("firmaya:sender");
    if (saved && senderRef.current) senderRef.current.value = saved;
  }, []);

  function update(index: number, patch: Partial<SignerDraft>) {
    setSigners((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function changeKind(next: DocumentKind) {
    setKind(next);
    if (editando) return; // no pisamos roles ya escritos al corregir un borrador
    const roles = ROLE_SUGGESTIONS[next];
    setSigners((prev) => prev.map((s, i) => ({ ...s, role: roles[i] ?? s.role })));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!editando && !file) return setError("Adjunta el PDF del contrato.");

    for (const [index, signer] of signers.entries()) {
      const puedeOmitirlo = editando && index < yaExistentes;
      if (!signer.docId.trim() && puedeOmitirlo) continue;
      const check = validateDocId(signer.docId, signer.docIdType);
      if (!check.ok) {
        return setError(`${signer.name || "Firmante sin nombre"}: ${check.error}`);
      }
    }

    const senderName = senderRef.current?.value.trim() ?? "";
    setBusy(true);
    localStorage.setItem("firmaya:sender", senderName);

    const form = new FormData();
    form.set("title", title);
    form.set("kind", kind);
    if (file) form.set("pdf", file);
    form.set(
      "signers",
      JSON.stringify(
        signers.map(({ name, email, role, docIdType, docId }) => ({
          name,
          email,
          role,
          docIdType,
          docId,
        })),
      ),
    );

    const response = await fetch(documentId ? `/api/documents/${documentId}` : "/api/documents", {
      method: documentId ? "PATCH" : "POST",
      body: form,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error ?? "No se pudo guardar.");
      setBusy(false);
      return;
    }
    router.push(`/documento/${documentId ?? data.documentId}/preparar`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="card space-y-4 p-5">
        <div>
          <label className="label" htmlFor="title">
            Título
          </label>
          <input
            id="title"
            className="input"
            placeholder="Contrato de alquiler — Habitación 2, C/ Mayor 14"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="kind">
              Tipo
            </label>
            <select
              id="kind"
              className="input"
              value={kind}
              onChange={(e) => changeKind(e.target.value as DocumentKind)}
            >
              {(Object.keys(KIND_LABEL) as DocumentKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="sender">
              Tu nombre (aparece en el correo)
            </label>
            <input id="sender" ref={senderRef} className="input" placeholder="David" required />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="pdf">
            {editando ? "Sustituir el PDF (opcional)" : "PDF del contrato"}
          </label>
          <input
            id="pdf"
            type="file"
            accept="application/pdf"
            className="input file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required={!editando}
          />
          <p className="mt-1.5 text-xs text-zinc-500">
            {editando
              ? "Si subiste el contrato equivocado, elige aquí el correcto. Déjalo vacío para conservar el actual."
              : "Después elegirás dónde firma cada persona."}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Firmantes</h2>
        {signers.map((signer, index) => (
          <div key={index} className="card space-y-3 p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-400">Firmante {index + 1}</span>
              {signers.length > 1 && (
                <button
                  type="button"
                  onClick={() => setSigners((prev) => prev.filter((_, i) => i !== index))}
                  className="text-xs font-medium text-zinc-400 transition hover:text-red-600"
                >
                  Quitar
                </button>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <input
                className="input"
                placeholder="Nombre y apellidos"
                value={signer.name}
                onChange={(e) => update(index, { name: e.target.value })}
                required
              />
              <input
                className="input"
                type="email"
                placeholder="correo@ejemplo.com"
                value={signer.email}
                onChange={(e) => update(index, { email: e.target.value })}
                required
              />
              <RoleField
                value={signer.role}
                options={ROLE_SUGGESTIONS[kind]}
                onChange={(role) => update(index, { role })}
              />
              <div className="flex gap-2">
                <select
                  className="input w-32 shrink-0"
                  value={signer.docIdType}
                  onChange={(e) => update(index, { docIdType: e.target.value as DocIdType })}
                >
                  {(Object.keys(DOC_ID_LABEL) as DocIdType[]).map((t) => (
                    <option key={t} value={t}>
                      {DOC_ID_LABEL[t]}
                    </option>
                  ))}
                </select>
                <input
                  className="input font-mono uppercase"
                  placeholder={signer.docIdMasked ?? "12345678Z"}
                  value={signer.docId}
                  onChange={(e) => update(index, { docId: e.target.value })}
                  required={!signer.docIdMasked}
                />
              </div>
            </div>
            <p className="text-xs text-zinc-500">
              {signer.docIdMasked
                ? "Déjalo vacío para conservar el documento que ya guardaste; escríbelo solo si quieres cambiarlo."
                : "Le pediremos este documento al abrir el enlace. Se guarda cifrado: ni tú puedes volver a leerlo desde la aplicación."}
            </p>
          </div>
        ))}

        {signers.length < 6 && (
          <button
            type="button"
            onClick={() => setSigners((prev) => [...prev, emptySigner()])}
            className="btn-secondary w-full"
          >
            Añadir firmante
          </button>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy} className="btn-primary w-full">
        {busy ? "Guardando…" : editando ? "Guardar cambios" : "Continuar"}
      </button>
      <p className="text-center text-xs text-zinc-500">
        No se envía ningún correo todavía: el siguiente paso es colocar las firmas y revisar.
      </p>
    </form>
  );
}

const ROL_LIBRE = "__otro__";

/**
 * Rol del firmante: lista desplegable con los del tipo de contrato, más una
 * salida a texto libre.
 *
 * Antes era un input con datalist, pero el navegador filtra esas sugerencias
 * por lo ya escrito: con "Arrendatario" puesto, la flecha solo ofrecía
 * "Arrendatario" y parecía que faltaban opciones.
 */
function RoleField({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const enLista = options.includes(value);
  const [libre, setLibre] = useState(value !== "" && !enLista);
  const mostrarTexto = libre || (value !== "" && !enLista);

  if (mostrarTexto) {
    return (
      <div>
        <input
          className="input"
          autoFocus
          placeholder="Escribe el rol"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => {
            setLibre(false);
            onChange("");
          }}
          className="mt-1 text-xs font-medium text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline"
        >
          Elegir de la lista
        </button>
      </div>
    );
  }

  return (
    <select
      className="input"
      value={value}
      onChange={(e) => {
        if (e.target.value === ROL_LIBRE) {
          setLibre(true);
          onChange("");
          return;
        }
        onChange(e.target.value);
      }}
    >
      <option value="">Rol (opcional)</option>
      {options.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
      <option value={ROL_LIBRE}>Otro…</option>
    </select>
  );
}
