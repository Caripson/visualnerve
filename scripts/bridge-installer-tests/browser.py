"""Run real Chrome against the bridge built by the fresh Linux installer test.

Only the disposable relay is compiled here. The bridge executable, generated
documentation, managed lifecycle and Go installation come from acceptance.py.
"""

import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request


ROOT = Path(__file__).resolve().parents[2]
INSTALLATION_RESULT = ROOT / "tmp/verification/bridge-installer-linux/result.json"
OUTPUT = ROOT / "tmp/verification/bridge-installer-chrome"
SOURCE_SCRIPT = "/tmp/visual-nerve-bridge-setup.sh"
RELAY_SOURCE = "/tmp/visual-nerve-installer-test-relay.go"
RELAY_BINARY = "/tmp/visual-nerve-installer-test-relay"
TLS_ENV = ["--env", "SSL_CERT_FILE=/tmp/installer-test-ca.pem",
           "--env", "CURL_CA_BUNDLE=/tmp/installer-test-ca.pem",
           "--env", "WGETRC=/tmp/installer-test-wgetrc"]


def run(args, *, cwd=ROOT, timeout=120, input=None, check=True, env=None):
    # Give each child its own group so cancellation cannot leave test browsers
    # or npm's child processes behind. SIGINT lets the Linux harness clean up.
    process = subprocess.Popen(args, cwd=cwd, stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, env=env, start_new_session=True)
    try:
        stdout, stderr = process.communicate(input=input, timeout=timeout)
    except BaseException:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGINT)
        try:
            process.communicate(timeout=20)
        except subprocess.TimeoutExpired:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            process.communicate()
        raise
    with (OUTPUT / "wrapper.log").open("a") as log:
        log.write(f"\n$ {' '.join(map(str, args))}\n{stdout}{stderr}\n")
    if check and process.returncode:
        raise RuntimeError(f"Command failed ({process.returncode}): {args[:3]}; see wrapper.log")
    return subprocess.CompletedProcess(args, process.returncode, stdout, stderr)


def retained_fixture(installation):
    """Reject arbitrary resource names/paths before any execution or cleanup."""
    if installation.get("passed") is not True or installation.get("containersRemoved") is not False:
        raise ValueError("A successful retained Linux installer result is required")
    retained = installation.get("retained", {})
    network = retained.get("network", "")
    if not re.fullmatch(r"vn-installer-test-[a-f0-9]{10}", network):
        raise ValueError("Unexpected installer test network")
    containers = retained.get("containers", [])
    if (not containers or len(containers) != len(set(containers))
            or retained.get("container") not in containers
            or any(not re.fullmatch(re.escape(network) + r"-\d+", name) for name in containers)):
        raise ValueError("Unexpected installer test container names")
    fixture = Path(retained.get("fixtureDirectory", ""))
    if (not fixture.is_absolute() or not fixture.name.startswith("vn-installer-fixtures-")
            or fixture.is_symlink() or not fixture.is_dir()
            or fixture.parent.resolve() != Path(tempfile.gettempdir()).resolve()):
        raise ValueError("Unexpected installer test fixture directory")
    if retained.get("installDir") != "/home/installer-test/Bridge with spaces":
        raise ValueError("Unexpected installer test install directory")
    if retained.get("bridgePort") != 47417 or retained.get("relayRunning") is not False:
        raise ValueError("Expected an unused test relay and the dedicated bridge port")
    for field in ["sourceSha256", "installerSha256"]:
        if not re.fullmatch(r"[a-f0-9]{64}", installation.get(field, "")):
            raise ValueError(f"Invalid installer evidence: {field}")
    if not re.fullmatch(r"\d+\.\d+\.\d+", installation.get("goVersion", "")):
        raise ValueError("Invalid installer Go version")
    return retained


def inspect_resources(retained):
    network = json.loads(run(["docker", "network", "inspect", retained["network"]]).stdout)[0]
    records = json.loads(run(["docker", "inspect", *retained["containers"]]).stdout)
    ids = {record["Id"] for record in records}
    if set(network.get("Containers", {})) != ids:
        raise ValueError("Installer network does not contain exactly its recorded containers")
    for record in records:
        mounts = [mount for mount in record.get("Mounts", []) if mount["Destination"] == "/fixtures"]
        if (record["Name"].lstrip("/") not in retained["containers"]
                or not record["State"]["Running"] or len(mounts) != 1
                or mounts[0]["Type"] != "bind" or mounts[0]["RW"]
                or Path(mounts[0]["Source"]).resolve() != Path(retained["fixtureDirectory"]).resolve()):
            raise ValueError("Container ownership/mount does not match the retained installer fixture")
        if record["Name"] == "/" + retained["container"]:
            if record["HostConfig"]["PortBindings"] != {
                    "47418/tcp": [{"HostIp": "127.0.0.1", "HostPort": "47417"}]}:
                raise ValueError("Test relay must be published only on host loopback47417")
    return {"containers": [record["Id"] for record in records], "network": network["Id"]}


def execute(container, args, **kwargs):
    return run(["docker", "exec", "-i", *TLS_ENV, container, *args], **kwargs)


def read_state(container, install_dir):
    return json.loads(execute(container, ["cat", f"{install_dir}/state.json"]).stdout)


