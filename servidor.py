"""Servidor local de Trazo. Solo sirve los archivos de la carpeta app/.

Uso:
    python servidor.py            -> solo este ordenador (http://localhost:8765)
    python servidor.py --red      -> también la tablet en la misma wifi
"""
import http.server
import os
import socket
import socketserver
import sys
import webbrowser

PUERTO = 8765
CARPETA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "app")

# Windows a veces tiene mal registrados estos tipos y el navegador rechaza los módulos.
TIPOS = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".html": "text/html",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
}


class Manejador(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, **TIPOS}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=CARPETA, **kwargs)

    def end_headers(self):
        # Durante el desarrollo no queremos versiones viejas en caché.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, formato, *args):
        pass


class Servidor(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def ip_local():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "IP-DE-ESTE-ORDENADOR"


def main():
    en_red = "--red" in sys.argv
    sin_navegador = "--sin-navegador" in sys.argv
    host = "0.0.0.0" if en_red else "127.0.0.1"
    with Servidor((host, PUERTO), Manejador) as srv:
        print(f"Trazo funcionando en http://localhost:{PUERTO}")
        if en_red:
            print(f"Desde la tablet (misma wifi): http://{ip_local()}:{PUERTO}")
        print("Para pararlo, cierra esta ventana o pulsa Ctrl+C.")
        if not sin_navegador:
            webbrowser.open(f"http://localhost:{PUERTO}")
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
