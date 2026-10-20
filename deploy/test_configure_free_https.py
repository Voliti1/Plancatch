"""Offline checks: no shell, network, real certificate request or server writes."""

import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("free_https", Path(__file__).with_name("configure-free-https.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ConfigurationTests(unittest.TestCase):
    def test_both_hosts_are_separate(self):
        self.assertNotEqual(*(module.target_path(host) for host in sorted(module.DOMAINS)))

    def test_only_explicit_hosts(self):
        for host in ("evil.example", "plancatch.duckdns.org;", "../plancatch.kro.kr", "Plancatch.kro.kr"):
            with self.subTest(host=host), self.assertRaises(ValueError):
                module.configuration(host, tls=True)

    def test_bootstrap_is_http_only(self):
        for host in module.DOMAINS:
            conf = module.configuration(host).decode()
            self.assertIn("listen 80;", conf)
            self.assertIn("/.well-known/acme-challenge/", conf)
            self.assertIn("include /etc/nginx/default.d/plancatch.conf;", conf)
            self.assertNotIn("listen 443", conf)
            self.assertNotIn("return 308", conf)

    def test_tls_exact_domain_and_keep_challenge(self):
        for host in module.DOMAINS:
            conf = module.configuration(host, tls=True).decode()
            self.assertIn(f"https://{host}$request_uri", conf)
            self.assertIn(f"/live/{host}/privkey.pem", conf)
            self.assertIn("ssl_protocols TLSv1.2 TLSv1.3;", conf)
            self.assertIn("/.well-known/acme-challenge/", conf)
            self.assertEqual(conf.count("include /etc/nginx/default.d/plancatch.conf;"), 1)
            for other in module.DOMAINS - {host}:
                self.assertNotIn(other, conf)

    def test_atomic_write_and_digest(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "test.conf"
            self.assertIsNone(module.digest(path))
            module.atomic_write(path, b"initial\n")
            original = module.digest(path)
            module.atomic_write(path, b"updated\n")
            self.assertNotEqual(module.digest(path), original)
            self.assertEqual(path.read_bytes(), b"updated\n")
            self.assertEqual(list(Path(folder).iterdir()), [path])

    def test_bad_dns_fails_before_mutation(self):
        with patch.object(module.socket, "getaddrinfo", return_value=[(2, 1, 6, "", ("192.0.2.1", 80))]), patch.object(module, "atomic_write") as write:
            with self.assertRaisesRegex(AssertionError, "Unexpected DNS"):
                module.apply("plancatch.duckdns.org", "a" * 40)
            write.assert_not_called()

    def test_no_production_retry_loop(self):
        source = Path(module.__file__).read_text()
        self.assertEqual(source.count("run(*issue)"), 1)


if __name__ == "__main__":
    unittest.main()
