"""Own-account signing shares financial execution with personal token links."""
import unittest
from datetime import timedelta
from unittest.mock import patch
from sqlalchemy import MetaData, UniqueConstraint

from app.core.config import settings
from app.models.investments import Investor, InvestmentPlan, WalletEntry, utcnow
from app.models.auth import User
from app.security.auth import create_access_token, get_current_user, hash_password
from app.services import agreement_service as agreements, wallet_service as wallet
import test_agreements as agreement_test_helpers

PNG = agreement_test_helpers.PNG


class AuthenticatedAgreementSigningTests(unittest.TestCase):
    notice = agreement_test_helpers.AgreementTests.notice
    close_offer = agreement_test_helpers.AgreementTests.close_offer

    def setUp(self):
        agreement_test_helpers.AgreementTests.setUp(self)

    def tearDown(self):
        agreement_test_helpers.AgreementTests.tearDown(self)

    def payload(self, row, **changes):
        data = dict(password="SyntheticPass1!", typed_name="Synthetic investor", signature_png=PNG,
                    accepted_terms=True, document_hash=row.document_hash)
        data.update(changes)
        return data

    def own_sign(self, row, **changes):
        return self.client.post(f"/api/v1/investments/agreements/{row.id}/sign", json=self.payload(row, **changes))

    def test_own_read_and_close_then_public_retry_keep_link_and_execute_once(self):
        row, token = self.close_offer(); original_hash = row.token_hash
        self.current_user = self.user
        read = self.client.get(f"/api/v1/investments/agreements/{row.id}")
        self.assertEqual(read.status_code, 200); self.assertEqual(read.json()["document_hash"], row.document_hash)
        self.assertNotIn("private_terms", read.json()); self.assertNotIn("token", read.json())
        first = self.own_sign(row)
        self.assertEqual(first.status_code, 200, first.text); self.assertEqual(first.json()["status"], "signed")
        self.assertEqual(row.signer_user_id, self.user.id); self.assertEqual(row.token_hash, original_hash)
        self.assertEqual(self.investor.available_balance_cents, 8640000)
        self.assertEqual(self.db.query(WalletEntry).count(), 1)
        self.db.refresh(row)  # Compare the persisted SQLite datetime representation.
        signed_at, signed_name, signature, signer_id = row.signed_at, row.signed_name, row.signature_png, row.signer_user_id
        self.assertEqual(self.own_sign(row, typed_name="Retry signer").status_code, 200)
        public = self.client.post("/api/v1/investments/agreement-public/sign", json={**self.payload(row), "token": token})
        self.assertEqual(public.status_code, 200)
        self.assertEqual((row.signed_at, row.signed_name, row.signature_png, row.signer_user_id),
                         (signed_at, signed_name, signature, signer_id))
        self.assertEqual(self.db.query(WalletEntry).count(), 1); self.assertEqual(row.token_hash, original_hash)
        self.assertEqual(self.client.post("/api/v1/investments/agreement-public/read", json={"token":token}).status_code, 200)

    def test_other_investor_admin_manager_and_inactive_cannot_sign_or_spend_attempts(self):
        row, token = self.close_offer(); original_hash = row.token_hash
        other = Investor(name="Other synthetic investor"); shell = Investor(name="Other synthetic manager", is_manager=True)
        self.db.add_all([other, shell]); self.db.flush()
        outsider = User(username="other-synthetic", role="investor", investor_id=other.id, password_hash=hash_password("SyntheticPass1!"))
        manager = User(username="ordinary-manager", role="manager", investor_id=shell.id, password_hash=hash_password("SyntheticPass1!"))
        self.db.add_all([outsider, manager]); self.db.commit()
        for actor in (outsider, self.admin, manager):
            self.current_user = actor
            self.assertEqual(self.own_sign(row).status_code, 403)
        self.current_user = outsider
        self.assertEqual(self.client.get(f"/api/v1/investments/agreements/{row.id}").status_code, 403)
        self.assertEqual(self.client.get(f"/api/v1/investments/investors/{self.investor.id}/agreements").status_code, 403)
        self.current_user = self.user; self.user.is_active = False; self.db.commit()
        self.assertEqual(self.own_sign(row).status_code, 403)
        self.assertEqual(row.failed_attempts, 0); self.assertEqual(row.token_hash, original_hash)
        self.assertEqual(row.status, "pending"); self.assertEqual(self.db.query(WalletEntry).count(), 0)

    def test_legacy_shared_investor_public_retry_keeps_actual_session_signer(self):
        # Older databases can lack the model's investor_id uniqueness. Exercise
        # real second-account authentication against that isolated legacy schema.
        self.db.commit()
        legacy_metadata = MetaData()
        Investor.__table__.to_metadata(legacy_metadata)
        legacy_users = User.__table__.to_metadata(legacy_metadata, name="users_multilogin")
        for constraint in list(legacy_users.constraints):
            if isinstance(constraint, UniqueConstraint) and {column.name for column in constraint.columns} == {"investor_id"}:
                legacy_users.constraints.remove(constraint)
        for index in legacy_users.indexes:
            index.name = "legacy_" + index.name
        columns = ", ".join('"' + column.name + '"' for column in legacy_users.columns)
        with self.engine.begin() as connection:
            legacy_users.create(connection)
            connection.exec_driver_sql(f"INSERT INTO users_multilogin ({columns}) SELECT {columns} FROM users")
            connection.exec_driver_sql("DROP TABLE users")
            connection.exec_driver_sql("ALTER TABLE users_multilogin RENAME TO users")
        second = User(username="second-synthetic-account",role="investor",investor_id=self.investor.id,
                      password_hash=hash_password("SecondSyntheticPass1!"))
        self.db.add(second); self.db.commit()
        first = self.db.query(User).filter(User.investor_id == self.investor.id, User.is_active.is_(True)).first()
        self.assertEqual(first.id, self.user.id); self.assertNotEqual(first.id, second.id)
        row, token = self.close_offer(); original_hash = row.token_hash; self.current_user = second
        response = self.own_sign(row,password="SecondSyntheticPass1!")
        self.assertEqual(response.status_code,200,response.text); self.assertEqual(row.signer_user_id,second.id)
        self.db.refresh(row)
        receipt = (row.signer_user_id,row.signed_name,row.signature_png,row.signed_at)
        public = self.client.post("/api/v1/investments/agreement-public/sign",json={**self.payload(row,typed_name="First-account retry"),"token":token})
        self.assertEqual(public.status_code,200,public.text)
        self.db.refresh(row)
        self.assertEqual((row.signer_user_id,row.signed_name,row.signature_png,row.signed_at),receipt)
        self.assertEqual(row.token_hash,original_hash);self.assertEqual(self.db.query(WalletEntry).count(),1)
        self.assertEqual(self.investor.available_balance_cents,8640000)

    def test_fresh_password_consent_hash_and_png_are_required_without_rotating_token(self):
        row, token = self.close_offer(); original_hash = row.token_hash; self.current_user = self.user
        self.assertEqual(self.own_sign(row, password="wrong").status_code, 403)
        self.assertEqual(row.failed_attempts, 1)
        for changes in ({"accepted_terms":False}, {"document_hash":"0"*64}, {"signature_png":"not-a-signature"}, {"typed_name":"  "}):
            response = self.own_sign(row, **changes)
            self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(row.status, "pending"); self.assertIsNone(row.signed_at)
        self.assertEqual(row.token_hash, original_hash); self.assertEqual(self.db.query(WalletEntry).count(), 0)
        self.assertEqual(self.client.post("/api/v1/investments/agreement-public/read", json={"token":token}).status_code, 200)

    def test_cancelled_expired_and_maintenance_are_readable_history_but_not_signable(self):
        row, token = self.close_offer(); self.current_user = self.user
        row.expires_at = utcnow() - timedelta(seconds=1); self.db.commit()
        self.assertEqual(self.own_sign(row).status_code, 409)
        self.assertEqual(self.client.get(f"/api/v1/investments/agreements/{row.id}").status_code, 200)
        row.status = "cancelled"; row.expires_at = utcnow() + timedelta(days=1); self.db.commit()
        self.assertEqual(self.own_sign(row).status_code, 409)
        self.assertEqual(self.client.get(f"/api/v1/investments/agreements/{row.id}").json()["status"], "cancelled")
        self.assertEqual(self.db.query(WalletEntry).count(), 0)
        # Use real bearer dependency for session/maintenance behavior, not the test override.
        self.app.dependency_overrides.pop(get_current_user)
        headers = {"Authorization":"Bearer "+create_access_token(user_id=self.user.id,role="investor",investor_id=self.investor.id)}
        self.assertEqual(self.client.post(f"/api/v1/investments/agreements/{row.id}/sign", json=self.payload(row)).status_code, 401)
        with patch.object(settings, "admin_only_maintenance", True):
            self.assertEqual(self.client.get(f"/api/v1/investments/agreements/{row.id}", headers=headers).status_code, 503)
            self.assertEqual(self.client.post(f"/api/v1/investments/agreements/{row.id}/sign", headers=headers,json=self.payload(row)).status_code, 503)

    def test_attempt_limit_is_shared_with_existing_public_signing_link(self):
        row, token = self.close_offer(); original_hash = row.token_hash; self.current_user = self.user
        for _ in range(5):
            self.assertEqual(self.own_sign(row, password="wrong").status_code, 403)
        self.assertEqual(self.own_sign(row).status_code, 429)
        public = self.client.post("/api/v1/investments/agreement-public/sign", json={**self.payload(row), "token":token})
        self.assertEqual(public.status_code, 429); self.assertEqual(row.token_hash, original_hash)
        self.assertEqual(row.status, "pending"); self.assertEqual(self.db.query(WalletEntry).count(), 0)

    def test_opening_uses_session_signer_and_funds_only_once_without_token(self):
        self.plan.status="completed";self.plan.closed_on=self.today;self.db.commit()
        row, token = agreements.issue(self.db,investor_id=self.investor.id,kind="open",actor_id=self.admin.id,notice_id=self.notice("new").id,
            data=dict(investor_id=self.investor.id,principal=10000,additional_funds=10000,plan_type="hybrid",monthly_rate_percent=1,
                savings_rate_percent=2,manager_fee_percent=.5,manager_savings_rate_percent=.25,start_date=self.today,duration_months=12))
        self.db.commit(); original_hash=row.token_hash;self.current_user=self.user
        response=self.own_sign(row);self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(row.signer_user_id,self.current_user.id);self.assertEqual(self.db.query(InvestmentPlan).count(),2)
        self.assertEqual(self.investor.available_balance_cents,0)
        count=self.db.query(WalletEntry).count();self.assertEqual(self.own_sign(row).status_code,200)
        self.assertEqual(self.db.query(InvestmentPlan).count(),2);self.assertEqual(self.db.query(WalletEntry).count(),count)
        self.assertEqual(row.token_hash,original_hash)

    def test_execution_failure_rolls_back_signature_and_wallet_as_one_transaction(self):
        row, token=self.close_offer();self.current_user=self.user;original_hash=row.token_hash
        with patch.object(wallet,"close_plan",side_effect=ValueError("Synthetic execution conflict")):
            self.assertEqual(self.own_sign(row).status_code,409)
        self.db.refresh(row);self.assertEqual(row.status,"pending");self.assertIsNone(row.signer_user_id)
        self.assertIsNone(row.signature_png);self.assertEqual(row.token_hash,original_hash)
        self.assertEqual(self.plan.status,"active");self.assertEqual(self.investor.available_balance_cents,0)
        self.assertEqual(self.db.query(WalletEntry).count(),0)
