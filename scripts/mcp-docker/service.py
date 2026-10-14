"""Isolated test relay and bridge supervisor; never part of the product server."""

import asyncio
import contextlib
import json
import os
from pathlib import Path
import signal

CONTROL_PATH = '/tmp/visual-nerve-mcp-control.sock'
PID_PATH = Path('/tmp/visual-nerve-mcp-bridge.pid')
ORIGIN = os.environ.get('VN_MCP_TEST_ALLOWED_ORIGIN', 'https://mcp-docker.test:4342')
TOKEN = os.environ.get('VN_MCP_TEST_TOKEN', 'docker-chrome-fixture-token-47417')


class Fixture:
    def __init__(self):
        self.process = None
        self.lock = asyncio.Lock()

    def status(self):
        running = self.process is not None and self.process.returncode is None
        return {'running': running, 'pid': self.process.pid if running else None,
                'bridge': 'http://127.0.0.1:47417', 'allowedOrigin': ORIGIN}

    async def command(self, action):
        async with self.lock:
            if action == 'start' and not self.status()['running']:
                environment = dict(os.environ)
                environment['VISUAL_NERVE_BRIDGE_TOKEN'] = TOKEN
                with open('/tmp/visual-nerve-mcp-bridge.log', 'ab', buffering=0) as log:
                    self.process = await asyncio.create_subprocess_exec(
                        '/bridge/visual-nerve', '--bridge', '--addr', '127.0.0.1:47417',
                        '--static', '/public', '--allowed-origin', ORIGIN,
                        stdin=asyncio.subprocess.DEVNULL, stdout=log, stderr=log, env=environment)
                PID_PATH.write_text(str(self.process.pid))
                for _ in range(100):
                    if self.process.returncode is not None:
                        raise RuntimeError('Test bridge exited before accepting connections')
                    try:
                        _, connection = await asyncio.open_connection('127.0.0.1', 47417)
                        connection.close()
                        await connection.wait_closed()
                        break
                    except OSError:
                        await asyncio.sleep(0.05)
                else:
                    await self.stop()
                    raise RuntimeError('Test bridge did not start within five seconds')
            elif action == 'stop':
                await self.stop()
            elif action not in ['start', 'status']:
                raise ValueError('Expected start, stop or status')
            return self.status()

    async def stop(self):
        if self.process is not None and self.process.returncode is None:
            self.process.terminate()
            try:
                await asyncio.wait_for(self.process.wait(), 5)
            except TimeoutError:
                self.process.kill()
                await self.process.wait()
        self.process = None
        PID_PATH.unlink(missing_ok=True)

    async def control(self, reader, writer):
        try:
            action = (await asyncio.wait_for(reader.readline(), 5)).decode().strip()
            result = await self.command(action)
        except Exception as error:
            result = {'error': str(error)}
        writer.write(json.dumps(result).encode() + b'\n')
        with contextlib.suppress(ConnectionError):
            await writer.drain()
        writer.close()
        with contextlib.suppress(ConnectionError):
            await writer.wait_closed()


async def pipe(reader, writer):
    while data := await reader.read(65536):
        writer.write(data)
        await writer.drain()
    if writer.can_write_eof():
        writer.write_eof()


async def forward(reader, writer):
    upstream = None
    tasks = []
    try:
        upstream_reader, upstream = await asyncio.open_connection('127.0.0.1', 47417)
        tasks = [asyncio.create_task(pipe(reader, upstream)),
                 asyncio.create_task(pipe(upstream_reader, writer))]
        await asyncio.gather(*tasks)
    except (OSError, ConnectionError, asyncio.CancelledError):
        pass
    finally:
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        for connection in [writer, upstream]:
            if connection is not None:
                connection.close()
                with contextlib.suppress(ConnectionError):
                    await connection.wait_closed()


async def main():
    fixture = Fixture()
    stopped = asyncio.Event()
    loop = asyncio.get_running_loop()
    for value in [signal.SIGINT, signal.SIGTERM]:
        loop.add_signal_handler(value, stopped.set)
    Path(CONTROL_PATH).unlink(missing_ok=True)
    control = await asyncio.start_unix_server(fixture.control, CONTROL_PATH, limit=1024)
    os.chmod(CONTROL_PATH, 0o600)
    # Only Docker's explicit host-loopback publication exposes this test relay.
    # The unchanged product bridge still binds and authenticates on loopback.
    relay = await asyncio.start_server(forward, '0.0.0.0', 47418)
    print(json.dumps({'fixture': 'ready', **fixture.status()}), flush=True)
    try:
        async with control, relay:
            await stopped.wait()
    finally:
        await fixture.stop()
        Path(CONTROL_PATH).unlink(missing_ok=True)


if __name__ == '__main__':
    asyncio.run(main())
