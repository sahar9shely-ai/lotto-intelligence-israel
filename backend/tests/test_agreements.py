import unittest
from datetime import date, timedelta
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.agreements import router as agreements_router
from app.api.v1.investments import router as investments_router
from app.core.config import settings
from app.db.investment_session import get_investment_db
from app.models.investments import Investor, PlanAgreement, PlanNotice, InvestmentPlan, WalletEntry, utcnow
from app.models.auth import User
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

    def test_signed_term_survives_legacy_reporting_notes_and_startup_repair(self):
        data=dict(investor_id=self.investor.id,principal=10000,additional_funds=10000,plan_type="hybrid",monthly_rate_percent=2,savings_rate_percent=1,
                  manager_fee_percent=0,manager_savings_rate_percent=0,start_date=date(2026,8,1),duration_months=12,notes="לוח דיווח לשנת 2026")
        row,token=agreements.issue(self.db,investor_id=self.investor.id,kind="open",actor_id=self.admin.id,notice_id=self.notice("new").id,data=data)
        self.db.commit();self.assertEqual(self.sign(row,token).status_code,200)
        self.db.expire_all()
        plan=self.db.get(InvestmentPlan,row.plan_id)
        self.assertEqual(svc.plan_effective_duration(plan),12)
        svc.repair_reporting_year_plans(self.db)
        self.assertEqual(plan.duration_months,12);self.assertEqual(len(plan.payments),12)

    def test_closing_preview_preparation_and_link_controls_are_admin_only(self):
        notice = self.notice()
        manager_investor = Investor(name="Synthetic manager", is_manager=True)
        self.db.add(manager_investor); self.db.flush()
        manager = User(username="another-manager", role="manager", investor_id=manager_investor.id)
        self.db.add(manager); self.db.commit()
        self.app.dependency_overrides.pop(require_manager)
        for actor in (manager, self.user):
            self.current_user = actor
            self.assertEqual(self.client.post(f"/api/v1/investments/plans/{self.plan.id}/closing-preview", json={"requested_on":"2026-01-01"}).status_code, 403)
            self.assertEqual(self.client.post(f"/api/v1/investments/plans/{self.plan.id}/closing-agreement", json={"notice_id":notice.id, "reviewed_document_hash":"0"*64}).status_code, 403)
        self.current_user = self.admin
        preview = self.client.post(f"/api/v1/investments/plans/{self.plan.id}/closing-preview", json={"requested_on":"2026-01-01"})
        self.assertEqual(preview.status_code, 200)
        self.assertTrue(preview.json()["can_prepare"])
        self.assertEqual(self.db.query(PlanAgreement).count(), 0)
        self.assertEqual(self.db.query(PlanNotice).count(), 1)
        self.assertEqual(self.db.query(WalletEntry).count(), 0)
        self.assertNotIn("manager_fee_percent", str(preview.json()))
        response = self.client.post(f"/api/v1/investments/plans/{self.plan.id}/closing-agreement", json={"notice_id":notice.id, "reviewed_document_hash":preview.json()["document_hash"]})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["snapshot"], preview.json()["snapshot"])
        self.assertEqual(self.plan.status, "active")
        self.assertEqual(self.investor.available_balance_cents, 0)
        self.current_user = manager
        row_id = response.json()["id"]
        for action in ("link", "cancel"):
            self.assertEqual(self.client.post(f"/api/v1/investments/agreements/{row_id}/{action}").status_code, 403)
        self.db.refresh(self.db.get(PlanAgreement,row_id))
        self.assertEqual(self.db.get(PlanAgreement,row_id).status, "pending")

    def test_closing_requires_review_and_changed_finances_require_new_review(self):
        notice = self.notice()
        endpoint = f"/api/v1/investments/plans/{self.plan.id}/closing-agreement"
        preview_endpoint = f"/api/v1/investments/plans/{self.plan.id}/closing-preview"
        preview = self.client.post(preview_endpoint,json={"requested_on":"2026-01-01"}).json()
        self.assertEqual(self.client.post(endpoint,json={"notice_id":notice.id}).status_code,409)
        self.plan.savings_redeemed_total = 100; self.db.commit()
        self.assertEqual(self.client.post(endpoint,json={"notice_id":notice.id,"reviewed_document_hash":preview["document_hash"]}).status_code,409)
        self.assertEqual(self.db.query(PlanAgreement).count(),0)
        self.assertEqual(self.db.query(WalletEntry).count(),0)
        fresh = self.client.post(preview_endpoint,json={"requested_on":"2026-01-01"}).json()
        self.assertNotEqual(fresh["document_hash"],preview["document_hash"])
        approved = self.client.post(endpoint,json={"notice_id":notice.id,"reviewed_document_hash":fresh["document_hash"]})
        self.assertEqual(approved.status_code,201)
        self.assertEqual(approved.json()["snapshot"],fresh["snapshot"])

    def test_mid_month_cross_year_preview_preserves_term_and_only_completed_months(self):
        self.plan.start_date = date(2025,7,15); self.plan.duration_months = 12; self.db.commit()
        preview = self.client.post(f"/api/v1/investments/plans/{self.plan.id}/closing-preview",json={"requested_on":"2026-01-01"})
        self.assertEqual(preview.status_code,200)
        self.assertFalse(preview.json()["can_prepare"])
        self.assertEqual(preview.json()["eligible_on"],"2026-07-15")
        self.assertEqual(preview.json()["snapshot"]["terms"]["savings"],13200)
        self.assertEqual(preview.json()["snapshot"]["terms"]["duration_months"],12)
        self.assertEqual(preview.json()["snapshot"]["terms"]["savings_months"],6)
        self.assertEqual(self.db.query(PlanAgreement).count(),0)
        self.assertEqual(self.db.query(PlanNotice).count(),0)
        self.assertEqual(self.db.query(WalletEntry).count(),0)

    def test_preexisting_pending_closing_agreement_without_months_still_signs(self):
        row, token = self.close_offer()
        snapshot = {**row.snapshot, "terms": dict(row.snapshot["terms"])}
        snapshot["terms"].pop("savings_months")
        row.snapshot = snapshot; row.document_hash = agreements.digest(snapshot); self.db.commit()
        self.assertEqual(self.sign(row, token).status_code, 200)
        self.assertEqual(self.investor.available_balance_cents, 8640000)

    def test_admin_reinvestment_closes_early_after_signature_then_opens_same_day(self):
        self.plan.start_date=date(2025,7,15); self.plan.duration_months=12; self.db.commit()
        preview_endpoint=f"/api/v1/investments/plans/{self.plan.id}/closing-preview"
        payload={"requested_on":self.today.isoformat(),"purpose":"renew"}
        preview=self.client.post(preview_endpoint,json=payload).json()
        self.assertTrue(preview["can_prepare"]); self.assertEqual(preview["eligible_on"],self.today.isoformat())
        self.assertEqual(preview["snapshot"]["terms"]["end_date"],"2026-07-15")
        self.assertEqual(preview["snapshot"]["terms"]["savings_months"],6)
        self.assertEqual(preview["snapshot"]["terms"]["savings"],13200)
        self.assertIn("לצורך",preview["snapshot"]["clauses"][0])
        notice=self.notice("renew",self.today)
        response=self.client.post(f"/api/v1/investments/plans/{self.plan.id}/closing-agreement",
            json={"notice_id":notice.id,"reviewed_document_hash":preview["document_hash"]})
        self.assertEqual(response.status_code,201)
        self.assertEqual(response.json()["snapshot"],preview["snapshot"])
        row=self.db.get(PlanAgreement,response.json()["id"]); token=response.json()["token"]
        self.assertEqual(self.plan.status,"active"); self.assertEqual(self.investor.available_balance_cents,0)
        self.assertEqual(self.sign(row,token).status_code,200)
        self.assertEqual(self.plan.status,"completed"); self.assertEqual(self.plan.closed_on,self.today)
        self.assertEqual(self.investor.available_balance_cents,7320000)
        self.assertEqual(self.sign(row,token).status_code,200)
        self.assertEqual(self.db.query(WalletEntry).count(),1)
        self.assertEqual(self.paid.status,"paid"); self.assertEqual(self.overdue.status,"scheduled"); self.assertEqual(self.future.status,"skipped")
        data=dict(investor_id=self.investor.id,principal=73200,additional_funds=0,plan_type="hybrid",monthly_rate_percent=3,savings_rate_percent=1,
                  manager_fee_percent=0,manager_savings_rate_percent=0,start_date=self.today,duration_months=12)
        opening,opening_token=agreements.issue(self.db,investor_id=self.investor.id,kind="open",actor_id=self.admin.id,
            notice_id=self.notice("new",self.today).id,data=data)
        self.db.commit(); self.assertEqual(self.investor.available_balance_cents,7320000)
        self.assertEqual(self.sign(opening,opening_token).status_code,200)
        self.assertEqual(self.investor.available_balance_cents,0)
        new_plan=self.db.get(InvestmentPlan,opening.plan_id)
        self.assertEqual(new_plan.start_date,self.today); self.assertEqual(new_plan.principal,73200)
        self.assertNotEqual(new_plan.id,self.plan.id)
        self.assertEqual(self.db.query(WalletEntry).count(),2)
        docs=svc.list_document_vault(self.db,investor=self.investor)["documents"]
        self.assertTrue({row.id,opening.id}.issubset({d["source_id"] for d in docs if d["kind"]=="agreement"}))

    def test_reinvestment_does_not_remove_withdrawal_term_and_notice_rules(self):
        self.plan.start_date=date(2025,7,15); self.plan.duration_months=12; self.db.commit()
        preview=self.client.post(f"/api/v1/investments/plans/{self.plan.id}/closing-preview",
            json={"requested_on":self.today.isoformat(),"purpose":"withdraw"}).json()
        self.assertFalse(preview["can_prepare"]); self.assertEqual(preview["eligible_on"],"2026-07-15")
        n=self.notice("withdraw",self.today)
        with self.assertRaisesRegex(ValueError,"לפני תום"):
            agreements.issue(self.db,investor_id=self.investor.id,kind="close",actor_id=self.admin.id,notice_id=n.id,plan_id=self.plan.id)
        self.assertEqual(self.investor.available_balance_cents,0)

    def test_reinvestment_requires_admin_and_matching_review_purpose(self):
        preview_endpoint=f"/api/v1/investments/plans/{self.plan.id}/closing-preview"
        withdrawal=self.client.post(preview_endpoint,json={"requested_on":"2026-01-01"}).json()
        n=self.notice("renew",date(2026,1,1))
        response=self.client.post(f"/api/v1/investments/plans/{self.plan.id}/closing-agreement",
            json={"notice_id":n.id,"reviewed_document_hash":withdrawal["document_hash"]})
        self.assertEqual(response.status_code,409); self.assertEqual(self.db.query(PlanAgreement).count(),0)
        self.current_user=self.user
        self.assertEqual(self.client.post(preview_endpoint,json={"requested_on":self.today.isoformat(),"purpose":"renew"}).status_code,403)
        with self.assertRaisesRegex(ValueError,"אדמין בלבד"):
            agreements.issue(self.db,investor_id=self.investor.id,kind="close",actor_id=self.user.id,notice_id=n.id,plan_id=self.plan.id)

    def test_future_plan_cannot_be_closed_by_reinvestment(self):
        self.plan.start_date=date(2026,3,15); self.db.commit()
        preview=self.client.post(f"/api/v1/investments/plans/{self.plan.id}/closing-preview",
            json={"requested_on":self.today.isoformat(),"purpose":"renew"}).json()
        self.assertFalse(preview["can_prepare"])
        with self.assertRaisesRegex(ValueError,"טרם התחיל"):
            agreements.issue(self.db,investor_id=self.investor.id,kind="close",actor_id=self.admin.id,
                notice_id=self.notice("renew",self.today).id,plan_id=self.plan.id)

    def test_early_signature_on_later_day_requires_unchanged_full_month_figures(self):
        self.plan.start_date=date(2025,7,15); self.plan.duration_months=12; self.db.commit()
        row,token=agreements.issue(self.db,investor_id=self.investor.id,kind="close",actor_id=self.admin.id,
            notice_id=self.notice("renew",self.today).id,plan_id=self.plan.id)
        self.db.commit()
        self.assertEqual(row.snapshot["terms"]["calculation_date"],self.today.isoformat())
        with patch.object(agreements,"israel_today",return_value=date(2026,2,15)), patch.object(wallet,"israel_today",return_value=date(2026,2,15)):
            self.assertEqual(self.sign(row,token).status_code,409)
        self.assertEqual(self.plan.status,"active"); self.assertEqual(self.investor.available_balance_cents,0)
        with patch.object(agreements,"israel_today",return_value=date(2026,2,2)), patch.object(wallet,"israel_today",return_value=date(2026,2,2)):
            self.assertEqual(self.sign(row,token).status_code,200)
        self.assertEqual(self.plan.closed_on,date(2026,2,2)); self.assertEqual(self.investor.available_balance_cents,7320000)
