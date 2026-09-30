"""Isolated maintenance checks: in-memory data, no production credentials."""
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.auth import router
from app.core.config import settings
from app.db.investment_base import InvestmentBase
from app.db.investment_session import get_investment_db
from app.models.auth import User
from app.models.investments import Investor
from app.security.auth import hash_password


class MaintenanceAccessTests(unittest.TestCase):
    def setUp(self):
        self.previous_mode = settings.admin_only_maintenance
        self.previous_admin = settings.maintenance_admin_username
        settings.admin_only_maintenance = False
        settings.maintenance_admin_username = "admin"
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        InvestmentBase.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        with self.sessions() as db:
            for username, role in [("admin", "manager"), ("investor", "investor"), ("other-manager", "manager")]:
                investor = Investor(name=username, is_manager=role == "manager")
                db.add(investor)
                db.flush()
                db.add(User(username=username, role=role, investor_id=investor.id,
                            password_hash=hash_password("SyntheticPass123!"), must_reset_password=False))
            db.commit()
        app = FastAPI()
        app.include_router(router)

        def test_db():
            with self.sessions() as db:
                yield db

        app.dependency_overrides[get_investment_db] = test_db
        self.client = TestClient(app)

    def tearDown(self):
        settings.admin_only_maintenance = self.previous_mode
        settings.maintenance_admin_username = self.previous_admin
        self.client.close()
        self.engine.dispose()

    def login(self, username):
        return self.client.post("/api/v1/auth/login", json={
            "username": username, "password": "SyntheticPass123!"
        })

    def test_blocks_existing_sessions_and_new_logins_except_designated_admin(self):
        tokens = {}
        for username in ["admin", "investor", "other-manager"]:
            response = self.login(username)
            self.assertEqual(response.status_code, 200, response.text)
            tokens[username] = response.json()["access_token"]
        settings.admin_only_maintenance = True
        for username, expected in [("admin", 200), ("investor", 503), ("other-manager", 503)]:
            with self.subTest(username=username):
                self.assertEqual(self.login(username).status_code, expected)
                response = self.client.get("/api/v1/auth/me", headers={
                    "Authorization": f"Bearer {tokens[username]}"
                })
                self.assertEqual(response.status_code, expected, response.text)
        settings.admin_only_maintenance = False
        self.assertEqual(self.login("investor").status_code, 200)
        self.assertEqual(self.client.get("/api/v1/auth/me", headers={
            "Authorization": f"Bearer {tokens['investor']}"
        }).status_code, 200)

    def test_username_alone_does_not_allow_non_manager(self):
        settings.maintenance_admin_username = "investor"
        settings.admin_only_maintenance = True
        self.assertEqual(self.login("investor").status_code, 503)


if __name__ == "__main__":
    unittest.main()
