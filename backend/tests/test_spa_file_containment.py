import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.spa import mount_frontend


class SpaFileContainmentTests(unittest.TestCase):
    def test_frontend_files_work_but_encoded_parent_paths_cannot_read_server_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            dist = root / "frontend" / "dist"
            dist.mkdir(parents=True)
            (dist / "index.html").write_text("<h1>synthetic frontend</h1>", "utf-8")
            (dist / "manifest.webmanifest").write_text("{}", "utf-8")
            (root / "outside.txt").write_text("synthetic server-only file", "utf-8")
            app = FastAPI()
            with patch("app.spa.resolve_frontend_dist", return_value=dist.resolve()):
                mount_frontend(app)
            with TestClient(app) as client:
                self.assertEqual(client.get("/manifest.webmanifest").status_code, 200)
                self.assertIn("synthetic frontend", client.get("/tutorials").text)
                for path in ["/%2E%2E%2F%2E%2E%2Foutside.txt", "/%2e%2e/%2e%2e/outside.txt"]:
                    with self.subTest(path=path):
                        result = client.get(path)
                        self.assertEqual(result.status_code, 404)
                        self.assertNotIn("synthetic server-only file", result.text)


if __name__ == "__main__":
    unittest.main()
