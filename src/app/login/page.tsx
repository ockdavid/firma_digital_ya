import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { isAdmin } from "@/lib/session";

/** Solo rutas de esta misma aplicacion: nunca una direccion de fuera. */
function destinoSeguro(valor: string | undefined): string {
  if (!valor || !valor.startsWith("/") || valor.startsWith("//") || valor.startsWith("/\\")) {
    return "/";
  }
  return valor;
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const destino = destinoSeguro(typeof next === "string" ? next : undefined);
  if (await isAdmin()) redirect(destino);

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Firmaya</h1>
        <p className="mt-1 mb-8 text-sm text-zinc-500">Panel de envío de contratos.</p>
        <LoginForm destino={destino} />
      </div>
    </main>
  );
}
