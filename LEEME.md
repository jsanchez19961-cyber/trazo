# Trazo: cómo usarla

Aplicación web propia para tomar notas a mano, escribir, dibujar esquemas, anotar PDF, guardar archivos y encontrarlo todo. Versión 1.1 (12/10/2026): añade la sincronización con Google Drive.

## 1. Abrirla en este ordenador

1. Doble clic en `ARRANCAR.bat`.
2. Se abre el navegador en `http://localhost:8765`.
3. Para cerrarla, cierra la ventana negra.

No instala nada: usa el Python que ya tienes. La primera vez necesita internet para descargar las librerías (lector de PDF, OCR…); después quedan guardadas.

## 2. Usarla en la tablet

La app se publica (solo el programa, nunca tus notas) en **<https://jsanchez19961-cyber.github.io/trazo/>** con GitHub Pages, que es gratis. Los pasos de la primera vez están en `GUIA_PUBLICAR_Y_DRIVE.md`.

Ábrela en la tablet e instálala:
- iPad: **Compartir › Añadir a pantalla de inicio**;
- Android: **⋮ › Instalar aplicación**.

Así se abre como una app, funciona sin conexión y el navegador no borra los datos.

No se puede hacer un instalador clásico:
- en iPad exige un Mac y la cuenta de pago de desarrollador de Apple;
- en Android exige instalar en el PC las herramientas de Android (varios GB).

Instalar desde la web hace lo mismo.

Plan B, sin internet: `ARRANCAR_PARA_TABLET.bat` sirve la app desde el PC por la wifi. Así no se instala como app ni graba audio.

## 3. Lo que hace

- **Cuadernos** con papel en blanco, rayado, cuadrícula (5 mm), puntos o Cornell; A4, A5, carta o 16:9.
- **Pizarras**: lienzo libre sin límites para esquemas y diagramas.
- **PDF**: se importan y se anotan encima (pluma, subrayador, texto, formas). Se puede insertar un PDF dentro de un cuaderno.
- **Herramientas**: pluma (con presión o grosor fijo), subrayador (con línea recta), borrador (trazo entero o parcial, o solo subrayado), lazo (seleccionar, mover, cambiar tamaño, color, copiar, duplicar), texto con teclado (negrita, cursiva, listas, recuadro, colores), formas (línea, flecha, rectángulo, elipse, triángulo, rombo) e imágenes o fotos.
- **Formas a mano**: dibuja una línea, rectángulo, elipse o triángulo y **mantén quieto el lápiz** al final: se convierte en forma perfecta.
- **Gestos**: un dedo desplaza, dos dedos hacen zoom, toque con dos dedos deshace (tres rehace). La palma apoyada no pinta. El botón lateral del lápiz (si lo tiene) borra. Botón de la mano: elige si el dedo dibuja o desplaza.
- **Audio** con transcripción automática mientras grabas (si el navegador lo permite).
- **Organización**: carpetas y subcarpetas, etiquetas de colores, proyectos (con estado y fecha objetivo), colecciones (manuales o inteligentes, que se llenan solas con una búsqueda), favoritos y papelera (30 días).
- **Búsqueda** en títulos, etiquetas, texto escrito, texto de los PDF, texto de imágenes (OCR), transcripciones y audios. Sin tildes ni mayúsculas, tolera erratas. Filtros: `"frase exacta"`, `#etiqueta`, `tipo:pdf`, `tipo:cuaderno`, `tipo:pizarra`, `tipo:archivo`.
- **Importar**: PDF, imágenes (con OCR automático), Word (.docx), texto, Markdown, CSV y cualquier otro archivo (se guarda tal cual).
- **Exportar**: PDF con anotaciones (vectorial, se puede imprimir), imagen PNG de una página, texto en Markdown y «copia editable» (`.trazo.zip`) para pasar documentos a otro dispositivo.
- **Google Drive**: sincronización automática con la carpeta «Trazo» de tu Drive. Es tu copia de seguridad y lleva las notas a otros dispositivos.
- **Copias de seguridad manuales**: copia completa en un `.zip` y restauración, añadiendo o reemplazando.

### Escritura a mano a texto

- **Gratis y en el dispositivo**: «Reconocer texto» (OCR). Va muy bien con texto impreso y PDF escaneados; con letra a mano falla bastante.
- **En iPad**: escribe con el Apple Pencil dentro de una caja de texto y el propio iPad lo convierte a texto (función «Escritura a mano» de Apple).
- **Con IA de pago**: está programada pero **desactivada por decisión de Jesús (12/10/2026)**. No aparece salvo que se ponga una clave en Ajustes › Opciones avanzadas.

## 4. Dónde están tus datos

- En cada dispositivo, dentro del navegador (su base de datos interna).
- Si activas Google Drive, también en la carpeta **Trazo** de tu Drive. Allí verás:
  - un archivo por documento;
  - tus PDF e imágenes originales;
  - un índice con carpetas, proyectos y etiquetas.

  No los cambies a mano.
- Sin Drive, haz copias en Ajustes › Hacer copia completa.

## 5. Límites conocidos

- Google pide renovar el permiso de Drive cada cierto tiempo (por seguridad): entonces aparece el botón «Conectar Drive».
- La sincronización es por documento. Si el mismo documento se cambia en dos dispositivos sin sincronizar, se guardan las dos versiones.
- El texto de los PDF no se puede seleccionar con el dedo para subrayarlo; se subraya con el subrayador (mantén el lápiz quieto para que quede recto).
- Al exportar a PDF, el texto escrito con teclado sale en Helvetica sin negritas ni colores parciales, y los caracteres raros (flechas, emojis) salen como `?`.
- Probado en Chrome de escritorio simulando lápiz y dedos. **Falta probarlo en tu tablet real.**

## 6. Para quien mantenga el código

- Todo está en `app/`: HTML, CSS y JavaScript sin compilar. Sin `npm` ni dependencias locales.
- Librerías por CDN con versión fija (`app/js/libs.js`): pdf.js 4.10.38, pdf-lib 1.17.1, JSZip 3.10.1, Tesseract.js 5.1.1, Mammoth 1.8.0; SDK de Anthropic 0.133.0 (`app/js/ai.js`, desactivado). Google Identity Services para el permiso de Drive.
- Archivos principales: `store.js` (datos), `db.js` (IndexedDB), `editor.js` (lienzo, gestos, deshacer), `tools.js` (herramientas), `ink.js` (trazos con presión), `pageview.js` y `render.js` (dibujo), `library.js` (biblioteca), `editorui.js` (barras y paneles), `search.js`, `importer.js`, `exporter.js`, `backup.js`, `ocr.js`, `audio.js`, `ai.js`, `drive.js` (permiso y llamadas a Drive), `sync.js` (sincronización), `syncui.js`, `config.js` (ID de cliente de Google).
- Publicar: `PUBLICAR.bat` hace `commit`, `push` a `main` y publica `app/` en la rama `gh-pages` (`git subtree`). Los archivos personales (`AGENTS.md`, `ESTADO.md`, `CLAUDE.md`) no se suben (`.gitignore`).
- Coordenadas: 1 unidad = 1 px a 96 ppp (A4 = 794 × 1123). Los PDF se exportan a 0,75 puntos por unidad.
- `sw.js` permite usarla sin conexión (solo con `https` o en `localhost`). Si cambias archivos, sube la versión `VERSION` de `sw.js`.
