# Hotfix favicon v23

Copia el contenido de este ZIP sobre la raíz del repositorio.

Archivos incluidos:

- public/favicon.ico
- public/images/favicon-16x16.png
- public/images/favicon-32x32.png
- public/images/apple-touch-icon.png
- public/images/android-chrome-192x192.png
- public/images/android-chrome-512x512.png
- public/site.webmanifest
- public/FAVICON_HEAD_SNIPPET.html

El archivo importante para eliminar el warning de Render es:

public/favicon.ico

Con Express sirviendo la carpeta public, la ruta:

/favicon.ico

dejará de devolver 404.

Opcionalmente añade el contenido de public/FAVICON_HEAD_SNIPPET.html dentro del <head> de public/index.html.
