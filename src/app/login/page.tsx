import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { isAdmin } from "@/lib/session";

export default async function LoginPage() {
  if (await isAdmin()) redirect("/");

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Firmaya</h1>
        <p className="mt-1 mb-8 text-sm text-zinc-500">Panel de envío de contratos.</p>
        <LoginForm />
      </div>
    </main>
  );
}
