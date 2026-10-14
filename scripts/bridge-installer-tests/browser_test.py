"""Guard the cleanup boundary without contacting Docker or an existing bridge."""

import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location("installer_browser", Path(__file__).with_name("browser.py"))
BROWSER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BROWSER)


class RetainedFixtureTests(unittest.TestCase):
    def setUp(self):
        self.fixture = tempfile.TemporaryDirectory(prefix="vn-installer-fixtures-")
        self.addCleanup(self.fixture.cleanup)
        self.evidence = {
            "passed": True, "containersRemoved": False, "sourceSha256": "a" * 64,
            "installerSha256": "b" * 64, "goVersion": "1.26.9",
            "retained": {
                "network": "vn-installer-test-0123456789",
                "container": "vn-installer-test-0123456789-1",
                "containers": ["vn-installer-test-0123456789-0", "vn-installer-test-0123456789-1"],
                "fixtureDirectory": self.fixture.name,
                "installDir": "/home/installer-test/Bridge with spaces",
                "bridgePort": 47417, "relayRunning": False,
            },
        }

    def test_accepts_exact_retained_fixture(self):
        self.assertEqual(BROWSER.retained_fixture(self.evidence), self.evidence["retained"])

    def test_rejects_unpassed_or_consumed_result(self):
        for field, value in [("passed", False), ("containersRemoved", True), ("installerSha256", "invalid")]:
            with self.subTest(field=field):
                evidence = copy.deepcopy(self.evidence)
                evidence[field] = value
                with self.assertRaises(ValueError):
                    BROWSER.retained_fixture(evidence)

    def test_rejects_unrelated_resource_or_install_path(self):
        variants = [
            ("network", "bridge"), ("container", "production"),
            ("containers", ["vn-installer-test-0123456789-1", "production"]),
            ("containers", ["vn-installer-test-0123456789-1"] * 2),
            ("fixtureDirectory", str(Path.home())), ("installDir", "/usr/local/bin"),
            ("bridgePort", 4317), ("relayRunning", True),
        ]
        for field, value in variants:
            with self.subTest(field=field, value=value):
                evidence = copy.deepcopy(self.evidence)
                evidence["retained"][field] = value
                with self.assertRaises(ValueError):
                    BROWSER.retained_fixture(evidence)

    def test_rejects_symlink_fixture(self):
        with tempfile.TemporaryDirectory() as parent:
            alias = Path(parent) / "vn-installer-fixtures-alias"
            alias.symlink_to(self.fixture.name, target_is_directory=True)
            self.evidence["retained"]["fixtureDirectory"] = str(alias)
            with self.assertRaises(ValueError):
                BROWSER.retained_fixture(self.evidence)


if __name__ == "__main__":
    unittest.main()
