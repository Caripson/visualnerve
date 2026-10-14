"""Control only the disposable fixture bridge over its private Unix socket."""

import json
import socket
import sys

action = sys.argv[1] if len(sys.argv) == 2 else 'status'
if action not in ['start', 'stop', 'status']:
    raise SystemExit('Usage: control.py start|stop|status')
with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
    connection.settimeout(15)
    connection.connect('/tmp/visual-nerve-mcp-control.sock')
    connection.sendall(action.encode() + b'\n')
    with connection.makefile('rb') as response:
        result = json.loads(response.readline(65536))
print(json.dumps(result))
if 'error' in result:
    raise SystemExit(1)
