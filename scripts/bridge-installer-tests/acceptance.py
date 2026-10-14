"""Exercise the generated installer, native Linux bridge and failure boundaries.

Docker receives a public source bundle and synthetic TLS fixture material only.
The test never mounts a browser profile, repository checkout, home or credentials.
"""

import contextlib
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
import zipfile


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "tmp/verification/bridge-installer-linux"
FIXTURE_ORIGIN = "https://downloads.visualnerve.test:8443"
APP_ORIGIN = "https://app.visualnerve.com"
INSTALL_DIR = "/home/installer-test/Bridge with spaces"
SOURCE_SCRIPT = "/tmp/visual-nerve-bridge-setup.sh"
KEEP = os.environ.get("VN_INSTALL_TEST_KEEP") == "1" or "--keep" in sys.argv[1:]
CA_FILE = "/tmp/installer-test-ca.pem"
WGET_CONFIG = "/tmp/installer-test-wgetrc"
ENVIRONMENT = [
    "--env", f"SSL_CERT_FILE={CA_FILE}",
    "--env", f"CURL_CA_BUNDLE={CA_FILE}",
    "--env", f"WGETRC={WGET_CONFIG}",
]
RESULT = {"startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
          "passed": False, "checks": [], "containersRemoved": False,
          "limitations": ["Linux amd64 in Docker; not native Windows/WSL or macOS.",
                          "Private test CA validates synthetic download hosting; Go uses its real HTTPS source and pinned checksum.",
                          "No existing user installation is touched. Only keep mode publishes host loopback47417 to an initially absent test relay on container47418."]}
CONTAINERS = []
NETWORK = f"vn-installer-test-{uuid.uuid4().hex[:10]}"
NETWORK_CREATED = False
PHASE = "initialize"
FIXTURE_DIRECTORY = None
KEPT_CONTAINER = None


def run(args, *, check=True, timeout=300, input=None):
    value = subprocess.run(args, cwd=ROOT, input=input, capture_output=True,
                           text=True, timeout=timeout)
    with (OUTPUT / "commands.log").open("a") as log:
        # This harness supplies no production credentials to subprocesses.
        log.write(f"\n$ {' '.join(map(str, args))}\n{value.stdout}{value.stderr}\n")
    if check and value.returncode:
        raise RuntimeError(f"Command failed ({value.returncode}): {args[0:3]}; see commands.log")
    return value


def execute(container, args, *, check=True, timeout=300, input=None, extra_env=None):
    return run(["docker", "exec", "-i", *ENVIRONMENT, *(extra_env or []),
                container, *args], check=check, timeout=timeout, input=input)


def shell(container, script, **kwargs):
    return execute(container, ["bash", "-c", script], **kwargs)


def check(description):
    RESULT["checks"].append(description)
    print(f"PASS {description}", flush=True)


def start_container(image, fixture, *, name=None, command=None, alias=None, publish=False):
    name = name or f"{NETWORK}-{len(CONTAINERS)}"
    args = ["docker", "run", "--detach", "--init", "--network", NETWORK,
            "--security-opt", "no-new-privileges", "--memory", "1536m",
            "--name", name, "--mount", f"type=bind,source={fixture},target=/fixtures,readonly"]
    if publish:
        args += ["--publish", "127.0.0.1:47417:47418"]
    if alias:
        args += ["--network-alias", alias]
    args += [image, *(command or [])]
    run(args)
    CONTAINERS.append(name)
    return name


def trust(container):
    # The installer deliberately ignores per-user wget configuration. Add only
    # this ephemeral fixture CA to the disposable container's system trust.
    run(["docker", "exec", "--user", "0", container, "bash", "-c",
         "cp /fixtures/server.crt /usr/local/share/ca-certificates/visual-nerve-fixture.crt && update-ca-certificates"])
    shell(container, f"cat /etc/ssl/certs/ca-certificates.crt /fixtures/server.crt > '{CA_FILE}'; "
                     f"printf 'ca_certificate = {CA_FILE}\\n' > '{WGET_CONFIG}'")


def installer(container, *args, script=SOURCE_SCRIPT, check=True, timeout=600, extra_env=None):
    return execute(container, ["bash", script, "--install-dir", INSTALL_DIR, *args],
                   check=check, timeout=timeout, extra_env=extra_env)


def state(container):
    return json.loads(execute(container, ["cat", f"{INSTALL_DIR}/state.json"]).stdout)


