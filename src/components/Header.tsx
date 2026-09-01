"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export default function Header() {
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
        <Link href="/" className="text-base font-semibold tracking-tight">
          Firmaya
        </Link>
        <button
          onClick={logout}
          className="text-sm font-medium text-zinc-500 transition hover:text-zinc-900"
        >
          Salir
        </button>
      </div>
    </header>
  );
}
