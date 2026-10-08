"""Read-only HTTPS static fixture. Contains no application API or persistence."""
import argparse
import http.server
import json
from pathlib import Path
import ssl

parser = argparse.ArgumentParser()
parser.add_argument("--directory", required=True)
parser.add_argument("--cert", required=True)
parser.add_argument("--key", required=True)
parser.add_argument("--port", type=int, default=4340)
parser.add_argument("--app-headers", action="store_true", help="serve the audited isolated app response-header policy")
args = parser.parse_args()

headers = {"Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff"}
if args.app_headers:
    manifest = json.loads((Path(args.directory) / "app-surface.json").read_text())
    policy = manifest.get("responseHeaders")
    allowed = {
        "Content-Security-Policy", "Strict-Transport-Security", "X-Content-Type-Options",
        "X-Frame-Options", "Referrer-Policy", "Permissions-Policy",
        "Cross-Origin-Opener-Policy", "Cross-Origin-Resource-Policy", "X-Robots-Tag",
    }
    if not isinstance(policy, dict) or set(policy) != allowed or any(
        not isinstance(value, str) or "\r" in value or "\n" in value
        for value in policy.values()
    ):
        parser.error("the isolated fixture requires the complete generated app response-header policy")
    headers.update(policy)


class StaticFiles(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *values, **options):
        super().__init__(*values, directory=args.directory, **options)

    def end_headers(self):
        for name, value in headers.items():
            self.send_header(name, value)
        super().end_headers()

    def reject_write(self):
        self.send_error(405, "Static application files only")

    do_POST = reject_write
    do_PUT = reject_write
    do_PATCH = reject_write
    do_DELETE = reject_write

    def log_message(self, *values):
        pass

    def copyfile(self, source, outputfile):
        try:
            super().copyfile(source, outputfile)
        except (BrokenPipeError, ConnectionResetError):
            # Closing a test tab deliberately cancels unfinished asset requests.
            pass


server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), StaticFiles)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(args.cert, args.key)
server.socket = context.wrap_socket(server.socket, server_side=True)
server.serve_forever()