def health(container, port=47417):
    return json.loads(execute(container, ["wget", "--quiet", "--output-document=-",
                      f"http://127.0.0.1:{port}/api/v1/health"]).stdout)


def alive(container, pid):
    assert isinstance(pid, int) and pid > 1
    return execute(container, ["busybox", "kill", "-0", str(pid)], check=False).returncode == 0


def foreign_listener(container, port):
    output = shell(container,
                   f"busybox httpd -f -p 127.0.0.1:{port} -h /tmp > /tmp/foreign-{port}.log 2>&1 "
                   f"& echo $!")
    pid = int(output.stdout.strip())
    for _ in range(30):
        if shell(container, f"(echo > /dev/tcp/127.0.0.1/{port}) 2>/dev/null", check=False).returncode == 0:
            assert alive(container, pid)
            return pid
        time.sleep(0.1)
    raise RuntimeError("Synthetic foreign listener did not bind")


def make_variant(fixture, script, manifest, name, archive_bytes=None, expected_hash=None):
    source = manifest["source"]
    digest = expected_hash or hashlib.sha256(archive_bytes).hexdigest()
    url = source["url"]
    if archive_bytes is not None:
        filename = f"fixture-{name}-{digest}.zip"
        (fixture / "public/downloads" / filename).write_bytes(archive_bytes)
        url = f"{FIXTURE_ORIGIN}/downloads/{filename}"
    value = script.replace(source["url"], url).replace(source["sha256"], digest)
    target = fixture / "public/downloads" / f"fixture-{name}.sh"
    target.write_text(value)
    return f"/fixtures/public/downloads/{target.name}"


@contextlib.contextmanager
def fixture_directory():
    global FIXTURE_DIRECTORY
    FIXTURE_DIRECTORY = tempfile.mkdtemp(prefix="vn-installer-fixtures-")
    try:
        yield FIXTURE_DIRECTORY
    finally:
        if not (KEEP and RESULT["passed"]):
            shutil.rmtree(FIXTURE_DIRECTORY, ignore_errors=True)


