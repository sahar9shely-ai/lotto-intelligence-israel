"""Synthetic tutorial assets only; no investor data or production voice media."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.tutorials import router
from app.core.config import settings
from app.db.investment_base import InvestmentBase
from app.db.investment_session import get_investment_db
from app.models.auth import User
from app.models.investments import Investor
from app.security.auth import create_access_token
from app.services import tutorial_service as tutorials


class InvestorTutorialTests(unittest.TestCase):
    def setUp(self):
        self.old_settings = (settings.investor_tutorials_enabled, settings.investor_tutorials_media_dir,
                             settings.admin_only_maintenance)
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        settings.investor_tutorials_enabled = True
        settings.investor_tutorials_media_dir = str(self.root)
        settings.admin_only_maintenance = False
        self.make_package()
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        InvestmentBase.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        with self.sessions() as db:
            for name, role, is_manager in [("demo", "investor", False), ("admin", "manager", True),
                                           ("other-manager", "investor", True)]:
                investor = Investor(name=name, is_manager=is_manager)
                db.add(investor)
                db.flush()
                db.add(User(username=name, role=role, investor_id=investor.id,
                            password_hash="synthetic-unused-hash", must_reset_password=False))
            db.commit()
        app = FastAPI()
        app.include_router(router)
        def test_db():
            with self.sessions() as db:
                yield db
        app.dependency_overrides[get_investment_db] = test_db
        self.client = TestClient(app)
        self.investor_headers = self.headers("demo")

    def make_package(self):
        entries = []
        for lesson_id, *_ in tutorials.LESSONS:
            hashes = {}
            for asset, value in {"video": b"synthetic-video", "poster": b"synthetic-poster",
                                 "captions": "WEBVTT\n\n00:00.000 --> 00:01.000\nדוגמה\n".encode(),
                                 "transcript": "תמלול בדיקה סינתטי".encode()}.items():
                path = tutorials.asset_path(self.root, lesson_id, asset)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(value)
                hashes[asset] = hashlib.sha256(value).hexdigest()
            entries.append({"id": lesson_id, "duration_seconds": 20, "sha256": hashes})
        self.manifest = {"schema_version": 1, "scope": "investor_app", "owner_publication_approved": True,
                         "approved_on": "2026-10-02", "voice_provider": "synthetic fixture",
                         "commercial_license_confirmed": False, "lessons": entries}
        self.write_manifest()

    def write_manifest(self):
        (self.root / "manifest.json").write_text(json.dumps(self.manifest), "utf-8")

    def headers(self, name):
        with self.sessions() as db:
            user = db.query(User).filter_by(username=name).one()
            return {"Authorization": "Bearer " + create_access_token(user_id=user.id, role=user.role,
                                                                       investor_id=user.investor_id)}

    def tearDown(self):
        settings.investor_tutorials_enabled, settings.investor_tutorials_media_dir, settings.admin_only_maintenance = self.old_settings
        self.client.close()
        self.engine.dispose()
        tutorials._validated_package.cache_clear()
        self.temp.cleanup()

    def test_disabled_flag_hides_catalogue_and_blocks_media(self):
        settings.investor_tutorials_enabled = False
        self.assertEqual(self.client.get("/api/v1/tutorials", headers=self.investor_headers).json(),
                         {"available": False, "lessons": []})
        self.assertEqual(self.client.get("/api/v1/tutorials/media/01-welcome/video", headers=self.investor_headers).status_code, 404)

    def test_every_asset_and_catalogue_require_authentication(self):
        for path in ["/api/v1/tutorials", "/api/v1/tutorials/media/01-welcome/video",
                     "/api/v1/tutorials/media/01-welcome/poster", "/api/v1/tutorials/media/01-welcome/captions"]:
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 401)

    def test_manager_privileges_do_not_include_investor_guides(self):
        for name in ["admin", "other-manager"]:
            headers = self.headers(name)
            self.assertEqual(self.client.get("/api/v1/tutorials", headers=headers).status_code, 403)
            self.assertEqual(self.client.get("/api/v1/tutorials/media/01-welcome/video", headers=headers).status_code, 403)

    def test_catalogue_has_seven_lessons_and_no_private_package_metadata(self):
        result = self.client.get("/api/v1/tutorials", headers=self.investor_headers)
        self.assertEqual(result.status_code, 200)
        payload = result.json()
        self.assertTrue(payload["available"])
        self.assertEqual(len(payload["lessons"]), 7)
        self.assertEqual(set(payload["lessons"][0]), {"id", "title", "summary", "duration_seconds", "transcript"})
        for term in [str(self.root), "voice_provider", "sha256", "private_review", "commercial_license_confirmed"]:
            self.assertNotIn(term, result.text)

    def test_video_captions_and_poster_bytes_are_private_and_not_cacheable(self):
        for asset, expected_type in [("video", "video/mp4"), ("poster", "image/jpeg"), ("captions", "text/vtt")]:
            result = self.client.get(f"/api/v1/tutorials/media/01-welcome/{asset}", headers=self.investor_headers)
            self.assertEqual(result.status_code, 200)
            self.assertTrue(result.headers["content-type"].startswith(expected_type))
            self.assertEqual(result.headers["cache-control"], "private, no-store")
            self.assertEqual(result.headers["x-content-type-options"], "nosniff")
        self.assertEqual(self.client.get("/api/v1/tutorials/media/01-welcome/transcript", headers=self.investor_headers).status_code, 404)

    def test_incomplete_package_is_not_exposed(self):
        tutorials.asset_path(self.root, "07-closing", "video").unlink()
        self.assertFalse(self.client.get("/api/v1/tutorials", headers=self.investor_headers).json()["available"])
        self.assertEqual(self.client.get("/api/v1/tutorials/media/01-welcome/video", headers=self.investor_headers).status_code, 404)

    def test_package_needs_explicit_owner_approval_even_with_enabled_flag(self):
        for field, value in [("owner_publication_approved", False), ("scope", "personal_private_review_only"), ("approved_on", "")]:
            original = self.manifest[field]
            self.manifest[field] = value
            self.write_manifest()
            self.assertFalse(self.client.get("/api/v1/tutorials", headers=self.investor_headers).json()["available"])
            self.manifest[field] = original

    def test_malformed_manifest_hides_media_instead_of_server_error(self):
        (self.root / "manifest.json").write_text("[]", "utf-8")
        self.assertFalse(self.client.get("/api/v1/tutorials", headers=self.investor_headers).json()["available"])

    def test_license_metadata_is_accurate_information_not_fabricated_access_permission(self):
        self.assertFalse(self.manifest["commercial_license_confirmed"])
        self.assertTrue(self.client.get("/api/v1/tutorials", headers=self.investor_headers).json()["available"])

    def test_replaced_asset_invalidates_previous_valid_package(self):
        self.assertTrue(self.client.get("/api/v1/tutorials", headers=self.investor_headers).json()["available"])
        tutorials.asset_path(self.root, "03-payments", "video").write_bytes(b"changed-file")
        self.assertFalse(self.client.get("/api/v1/tutorials", headers=self.investor_headers).json()["available"])

    def test_unknown_asset_cannot_read_arbitrary_files(self):
        for path in ["/api/v1/tutorials/media/settings/video", "/api/v1/tutorials/media/01-welcome/manifest.json"]:
            self.assertEqual(self.client.get(path, headers=self.investor_headers).status_code, 404)

    def test_maintenance_also_blocks_existing_investor_media_sessions(self):
        settings.admin_only_maintenance = True
        self.assertEqual(self.client.get("/api/v1/tutorials/media/01-welcome/video", headers=self.investor_headers).status_code, 503)

    def test_deactivating_user_revokes_catalogue_and_media_access(self):
        with self.sessions() as db:
            user = db.query(User).filter_by(username="demo").one()
            user.is_active = False
            db.commit()
        self.assertEqual(self.client.get("/api/v1/tutorials", headers=self.investor_headers).status_code, 401)
        self.assertEqual(self.client.get("/api/v1/tutorials/media/01-welcome/video", headers=self.investor_headers).status_code, 401)

    def test_bundled_owner_approved_package_is_complete_and_served_to_synthetic_investor(self):
        package = Path(__file__).resolve().parents[1] / "tutorial-media"
        if not package.is_dir():
            self.skipTest("No bundled package in this checkout")
        settings.investor_tutorials_media_dir = str(package)
        payload = self.client.get("/api/v1/tutorials", headers=self.investor_headers).json()
        self.assertTrue(payload["available"])
        self.assertEqual(len(payload["lessons"]), 7)
        manifest = json.loads((package / "manifest.json").read_text("utf-8"))
        for row in manifest["lessons"]:
            for asset in ["video", "poster", "captions"]:
                with self.subTest(lesson=row["id"], asset=asset):
                    result = self.client.get(f"/api/v1/tutorials/media/{row['id']}/{asset}", headers=self.investor_headers)
                    self.assertEqual(result.status_code, 200)
                    self.assertEqual(hashlib.sha256(result.content).hexdigest(), row["sha256"][asset])


if __name__ == "__main__":
    unittest.main()
