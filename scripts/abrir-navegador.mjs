import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

/**
 * Espera a que el servidor de Firmaya responda y abre el navegador.
 *
 * Comprueba que quien contesta somos nosotros y no otra aplicación que ya
 * ocupaba el puerto: abrir el navegador en el sitio equivocado confunde más
 * que no abrirlo.
 */

const URL_BASE = process.env.FIRMAYA_URL ?? "http://localhost:3000";
const INTENTOS = 120; // 60 segundos

async function esperarYAbrir() {
  for (let i = 0; i < INTENTOS; i++) {
    try {
      const response = await fetch(`${URL_BASE}/login`, { redirect: "follow" });
      const body = await response.text();

      if (response.ok && body.includes("Firmaya")) {
        spawn("cmd", ["/c", "start", "", URL_BASE], { detached: true, stdio: "ignore" }).unref();
        console.log(`\nFirmaya abierta en ${URL_BASE}\n`);
        // Damos un instante a que el proceso hijo arranque antes de salir.
        await sleep(300);
        return true;
      }

      if (response.ok) {
        console.error(
          `\nEl puerto de ${URL_BASE} ya lo está usando otro programa.\n` +
            `Cierra ese programa, o arranca Firmaya en otro puerto con:\n` +
            `  npx next dev -p 3001\n`,
        );
        return false;
      }
    } catch {
      // El servidor todavía no escucha: seguimos esperando.
    }
    await sleep(500);
  }

  console.error("\nEl servidor no respondió en 60 segundos. Mira los mensajes de arriba.\n");
  return false;
}

if (!(await esperarYAbrir())) process.exitCode = 1;
