"""Read-only HTTPS static fixture. Contains no application API or persistence."""
import argparse
import http.server
import ssl

parser = argparse.ArgumentParser()
parser.add_argument("--directory", required=True)
parser.add_argument("--cert", required=True)
parser.add_argument("--key", required=True)
args = parser.parse_args()


class StaticFiles(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *values, **options):
        super().__init__(*values, directory=args.directory, **options)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def reject_write(self):
        self.send_error(405, "Static application files only")

    do_POST = reject_write
    do_PUT = reject_write
    do_PATCH = reject_write
    do_DELETE = reject_write

    def log_message(self, *values):
        pass


server = http.server.ThreadingHTTPServer(("127.0.0.1", 4340), StaticFiles)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(args.cert, args.key)
server.socket = context.wrap_socket(server.socket, server_side=True)
server.serve_forever()
