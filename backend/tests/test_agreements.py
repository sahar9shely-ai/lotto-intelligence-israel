import unittest
from datetime import date, timedelta
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.agreements import router as agreements_router
from app.api.v1.investments import router as investments_router
from app.core.config import settings
from app.db.investment_session import get_investment_db
from app.models.investments import PlanAgreement, PlanNotice, InvestmentPlan, WalletEntry, utcnow
from app.security.auth import get_current_user, require_manager, hash_password
from app.services import agreement_service as agreements, wallet_service as wallet, investment_service as svc
import test_wallet_business as wallet_test_helpers

PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


class AgreementTests(unittest.TestCase):
    def setUp(self):
        wallet_test_helpers.WalletBusinessTests.setUp(self)
        self.plan.duration_months = 12
        self.user.password_hash = hash_password("SyntheticPass1!")
        self.db.commit()
        self.today = date(2026, 2, 1)
        self.clock1 = patch.object(agreements, "israel_today", return_value=self.today); self.clock1.start()
        self.clock2 = patch.object(wallet, "israel_today", return_value=self.today); self.clock2.start()
        app = FastAPI(); app.include_router(investments_router); app.include_router(agreements_router)
        app.dependency_overrides[get_investment_db] = lambda: self.db
        app.dependency_overrides[require_manager] = lambda: self.admin
        self.current_user = self.admin
        app.dependency_overrides[get_current_user] = lambda: self.current_user
        self.client = TestClient(app)
        self.app = app
        self.maintenance = patch.object(settings, "admin_only_maintenance", False); self.maintenance.start()

    def tearDown(self):
        self.client.close(); self.clock1.stop(); self.clock2.stop(); self.maintenance.stop()
        wallet_test_helpers.WalletBusinessTests.tearDown(self)

    def notice(self, purpose="withdraw", requested=date(2026, 1, 1)):
        n=PlanNotice(investor_id=self.investor.id,purpose=purpose,requested_on=requested,actor_user_id=self.admin.id)
        self.db.add(n);self.db.commit();return n

    def close_offer(self):
        row,token=agreements.issue(self.db,investor_id=self.investor.id,kind="close",actor_id=self.admin.id,notice_id=self.notice().id,plan_id=self.plan.id)
        self.db.commit();return row,token

    def sign(self, row, token, **changes):
        data=dict(token=token,password="SyntheticPass1!",typed_name="Synthetic investor",signature_png=PNG,accepted_terms=True,document_hash=row.document_hash)
        data.update(changes)
        return self.client.post("/api/v1/investments/agreement-public/sign",json=data)

    def test_no_close_before_signature_then_close_exactly_once_and_archive(self):
        row,token=self.close_offer()
        self.assertEqual(self.plan.status,"active");self.assertEqual(self.investor.available_balance_cents,0)
        self.assertEqual(self.client.post(f"/api/v1/investments/plans/{self.plan.id}/close").status_code,409)
        self.assertEqual(self.sign(row,token).status_code,200)
        self.assertEqual(self.plan.status,"completed");self.assertEqual(self.investor.available_balance_cents,8640000)
        self.assertEqual(self.sign(row,token).status_code,200);self.assertEqual(self.db.query(WalletEntry).count(),1)
        docs=svc.list_document_vault(self.db,investor=self.investor)["documents"]
        self.assertTrue(any(d["kind"]=="agreement" and d["source_id"]==row.id for d in docs))
        self.assertEqual(row.signer_user_id,self.user.id)

    def test_short_agreed_term_matures_but_cannot_close_early_or_without_notice(self):
        self.plan.start_date=date(2026,1,1);self.plan.duration_months=2;self.db.commit()
        n=self.notice()
        with self.assertRaisesRegex(ValueError,"לפני תום"):
            agreements.issue(self.db,investor_id=self.investor.id,kind="close",actor_id=self.admin.id,notice_id=n.id,plan_id=self.plan.id)
        self.plan.duration_months=1;self.db.commit()
        row,token=agreements.issue(self.db,investor_id=self.investor.id,kind="close",actor_id=self.admin.id,notice_id=n.id,plan_id=self.plan.id)
        self.db.commit();self.assertEqual(self.sign(row,token).status_code,200)
        self.assertEqual(row.snapshot["terms"]["duration_months"],1)

    def test_new_plan_stays_draft_until_verified_signature_funds_all_balance(self):
        self.investor.available_balance_cents=8860000;self.db.commit()
        data=dict(investor_id=self.investor.id,principal=98600,additional_funds=10000,plan_type="hybrid",monthly_rate_percent=5,savings_rate_percent=2,
                  manager_fee_percent=1,manager_savings_rate_percent=0.5,start_date=self.today,duration_months=12)
        row,token=agreements.issue(self.db,investor_id=self.investor.id,kind="open",actor_id=self.admin.id,notice_id=self.notice("new").id,data=data)
        self.db.commit();self.assertEqual(self.db.query(InvestmentPlan).count(),1)
        read=self.client.post("/api/v1/investments/agreement-public/read",json={"token":token}).json()
        self.assertNotIn("private_terms",read);self.assertNotIn("manager_fee_percent",str(read));self.assertNotIn("manager_savings_rate_percent",str(read))
        self.assertEqual(self.sign(row,token,password="wrong").status_code,403);self.assertEqual(self.db.query(InvestmentPlan).count(),1)
        self.assertEqual(self.sign(row,token).status_code,200)
        self.assertEqual(self.investor.available_balance_cents,0)
        plan=self.db.get(InvestmentPlan,row.plan_id);self.assertEqual(plan.principal,98600);self.assertEqual(plan.manager_savings_rate_percent,0.5)
        self.assertEqual(self.sign(row,token).status_code,200);self.assertEqual(self.db.query(InvestmentPlan).count(),2)

    def test_stale_finances_hash_and_consent_cannot_trigger_closure(self):
        row,token=self.close_offer()
        self.assertEqual(self.sign(row,token,accepted_terms=False).status_code,409)
        self.assertEqual(self.sign(row,token,document_hash="0"*64).status_code,409)
        self.plan.savings_redeemed_total=100;self.db.commit()
        self.assertEqual(self.sign(row,token).status_code,409)
        self.assertEqual(self.plan.status,"active");self.assertEqual(self.investor.available_balance_cents,0)
        self.db.refresh(row);self.assertEqual(row.status,"pending");self.assertIsNone(row.signature_png)

    def test_link_rotation_expiry_cancel_and_maintenance(self):
        row,token=self.close_offer()
        for _ in range(5): self.assertEqual(self.sign(row,token,password="wrong").status_code,403)
        self.assertEqual(self.sign(row,token).status_code,429)
        new=self.client.post(f"/api/v1/investments/agreements/{row.id}/link").json()["token"]
        self.assertEqual(self.sign(row,token).status_code,409)
        with patch.object(settings,"admin_only_maintenance",True):
            self.assertEqual(self.sign(row,new).status_code,503)
            self.assertEqual(self.client.post("/api/v1/investments/agreement-public/read",json={"token":new}).status_code,503)
        row.expires_at=utcnow()-timedelta(seconds=1);self.db.commit()
        self.assertEqual(self.sign(row,new).status_code,409)
        self.assertEqual(self.client.post(f"/api/v1/investments/agreements/{row.id}/cancel").status_code,200)
        self.assertEqual(self.plan.status,"active")

    def test_month_notice_and_retained_history_and_fixed_term(self):
        n=self.notice(requested=date(2026,1,31))
        with self.assertRaisesRegex(ValueError,"חודש"):
            agreements.issue(self.db,investor_id=self.investor.id,kind="close",actor_id=self.admin.id,notice_id=n.id,plan_id=self.plan.id)
        self.assertFalse(svc.auto_extend_active_plan(self.db,self.plan,self.today));self.assertEqual(self.plan.duration_months,12)
        with self.assertRaisesRegex(ValueError,"בהיסטוריה"):
            svc.delete_investor_and_history(self.db,investor_id=self.investor.id)
        self.current_user=self.user
        self.assertEqual(self.client.get(f"/api/v1/investments/investors/{self.admin_investor.id}/agreements").status_code,403)

    def test_signature_and_money_roll_back_together_on_execution_failure(self):
        row,token=self.close_offer()
        with patch.object(wallet,"close_plan",side_effect=ValueError("Execution conflict")):
            self.assertEqual(self.sign(row,token).status_code,409)
        self.db.refresh(row);self.assertEqual(row.status,"pending");self.assertIsNone(row.signed_at)
        self.assertEqual(self.investor.available_balance_cents,0);self.assertEqual(self.plan.status,"active")

    def test_investor_cannot_prepare_contract_and_unsigned_creation_is_blocked(self):
        body=dict(investor_id=self.investor.id,principal=1000,monthly_rate_percent=2,manager_fee_percent=0,start_date="2026-02-01",duration_months=12)
        self.assertEqual(self.client.post("/api/v1/investments/plans",json=body).status_code,409)
        self.app.dependency_overrides.pop(require_manager)
        self.current_user=self.user
        notice=self.notice("new")
        self.assertEqual(self.client.post("/api/v1/investments/agreements/open",json={**body,"notice_id":notice.id}).status_code,403)
        self.assertEqual(self.client.post(f"/api/v1/investments/plans/{self.plan.id}/closing-agreement",json={"notice_id":notice.id}).status_code,403)

    def test_wallet_withdrawal_requires_mature_notice_and_preserves_signed_history(self):
        row,token=self.close_offer()
        self.assertEqual(self.sign(row,token).status_code,200)
        self.assertEqual(self.client.delete(f"/api/v1/investments/plans/{self.plan.id}").status_code,409)
        self.db.query(PlanNotice).filter(PlanNotice.id != row.notice_id).delete()
        notice=self.db.get(PlanNotice,row.notice_id)
        notice.requested_on=date(2026,1,31);self.db.commit()
        body={"amount":10000,"operation_key":"synthetic-withdrawal"}
        with patch.object(svc,"israel_today",return_value=self.today):
            response=self.client.post(f"/api/v1/investments/investors/{self.investor.id}/wallet/withdraw",json=body)
            self.assertEqual(response.status_code,409)
            self.assertEqual(self.investor.available_balance_cents,8640000)
            notice.requested_on=date(2026,1,1);self.db.commit()
            self.assertEqual(self.client.post(f"/api/v1/investments/investors/{self.investor.id}/wallet/withdraw",json=body).status_code,200)
            self.assertEqual(self.investor.available_balance_cents,7640000)
            self.assertEqual(self.client.post(f"/api/v1/investments/investors/{self.investor.id}/wallet/withdraw",json=body).status_code,200)
            self.assertEqual(self.investor.available_balance_cents,7640000)
