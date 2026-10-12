# Publicar Trazo y conectar Google Drive (se hace una sola vez)

Son dos trámites en webs externas que solo puede hacer el dueño de las cuentas. Lo demás ya está preparado.

## Parte 1. Publicar la app (GitHub Pages, gratis). Unos 5 minutos

Se publica **solo el programa**. Tus notas nunca se suben a GitHub. El código queda público: cualquiera con el enlace vería la app vacía, nunca tus notas.

1. Entra en <https://github.com> con tu cuenta **jsanchez19961-cyber**.
2. Abre <https://github.com/new>:
   - *Repository name*: `trazo`
   - Marca **Public**.
   - No marques nada más.
   - Pulsa **Create repository**.
3. En la carpeta del proyecto, doble clic en `PUBLICAR.bat`. La primera vez se abre una ventana para entrar en GitHub: acéptala.
4. En GitHub, en tu repositorio `trazo`: **Settings › Pages**. En *Branch* elige `gh-pages` y `/ (root)`, y pulsa **Save**.
5. En uno o dos minutos la app estará en <https://jsanchez19961-cyber.github.io/trazo/>.

Cada vez que haya una versión nueva: doble clic en `PUBLICAR.bat`.

## Parte 2. Instalarla en la tablet

1. Abre <https://jsanchez19961-cyber.github.io/trazo/> en la tablet:
   - iPad: con Safari;
   - Android: con Chrome.
2. Instálala:
   - iPad: botón Compartir › **Añadir a pantalla de inicio**;
   - Android: menú ⋮ › **Instalar aplicación**.

Desde entonces se abre como una app, funciona sin conexión y no hace falta el ordenador.

## Parte 3. Permiso de Google Drive («ID de cliente»). Unos 10 minutos

Sirve para que la app pueda guardar tus notas en tu Google Drive. La app **solo** puede ver la carpeta «Trazo» que crea ella misma; el resto de tu Drive, no.

Usa la cuenta de Google cuyo Drive quieras usar para las notas.

1. Entra en <https://console.cloud.google.com>.
2. **Crea un proyecto**: selector de proyectos (arriba) › *Proyecto nuevo* › nombre `Trazo` › *Crear*. Comprueba que queda seleccionado arriba.
3. **Activa Drive**: menú ☰ › *APIs y servicios* › *Biblioteca* › busca **Google Drive API** › *Habilitar*.
4. **Pantalla de permiso**: menú ☰ › *APIs y servicios* › *Pantalla de consentimiento de OAuth* (puede llamarse *Google Auth Platform*) › *Comenzar*:
   - nombre de la aplicación: `Trazo`; correo de asistencia: el tuyo;
   - público: **Externo**;
   - correo de contacto: el tuyo; acepta la política › *Crear*.
5. En el mismo apartado:
   - **Público** (*Audience*): en *Usuarios de prueba*, añade tu correo de Google.
   - **Acceso a datos** (*Data access*): *Añadir o quitar permisos* › busca `drive.file` › márcalo › *Actualizar* › *Guardar*.
6. **Crea el ID de cliente**: *Clientes* › *Crear cliente*:
   - Tipo de aplicación: **Aplicación web**; nombre: `Trazo web`.
   - *Orígenes autorizados de JavaScript*: añade estas dos líneas:
     - `https://jsanchez19961-cyber.github.io`
     - `http://localhost:8765`
   - *URI de redireccionamiento autorizados*: añade estas dos:
     - `https://jsanchez19961-cyber.github.io/trazo/`
     - `http://localhost:8765/`
   - Pulsa *Crear*.
7. Copia el **ID de cliente** (termina en `.apps.googleusercontent.com`) y pásaselo a la IA para que lo meta en la app y publique. Si lo haces tú: pégalo entre las comillas de `app/js/config.js` y doble clic en `PUBLICAR.bat`.
   - El ID de cliente **no es secreto**.
   - El «secreto del cliente» (*client secret*) **no hace falta**: no lo copies ni lo compartas.

`[PENDIENTE DE VERIFICAR: Google cambia a menudo los nombres de los menús; pueden no coincidir palabra por palabra.]`

## Parte 4. Activar la sincronización

En la app: **Ajustes › Google Drive › Conectar con Google Drive**.

- Google avisará de que la app «no está verificada». Es normal: es tu app privada en modo de prueba. Pulsa *Continuar* y acepta.
- Se crea la carpeta **Trazo** en tu Drive.
- Desde entonces se sincroniza sola: al abrir la app, al cerrar un documento y cada pocos minutos.
- Por seguridad, Google pide renovar el permiso cada cierto tiempo. Si arriba ves el botón **Conectar Drive**, tócalo.
- Repite este paso en cada dispositivo donde uses Trazo (tablet, oficina, casa).

## Qué pasa si…

- **…escribes en dos dispositivos el mismo documento sin sincronizar**: se guardan las dos versiones. Una aparece con «(versión de otro dispositivo)» en el título.
- **…borras un documento definitivamente** (papelera › borrar): se borra también en Drive y en los demás dispositivos.
- **…pierdes la tablet**: instala la app en otra, conecta Drive y vuelven todas tus notas.
