# Firmaya

Firma electrónica de contratos en PDF. Subes el documento, dices quién debe firmarlo,
cada parte recibe un enlace personal, dibuja su firma y esta se estampa en todas las
páginas. Cuando han firmado todos, se genera la copia final con hoja de firmas y traza
de auditoría, y se envía por correo a cada firmante.

Pensado para contratos de alquiler de habitación y de gestión de habitaciones.

## Requisitos

- Node 20 o superior (probado en 24).
- Nada más: base de datos SQLite y ficheros en disco local.

## Puesta en marcha

**Doble clic en `Firmaya.cmd`.** Instala lo que falte, arranca el servidor y abre el
navegador solo. Deja esa ventana negra abierta mientras uses la aplicación: es el
servidor. Para parar, ciérrala.

No existe un `.html` que puedas abrir directamente. El PDF se sella en el servidor
—nunca en el navegador— y eso es justo lo que impide que un firmante devuelva un
documento alterado.

Desde terminal, dentro de esta carpeta:

```bash
npm install
npm run dev
```

Si `npm run dev` falla, casi siempre es que la terminal no está en esta carpeta.

La configuración vive en `.env.local` (se copia de `.env.example`). Las dos que importan:

```
APP_SECRET=      # node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
ADMIN_PASSWORD=  # tu contraseña del panel
```

La aplicación queda en http://localhost:3000. Con `EMAIL_DRIVER=console` no se envía ningún correo:
el enlace de firma aparece en la terminal y el correo completo se guarda en
`storage/outbox/`. Así puedes probar el circuito entero sin dar de alta un dominio.

Para enviar de verdad, crea una cuenta en [resend.com](https://resend.com), verifica tu
dominio y pon `EMAIL_DRIVER=resend`, `RESEND_API_KEY` y `MAIL_FROM`.

## Cómo funciona

1. **Borrador.** Subes el PDF y añades los firmantes. Se valida el documento, se le
   quitan JavaScript embebido, acciones de apertura y campos de formulario, y se guarda
   junto a su huella SHA-256. **No se envía nada todavía.**
2. **Colocación.** Ves el contrato y haces clic donde debe firmar cada persona. Esa
   posición se repite en todas las páginas. Quien no lleve marca firmará en el margen
   inferior derecho. Al enviar, las posiciones quedan guardadas como plantilla del tipo
   de contrato, así el siguiente alquiler ya viene colocado.
3. **Revisión.** Repasas PDF, correos y colocación. Mientras es borrador puedes editar
   los datos, sustituir el PDF equivocado o descartarlo entero.
4. **Envío.** Ahí se generan los enlaces, con un token aleatorio de 32 bytes por
   firmante. En base de datos solo se guarda su HMAC: quien lea la base de datos no
   puede reconstruir ningún enlace.
5. **Identidad.** Al abrir el enlace se pide el DNI, NIE o pasaporte del firmante. Se
   guarda con scrypt, así que es irrecuperable incluso para ti. Cinco fallos bloquean
   el enlace 15 minutos.
6. **Firma.** El navegador manda únicamente el PNG del trazo. El PDF se sella en el
   servidor, nunca en el cliente.
7. **Cierre.** Con la última firma se añade la hoja de firmas (bloque por firmante y
   traza de auditoría completa) y se manda la copia final a todos.

Cada versión del PDF se guarda como fichero aparte. Nada se sobrescribe.

Un expediente ya enviado **no se edita**: alguien puede haberlo abierto o firmado, y
cambiar el PDF por debajo sería indefendible. Lo que se puede hacer es **cancelarlo**,
lo que invalida todos los enlaces a la vez y queda registrado, y volver a enviarlo como
contrato nuevo.

## Modelo de seguridad

| Riesgo | Qué lo frena |
| --- | --- |
| El enlace acaba en manos ajenas | Segundo factor: documento de identidad, con bloqueo tras 5 fallos |
| Alguien adivina URLs | Tokens de 32 bytes aleatorios, guardados como HMAC |
| Fuga de contratos por URL pública | Nada en `/public`: todo pasa por rutas que comprueban sesión |
| PDF alterado por el firmante | El cliente solo envía la imagen de la firma; el sellado es del servidor |
| Dos firmas simultáneas se pisan | Control optimista por versión + reintento; cubierto por el test e2e |
| Documento manipulado a posteriori | SHA-256 de cada versión en la traza y en la hoja de firmas |
| Fuerza bruta sobre el DNI | Contador por firmante más límite por IP |
| Envío por error o PDF equivocado | Nada sale hasta que confirmas; después, cancelación que invalida todos los enlaces |

Lo que genera es una **firma electrónica simple** (eIDAS). Es válida y admisible para
contratos privados, y su fuerza probatoria depende de la traza de auditoría. No es firma
avanzada ni cualificada: para escrituras o trámites con la Administración no sirve.

## Pruebas

Con el servidor levantado en otro puerto y directorios de datos propios:

```bash
BASE=http://localhost:3113 ADMIN_PASSWORD=... OUTBOX=.../storage/outbox node scripts/e2e.mjs
```

Recorre el circuito completo por HTTP: acceso al panel, validación de DNI/NIE, puerta de
identidad, aislamiento entre firmantes, dos firmas enviadas a la vez y comprobación del
PDF final.

## Despliegue

Necesita **disco persistente y un solo proceso** (SQLite y ficheros locales). Vercel y
las plataformas serverless no sirven tal cual. Opciones directas: Railway, Fly.io,
Render o un VPS.

Al desplegar:

- `APP_URL` debe ser la URL pública real, o los enlaces del correo no funcionarán.
- Copia de seguridad de `data/` y `storage/`: ahí está todo.
- HTTPS obligatorio; las cookies se marcan `secure` en producción.
- Si cambias `APP_SECRET`, todos los enlaces pendientes dejan de valer.

## Lo que no hace todavía

- Firmas en sitios distintos según la página, o campos separados de fecha e iniciales:
  cada firmante tiene una única posición que se repite en todas las hojas.
- Sellado PAdES con certificado (haría detectable cualquier cambio posterior en Adobe
  Reader).
- Recordatorios automáticos a quien no firma.
- Registro de usuarios: por ahora hay un único administrador.
