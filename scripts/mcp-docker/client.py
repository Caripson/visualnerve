"""Independent Linux MCP/REST client using only the Python standard library."""

import argparse
import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, Request, build_opener

parser = argparse.ArgumentParser()
parser.add_argument('--health', action='store_true')
parser.add_argument('--path')
parser.add_argument('--http-method', choices=['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])
parser.add_argument('--origin')
parser.add_argument('--timeout', type=float, default=40)
parser.add_argument('--protocol-version', default='2025-06-18')
authorization = parser.add_mutually_exclusive_group()
authorization.add_argument('--token')
authorization.add_argument('--no-token', action='store_true')
args = parser.parse_args()
path = '/api/v1/health' if args.health else args.path or '/mcp'
parsed = urlsplit(path)
if parsed.scheme or parsed.netloc or parsed.fragment or not (
        parsed.path == '/mcp' or parsed.path.startswith('/api/v1/')):
    parser.error('Only /mcp or /api/v1/ paths on the fixture loopback bridge are allowed')
method = args.http_method or ('GET' if args.health or args.path else 'POST')
payload = None
if method not in ['GET', 'DELETE']:
    raw = sys.stdin.buffer.read(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024:
        parser.error('Fixture request exceeds two MiB')
    payload = json.loads(raw) if raw.strip() else {}
    if path == '/mcp':
        payload.setdefault('jsonrpc', '2.0')
        if not str(payload.get('method', '')).startswith('notifications/'):
            payload.setdefault('id', 1)
headers = {'Accept': 'application/json, text/event-stream'}
if path == '/mcp':
    headers['MCP-Protocol-Version'] = args.protocol_version
if payload is not None:
    headers['Content-Type'] = 'application/json'
if not args.no_token and parsed.path != '/api/v1/health':
    token = args.token if args.token is not None else os.environ.get(
        'VN_MCP_TEST_TOKEN', 'docker-chrome-fixture-token-47417')
    headers['Authorization'] = 'Bearer ' + token
if args.origin:
    headers['Origin'] = args.origin
request = Request('http://127.0.0.1:47417' + path,
                  data=json.dumps(payload).encode() if payload is not None else None,
                  headers=headers, method=method)


def envelope(response):
    raw = response.read(8 * 1024 * 1024 + 1)
    if len(raw) > 8 * 1024 * 1024:
        raise ValueError('Fixture response exceeds eight MiB')
    body = raw.decode('utf-8')
    try:
        body = json.loads(body) if body else None
    except json.JSONDecodeError:
        pass
    return {'status': response.code, 'body': body}


try:
    with build_opener(ProxyHandler({})).open(request, timeout=args.timeout) as response:
        result = envelope(response)
except HTTPError as error:
    result = envelope(error)
except (URLError, OSError, TimeoutError) as error:
    result = {'status': 0, 'error': {'kind': type(error).__name__, 'message': str(error)}}
print(json.dumps(result))