def prepare_browser(installation, retained, origin):
    container, install_dir = retained["container"], retained["installDir"]
    script_hash = execute(container, ["sha256sum", SOURCE_SCRIPT]).stdout.split()[0]
    if script_hash != installation["installerSha256"]:
        raise ValueError("Retained downloaded setup file differs from the reviewed installer")
    before = read_state(container, install_dir)
    expected_executable = f"{install_dir}/releases/{installation['sourceSha256']}/visual-nerve"
    if before["executable"] != expected_executable or before["sourceSha256"] != installation["sourceSha256"]:
        raise ValueError("Retained executable does not match the fresh source installation")
    binary_hash = execute(container, ["sha256sum", expected_executable]).stdout.split()[0]
    execute(container, ["bash", SOURCE_SCRIPT, "--install-dir", install_dir,
                        "--origin", origin, "--addr", "127.0.0.1:47417"], timeout=180)
    after = read_state(container, install_dir)
    if (after["origin"] != origin or after["address"] != "127.0.0.1:47417"
            or after["executable"] != before["executable"]
            or after["sourceSha256"] != before["sourceSha256"]
            or execute(container, ["sha256sum", expected_executable]).stdout.split()[0] != binary_hash):
        raise ValueError("Configuring the test origin changed the source-built bridge identity")
    private_go = f"{install_dir}/toolchains/go{installation['goVersion']}/bin/go"
    relay = (ROOT / "scripts/bridge-installer-tests/browser-relay.go").read_text()
    execute(container, ["bash", "-c", 'cat > "$1"', "bash", RELAY_SOURCE], input=relay)
    execute(container, ["env", "CGO_ENABLED=0", "GOTOOLCHAIN=local", "GOENV=off",
                        "GOWORK=off", "GO111MODULE=off", private_go, "build",
                        "-trimpath", "-o", RELAY_BINARY, RELAY_SOURCE], timeout=180)
    run(["docker", "exec", "--detach", container, RELAY_BINARY])
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(50):
        try:
            with opener.open("http://127.0.0.1:47417/api/v1/health", timeout=2) as response:
                health = json.load(response)
            if (health.get("status") != "ok" or health.get("bridge") is not True
                    or health.get("version") != installation["bridgeVersion"]):
                raise ValueError("Host relay returned unexpected bridge health")
            return {"bridgeExecutable": expected_executable, "bridgeSha256": binary_hash,
                    "sourceSha256": installation["sourceSha256"], "origin": origin,
                    "privateGo": private_go, "relaySourceSha256": hashlib.sha256(relay.encode()).hexdigest()}
        except (OSError, json.JSONDecodeError):
            time.sleep(0.1)
    raise RuntimeError("Disposable host relay did not become ready")


def cleanup(resources, retained):
    for container_id in reversed(resources["containers"]):
        run(["docker", "rm", "--force", container_id], check=False, timeout=60)
    run(["docker", "network", "rm", resources["network"]], check=False, timeout=60)
    # A failed inspect may mean an unavailable daemon, not a removed resource.
    # Require successful full inventories before deleting the mounted fixture.
    remaining_containers = set(run(["docker", "container", "ls", "--all", "--quiet", "--no-trunc"]).stdout.split())
    remaining_networks = set(run(["docker", "network", "ls", "--quiet", "--no-trunc"]).stdout.split())
    containers_removed = not remaining_containers.intersection(resources["containers"])
    network_removed = resources["network"] not in remaining_networks
    if containers_removed and network_removed:
        shutil.rmtree(retained["fixtureDirectory"])
    return {"containersRemoved": containers_removed, "networkRemoved": network_removed,
            "fixtureRemoved": not Path(retained["fixtureDirectory"]).exists()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--existing", action="store_true",
                        help="Consume the successful retained result instead of reinstalling")
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "wrapper.log").write_text("")
    result = {"passed": False, "existingInstallation": args.existing,
              "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    resources = retained = None
    try:
        for executable in ["docker", "node", "npx"]:
            if shutil.which(executable) is None:
                raise RuntimeError(f"Install {executable} before running the browser harness")
        # Reuse the browser's exact target allowlist and hosted artifact checks.
        origin = run(["node", "scripts/mcp-docker/config.mjs", "--origin"]).stdout.strip()
        if not args.existing:
            run(["bash", "scripts/bridge-installer-tests/run.sh"],
                env={**os.environ, "VN_INSTALL_TEST_KEEP": "1"}, timeout=3600)
        installation = json.loads(INSTALLATION_RESULT.read_text())
        retained = retained_fixture(installation)
        resources = inspect_resources(retained)
        result["installationEvidence"] = str(INSTALLATION_RESULT)
        result["prepared"] = prepare_browser(installation, retained, origin)
        print("Fresh source-built bridge connected through its disposable test relay. Running Chrome.", flush=True)
        run(["npx", "--no-install", "playwright", "test", "--config", "playwright.installer-mcp.config.ts"],
            cwd=ROOT / "frontend", timeout=360)
        browser_result = json.loads((OUTPUT / "result.json").read_text())
        if browser_result.get("status") != "passed":
            raise RuntimeError("Browser test did not write passing evidence")
        result["passed"] = True
    except BaseException as error:
        result["failure"] = f"{type(error).__name__}: {error}"
        print(f"FAIL {result['failure']}", file=sys.stderr)
    finally:
        if resources and retained:
            try:
                result["cleanup"] = cleanup(resources, retained)
                result["passed"] = result["passed"] and all(result["cleanup"].values())
            except BaseException as error:
                result["passed"] = False
                result["cleanupFailure"] = f"{type(error).__name__}: {error}"
        result["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        (OUTPUT / "wrapper-result.json").write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps(result, indent=2))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