def main():
    global NETWORK_CREATED, PHASE, KEPT_CONTAINER
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "commands.log").write_text("")
    RESULT["revision"] = run(["git", "rev-parse", "HEAD"]).stdout.strip()
    RESULT["docker"] = run(["docker", "version", "--format", "{{.Server.Version}}"]).stdout.strip()
    context = ROOT / "scripts/bridge-installer-tests"
    PHASE = "build disposable test images"
    for target in ["wget", "bootstrap", "fixtures"]:
        run(["docker", "build", "--target", target, "--tag",
             f"visual-nerve-installer-test:{target}", str(context)], timeout=600)
    with fixture_directory() as temporary:
        fixture = Path(temporary)
        # The fixture container must traverse the synthetic public directory.
        fixture.chmod(0o755)
        (fixture / "public").mkdir()
        PHASE = "package exact local installer and synthetic HTTPS fixture"
        run(["node", "--input-type=module", "-e",
             "import { packageBridgeInstaller } from './scripts/package-bridge-installer.mjs'; "
             "await packageBridgeInstaller({root:process.cwd(),outputDirectory:process.argv[1],siteUrl:process.argv[2]});",
             str(fixture / "public"), FIXTURE_ORIGIN], timeout=60)
        manifest = json.loads((fixture / "public/downloads/bridge-release.json").read_text())
        script = (fixture / "public/downloads/visual-nerve-bridge-setup.sh").read_text()
        RESULT["sourceSha256"] = manifest["source"]["sha256"]
        RESULT["installerSha256"] = manifest["installer"]["sha256"]
        RESULT["sourceDirty"] = manifest["sourceDirty"]
        RESULT["bridgeVersion"] = manifest["bridgeVersion"]
        RESULT["goVersion"] = manifest["goVersion"]
        run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
             "-subj", "/CN=downloads.visualnerve.test", "-addext", "subjectAltName=DNS:downloads.visualnerve.test",
             "-keyout", str(fixture / "server.key"), "-out", str(fixture / "server.crt")])
        (fixture / "server.key").chmod(0o644)
        run(["docker", "network", "create", NETWORK])
        NETWORK_CREATED = True
        start_container("visual-nerve-installer-test:fixtures", fixture,
                        alias="downloads.visualnerve.test")
        container = start_container("visual-nerve-installer-test:wget", fixture, publish=KEEP)
        KEPT_CONTAINER = container
        trust(container)
        PHASE = "fresh non-root Linux install with wget only"
        shell(container, "command -v wget; for name in go curl unzip python3; do "
                         "if command -v \"$name\"; then exit 1; fi; done; test \"$(id -u)\" = 10001")
        execute(container, ["wget", "--https-only", "--quiet", "--output-document", SOURCE_SCRIPT,
                            manifest["installer"]["url"]])
        downloaded_hash = execute(container, ["sha256sum", SOURCE_SCRIPT]).stdout.split()[0]
        assert downloaded_hash == manifest["installer"]["sha256"]
        check("Actual HTTPS bootstrap download matches the reviewed installer SHA256 before execution")
        hostile_cache = "/tmp/untrusted-cache-helper"
        shell(container, f"printf '#!/bin/sh\\nprintf invoked > /tmp/untrusted-cache-invoked\\nexit 1\\n' > '{hostile_cache}'; chmod 700 '{hostile_cache}'")
        first = installer(container, "--origin", APP_ORIGIN, "--addr", "127.0.0.1:47417",
                          extra_env=["--env", f"GOCACHEPROG={hostile_cache}",
                                     "--env", "GOTOOLCHAIN=go1.99.99+auto",
                                     "--env", "GOROOT=/tmp/untrusted-go-root"])
        assert "unzip is absent" in first.stdout
        initial = state(container)
        assert initial["origin"] == APP_ORIGIN and initial["address"] == "127.0.0.1:47417"
        value = health(container)
        assert value["bridge"] is True and value["version"] == manifest["bridgeVersion"]
        assert set(value["tools"]) == {"visual_nerve_api_docs", "visual_nerve_request"}
        shell(container, "! command -v go; ! command -v curl; ! command -v unzip; "
                         "test ! -e ~/.bash_profile; test ! -e ~/.zshrc")
        check("Fresh non-root Linux without Go/curl/unzip installs private pinned Go, builds source and starts real bridge; paths with spaces work")
        shell(container, "test ! -e /tmp/untrusted-cache-invoked")
        check("Hostile inherited Go cache helper, toolchain and GOROOT cannot override the managed bootstrap")

        PHASE = "repeat install and offline management"
        installer(container, "--origin", APP_ORIGIN, "--addr", "127.0.0.1:47417")
        assert state(container)["pid"] == initial["pid"]
        installer(container, "--status")
        check("Repeat install reuses the healthy owned process; local status succeeds")

        PHASE = "owned configuration change restarts only the managed process"
        installer(container, "--origin", "https://fixture-workspace.example", "--addr", "127.0.0.1:47417")
        changed = state(container)
        assert changed["pid"] != initial["pid"] and changed["origin"] == "https://fixture-workspace.example"
        assert health(container)["bridge"] is True
        installer(container, "--origin", APP_ORIGIN, "--addr", "127.0.0.1:47417")
        initial = state(container)
        assert initial["pid"] != changed["pid"] and initial["origin"] == APP_ORIGIN
        check("Changing the exact origin safely restarts only the verified owned bridge and restores the requested configuration")

        PHASE = "unsafe listener/origin arguments are rejected"
        for invalid in [("--addr", "0.0.0.0:47417"), ("--origin", "https://app.visualnerve.com/app/")]:
            rejected = installer(container, *invalid, check=False)
            assert rejected.returncode != 0
            assert state(container)["pid"] == initial["pid"]
        check("Non-loopback listener and non-origin URL are rejected without replacing the managed listener")

        PHASE = "bad source checksum preserves working installation"
        bad = make_variant(fixture, script, manifest, "wrong-hash", expected_hash="0" * 64)
        failed = installer(container, script=bad, check=False)
        assert failed.returncode != 0
        assert state(container)["pid"] == initial["pid"] and alive(container, initial["pid"])
        assert health(container)["bridge"] is True
        check("Wrong source SHA256 is rejected without stopping the existing bridge")

        PHASE = "unsafe archive is rejected before execution"
        unsafe_path = fixture / "unsafe.zip"
        with zipfile.ZipFile(unsafe_path, "w") as archive:
            archive.writestr("visual-nerve-bridge/../../escaped", "must never escape")
        unsafe = make_variant(fixture, script, manifest, "unsafe-zip", unsafe_path.read_bytes())
        failed = installer(container, script=unsafe, check=False)
        assert failed.returncode != 0
        assert state(container)["pid"] == initial["pid"] and alive(container, initial["pid"])
        shell(container, "test ! -e /home/installer-test/escaped; test ! -e /tmp/escaped")
        check("Hash-valid traversal ZIP is rejected before build and cannot replace the live release")

        PHASE = "foreign primary port is never stopped or adopted"
        installer(container, "--stop")
        pid = foreign_listener(container, 47417)
        failed = installer(container, "--origin", APP_ORIGIN, "--addr", "127.0.0.1:47417", check=False)
        assert failed.returncode != 0 and alive(container, pid)
        execute(container, ["busybox", "kill", str(pid)])
        check("Busy primary port fails clearly and preserves the unrelated listener")

        PHASE = "foreign legacy port does not interfere"
        pid = foreign_listener(container, 4317)
        installer(container, "--origin", APP_ORIGIN, "--addr", "127.0.0.1:47417")
        assert health(container)["bridge"] is True and alive(container, pid)
        execute(container, ["busybox", "kill", str(pid)])
        check("Explicit dedicated listener works with an unrelated service on legacy4317")

        PHASE = "untrusted saved PID cannot terminate an unrelated process"
        legitimate = state(container)
        pid = foreign_listener(container, 47419)
        tampered = {**legitimate, "pid": pid}
        execute(container, ["bash", "-c", 'cat > "$1"', "bash", f"{INSTALL_DIR}/state.json"],
                input=json.dumps(tampered))
        failed = installer(container, "--stop", check=False)
        assert failed.returncode != 0 and alive(container, pid) and alive(container, legitimate["pid"])
        execute(container, ["bash", "-c", 'cat > "$1"', "bash", f"{INSTALL_DIR}/state.json"],
                input=json.dumps(legitimate))
        execute(container, ["busybox", "kill", str(pid)])
        installer(container, "--stop")
        check("Tampered PID state cannot stop a foreign process; genuine owned stop remains available")

        PHASE = "explicit prerequisite bootstrap in downloader-free Linux"
        bootstrap = start_container("visual-nerve-installer-test:bootstrap", fixture)
        trust(bootstrap)
        shell(bootstrap, "for name in go curl wget unzip python3; do if command -v \"$name\"; then exit 1; fi; done")
        # With no downloader at all, obtain the reviewed setup file out of band.
        # This tests the explicit bootstrap branch, not an impossible network fetch.
        execute(bootstrap, ["cp", "/fixtures/public/downloads/visual-nerve-bridge-setup.sh", SOURCE_SCRIPT])
        unavailable = installer(bootstrap, "--install-only", check=False)
        assert unavailable.returncode != 0 and "--install-system-deps" in unavailable.stderr
        shell(bootstrap, "! command -v curl")
        installer(bootstrap, "--install-system-deps", "--install-only", timeout=900)
        shell(bootstrap, "command -v curl; ! command -v go; ! command -v unzip")
        check("Missing all downloaders fails without consent; explicit package-manager flag installs curl/CA and builds without starting a bridge")
        installer(container, "--origin", APP_ORIGIN, "--addr", "127.0.0.1:47417")
        RESULT["freshInstallation"] = state(container)
        RESULT["passed"] = True


