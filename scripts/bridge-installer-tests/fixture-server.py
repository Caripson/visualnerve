"""Serve only synthetic public installer fixtures over real, locally trusted TLS."""

import functools
import http.server
import ssl


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        # Paths contain only public synthetic artifacts, but avoid noisy request logs.
        pass


server = http.server.ThreadingHTTPServer(
    ("0.0.0.0", 8443), functools.partial(Handler, directory="/fixtures/public")
)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.minimum_version = ssl.TLSVersion.TLSv1_2
context.load_cert_chain("/fixtures/server.crt", "/fixtures/server.key")
server.socket = context.wrap_socket(server.socket, server_side=True)
print("Synthetic installer HTTPS fixtures are ready.", flush=True)
server.serve_forever()