try:
    main()
except BaseException as error:
    RESULT["failurePhase"] = PHASE
    RESULT["failure"] = f"{type(error).__name__}: {error}"
    print(f"FAIL {PHASE}: {error}", file=sys.stderr)
finally:
    retaining = KEEP and RESULT["passed"]
    if retaining:
        RESULT["retained"] = {"container": KEPT_CONTAINER, "containers": CONTAINERS,
                              "network": NETWORK, "fixtureDirectory": FIXTURE_DIRECTORY,
                              "installDir": INSTALL_DIR, "bridgePort": 47417,
                              "publishedTestRelay": "127.0.0.1:47417 -> container:47418",
                              "relayRunning": False,
                              "purpose": "Freshly source-built bridge for a subsequent real browser/MCP test"}
    for container in reversed(CONTAINERS) if not retaining else []:
        run(["docker", "rm", "--force", container], check=False, timeout=60)
    if NETWORK_CREATED and not retaining:
        run(["docker", "network", "rm", NETWORK], check=False, timeout=60)
    RESULT["containersRemoved"] = not retaining and all(
        run(["docker", "inspect", container], check=False).returncode != 0
        for container in CONTAINERS
    )
    RESULT["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "result.json").write_text(json.dumps(RESULT, indent=2) + "\n")
    print(json.dumps({"passed": RESULT["passed"], "checks": len(RESULT["checks"]),
                      "containersRemoved": RESULT["containersRemoved"],
                      "result": str(OUTPUT / "result.json")}))
    sys.exit(0 if RESULT["passed"] and (RESULT["containersRemoved"] or retaining) else 1)
