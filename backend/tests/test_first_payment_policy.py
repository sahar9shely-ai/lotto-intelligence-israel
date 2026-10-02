import copy
import json
import unittest
import tempfile
import threading
from contextlib import contextmanager
from pathlib import Path
from datetime import date, datetime, timezone
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.v1.agreements import router
from app.api.v1.investments import router as investments_router
from app.db.investment_base import InvestmentBase
from app.db.investment_session import get_investment_db
from app.models.auth import ActivityEvent, User
from app.models.investments import Investor, InvestmentPlan, Payment, PlanAgreement, PlanNotice, Quote, WalletEntry, InvestmentTopupRequest, utcnow
from app.security.auth import get_current_user, require_system_admin
from app.services import agreement_service as agreements, agreement_amendment_service as amendments, investment_service as svc, wallet_service as wallet
from app.services import payment_schedule_reconciliation as repair

PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


class FirstPaymentPolicyTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        InvestmentBase.metadata.create_all(self.engine)
        self.db = Session(self.engine, expire_on_commit=False)
        self.investor = Investor(name="Synthetic investor", available_balance_cents=6730000)
        shell = Investor(name="מנהל מערכת", is_manager=True)
        manager_investor = Investor(name="Synthetic manager", is_manager=True)
        self.db.add_all([self.investor, shell, manager_investor]); self.db.flush()
        self.admin = User(username="admin", role="manager", investor_id=shell.id)
        self.manager = User(username="ordinary_manager", role="manager", investor_id=manager_investor.id)
        self.user = User(username="synthetic", role="investor", investor_id=self.investor.id)
        self.db.add_all([self.admin, self.manager, self.user]); self.db.commit()
        self.today = date(2026, 10, 2)
        self.clocks = [patch.object(module, "israel_today", return_value=self.today) for module in (agreements, amendments, repair, wallet, svc)]
        for clock in self.clocks:
            clock.start()
        self.app = FastAPI(); self.app.include_router(router);self.app.include_router(investments_router)
        self.app.dependency_overrides[get_investment_db] = lambda: self.db
        self.current_user = self.admin
        self.app.dependency_overrides[get_current_user] = lambda: self.current_user
        self.client = TestClient(self.app)

    def tearDown(self):
        self.client.close()
        for clock in self.clocks:
            clock.stop()
        self.db.close(); self.engine.dispose()

    def data(self, start=None, **changes):
        result = dict(investor_id=self.investor.id, principal=67300, additional_funds=0,
            plan_type="hybrid", monthly_rate_percent=3, savings_rate_percent=2,
            manager_fee_percent=.6, manager_savings_rate_percent=.25, start_date=start or self.today, duration_months=12)
        result.update(changes)
        return result

    def notice(self):
        row = PlanNotice(investor_id=self.investor.id, purpose="new", requested_on=self.today, actor_user_id=self.admin.id)
        self.db.add(row); self.db.flush(); return row

    def offer(self, start=None, **changes):
        row, token = agreements.issue(self.db, investor_id=self.investor.id, kind="open", actor_id=self.admin.id,
            notice_id=self.notice().id, data=self.data(start, **changes))
        self.db.commit(); return row, token

    def sign(self, row):
        result = agreements.sign(self.db, row, name="Synthetic signer", signature=PNG, accepted=True, document_hash=row.document_hash)
        self.db.commit(); return result

    def signed_legacy(self, start=None):
        row, token = self.offer(start)
        self.sign(row)
        plan = self.db.get(InvestmentPlan, row.plan_id)
        # Fixture represents an already-signed pre-policy agreement and schedule.
        plan.first_payment_date = None
        for payment in plan.payments:
            payment.due_date = svc.add_months(plan.start_date, payment.month_number - 1)
        snapshot = copy.deepcopy(row.snapshot)
        snapshot["terms"].pop("first_payment_date", None); snapshot["terms"].pop("payment_timing", None)
        row.snapshot = snapshot; row.document_hash = agreements.digest(snapshot)
        self.db.commit(); self.db.refresh(row); return plan, row

    def test_opening_month_is_never_due_and_last_payment_matches_maturity(self):
        row, _ = self.offer()
        self.assertEqual(self.db.query(InvestmentPlan).count(), 0)
        self.assertEqual(row.snapshot["terms"]["first_payment_date"], "2026-11-02")
        self.sign(row)
        plan = self.db.get(InvestmentPlan, row.plan_id)
        dues = sorted(p.due_date for p in plan.payments)
        self.assertEqual(dues[0], date(2026, 11, 2)); self.assertEqual(dues[-1], date(2027, 10, 2))
        self.assertEqual(len(dues), 12); self.assertTrue(all(p.investor_amount == 2019 for p in plan.payments))
        self.assertEqual(row.execution_details["first_payment_date"], "2026-11-02")
        self.assertEqual(svc.serialize_plan(plan)["track_end_date"], date(2027,10,2))

    def test_future_start_and_delayed_signature_use_actual_full_month(self):
        row, _ = self.offer(date(2026, 11, 10))
        self.sign(row)
        self.assertEqual(self.db.get(InvestmentPlan, row.plan_id).first_payment_date, date(2026, 12, 10))
        self.db.get(InvestmentPlan, row.plan_id).status = "completed"
        self.db.get(InvestmentPlan, row.plan_id).closed_on = self.today
        self.investor.available_balance_cents = 6730000; self.db.commit()
        next_offer, _ = self.offer()
        with patch.object(agreements, "israel_today", return_value=date(2026, 10, 5)):
            self.sign(next_offer)
        new = self.db.get(InvestmentPlan, next_offer.plan_id)
        self.assertEqual(new.start_date, date(2026, 10, 5)); self.assertEqual(new.first_payment_date, date(2026, 11, 5))

    def test_month_end_and_leap_year_preserve_original_anniversary(self):
        for start, first, second in [(date(2027,1,31),date(2027,2,28),date(2027,3,31)),(date(2028,1,31),date(2028,2,29),date(2028,3,31))]:
            plan = InvestmentPlan(start_date=start, first_payment_date=first)
            self.assertEqual(svc.payment_due_date(plan, 1), first); self.assertEqual(svc.payment_due_date(plan, 2), second)
            self.assertEqual(svc.payment_due_date(plan, 12), svc.add_months(start, 12))

    def test_legacy_schedule_and_paid_rows_are_not_shifted_by_regeneration(self):
        plan, row = self.signed_legacy()
        payment = plan.payments[0]; payment.status="paid"; payment.paid_at=self.today
        self.db.commit(); before=[(p.id,p.due_date,p.status,p.investor_amount) for p in plan.payments]
        svc.generate_payment_schedule(self.db,plan,realign_dates=False)
        self.assertEqual(before,[(p.id,p.due_date,p.status,p.investor_amount) for p in plan.payments])
        self.assertIsNone(plan.first_payment_date)

    def test_old_debt_remains_but_old_future_is_cancelled_and_new_cash_is_next_month(self):
        self.investor.available_balance_cents=0
        old=InvestmentPlan(investor_id=self.investor.id,principal=67300,accrual_principal=67300,plan_type="monthly",monthly_rate_percent=3800/67300*100,
            savings_rate_percent=0,manager_fee_percent=0,start_date=date(2026,1,1),duration_months=12)
        self.db.add(old); self.db.flush()
        debt=Payment(plan_id=old.id,investor_id=self.investor.id,month_number=10,due_date=date(2026,10,1),investor_amount=3800,status="scheduled")
        future=Payment(plan_id=old.id,investor_id=self.investor.id,month_number=11,due_date=date(2026,11,1),investor_amount=3800,status="scheduled")
        self.db.add_all([debt,future]); self.db.commit()
        wallet.close_plan(self.db,old.id,self.admin.id);self.db.commit()
        row,_=self.offer(); self.sign(row)
        self.assertEqual(debt.status,"scheduled"); self.assertEqual(future.status,"skipped")
        due=sum(p.investor_amount for p in self.db.query(Payment).all() if p.status=="scheduled" and p.due_date<=self.today)
        self.assertEqual(due,3800)

    def test_direct_funding_and_signature_reject_a_second_active_or_paused_plan(self):
        row,_=self.offer(); self.sign(row)
        plan=self.db.get(InvestmentPlan,row.plan_id)
        for status in ("active","paused"):
            plan.status=status; self.db.commit()
            with self.assertRaisesRegex(ValueError,"כבר קיים מסלול"):
                wallet.fund_plan(self.db,self.data(principal=1000,additional_funds=1000),1000,"second-funding-key",self.admin.id)
            with self.assertRaisesRegex(ValueError,"כבר קיים מסלול"):
                self.offer(principal=1000,additional_funds=1000)
            self.db.rollback()
        self.assertEqual(self.db.query(InvestmentPlan).count(),1)

    def test_topup_execution_uses_month_later_and_rejects_parallel_plan(self):
        self.investor.available_balance_cents=0; self.db.commit()
        request=InvestmentTopupRequest(investor_id=self.investor.id,amount=1000,status="contract",created_at=datetime(2026,9,1,tzinfo=timezone.utc),
            offered_start_date=date(2026,10,10),offered_duration_months=12,offered_plan_type="monthly",offered_monthly_rate_percent=1)
        self.db.add(request);self.db.flush();svc._execute_signed_contract(self.db,request=request);self.db.commit()
        plan=self.db.get(InvestmentPlan,request.created_plan_id)
        self.assertEqual(plan.first_payment_date,date(2026,11,10)); self.assertEqual(plan.payments[0].due_date,date(2026,11,10))
        second=InvestmentTopupRequest(investor_id=self.investor.id,amount=1000,status="contract",created_at=datetime(2026,9,1,tzinfo=timezone.utc),
            offered_start_date=date(2026,10,10),offered_duration_months=12,offered_plan_type="monthly",offered_monthly_rate_percent=1)
        self.db.add(second);self.db.flush()
        with self.assertRaisesRegex(ValueError,"כבר קיים מסלול"):
            svc._execute_signed_contract(self.db,request=second)

    def test_existing_database_migration_is_additive_and_repeatable(self):
        from app.db.schema_migrate import ensure_schema
        plan,row=self.signed_legacy()
        before=[(p.id,p.due_date,p.status) for p in plan.payments]
        self.db.close()
        with self.engine.begin() as conn:
            conn.execute(text("ALTER TABLE investment_plans DROP COLUMN first_payment_date"))
        ensure_schema(self.engine); ensure_schema(self.engine)
        self.db=Session(self.engine,expire_on_commit=False)
        restored=self.db.get(InvestmentPlan,plan.id)
        self.assertIsNone(restored.first_payment_date)
        self.assertEqual(before,[(p.id,p.due_date,p.status) for p in restored.payments])

    def test_repair_is_scoped_dry_run_atomic_idempotent_and_keeps_signed_snapshot(self):
        plan,original=self.signed_legacy()
        original_bytes=json.dumps(agreements.serialize(original),sort_keys=True,default=str)
        before=[(p.id,p.due_date,p.investor_amount,p.manager_amount) for p in plan.payments]
        preview=repair.reconcile_opening_payment_dates(self.db,[plan.id])
        self.assertEqual(preview["repaired_count"],0); self.assertEqual(preview["conflicts"],[])
        self.assertIsNone(plan.first_payment_date); self.assertEqual(before,[(p.id,p.due_date,p.investor_amount,p.manager_amount) for p in plan.payments])
        repair.reconcile_opening_payment_dates(self.db,[plan.id],dry_run=False,expected_digest=preview["review_digest"]);self.db.rollback()
        self.assertIsNone(self.db.get(InvestmentPlan,plan.id).first_payment_date)
        repair.reconcile_opening_payment_dates(self.db,[plan.id],dry_run=False);self.db.commit()
        self.assertEqual(plan.first_payment_date,date(2026,11,2)); self.assertEqual(self.db.query(ActivityEvent).filter(ActivityEvent.kind=="plan_payment_timing_repaired").count(),1)
        again=repair.reconcile_opening_payment_dates(self.db,[plan.id],dry_run=False);self.db.commit()
        self.assertEqual(again["repaired_count"],0);self.assertEqual(self.db.query(WalletEntry).count(),1)
        self.assertEqual(original_bytes,json.dumps(agreements.serialize(original),sort_keys=True,default=str))

    def test_repair_rejects_future_scope_paid_sent_custom_and_stale_review(self):
        plan,_=self.signed_legacy()
        with self.assertRaises(ValueError):repair.reconcile_opening_payment_dates(self.db,[])
        preview=repair.reconcile_opening_payment_dates(self.db,[plan.id])
        for status in ("paid","awaiting_confirmation","skipped"):
            plan.payments[0].status=status;self.db.commit()
            result=repair.reconcile_opening_payment_dates(self.db,[plan.id])
            self.assertTrue(result["conflicts"])
            with self.assertRaises(ValueError):repair.reconcile_opening_payment_dates(self.db,[plan.id],dry_run=False)
            self.db.rollback()
        plan.payments[0].status="scheduled";plan.payments[0].confirmation_requested_at=utcnow();self.db.commit()
        self.assertTrue(repair.reconcile_opening_payment_dates(self.db,[plan.id])["conflicts"])
        plan.payments[0].confirmation_requested_at=None;plan.payments[0].investor_amount+=1;self.db.commit()
        with self.assertRaisesRegex(ValueError,"נתוני בדיקת"):
            repair.reconcile_opening_payment_dates(self.db,[plan.id],dry_run=False,expected_digest=preview["review_digest"])
        self.db.rollback()
        plan.start_date=date(2026,11,10);self.db.commit()
        self.assertEqual(repair.reconcile_opening_payment_dates(self.db,[plan.id])["conflicts"][0]["reason"],"future_start_requires_explicit_review")

    def amendment_offer(self,plan,start=date(2026,10,10)):
        preview=amendments.date_amendment_preview(self.db,plan.id,start)
        row,token=amendments.issue_date_amendment(self.db,plan.id,start_date=start,first_payment_date=None,notes=None,
            actor_id=self.admin.id,reviewed_document_hash=preview["document_hash"])
        self.db.commit();return row,token

    def test_amendment_waits_for_signature_keeps_capital_wallet_id_and_original(self):
        plan,original=self.signed_legacy()
        original_bytes=json.dumps(agreements.serialize(original),sort_keys=True,default=str)
        wallet_before=[(e.id,e.amount_cents,e.balance_after_cents) for e in self.db.query(WalletEntry)]
        payment_ids=[p.id for p in plan.payments]
        row,_=self.amendment_offer(plan)
        self.assertEqual(plan.start_date,self.today); self.assertIsNone(plan.first_payment_date)
        self.sign(row)
        self.assertEqual(plan.start_date,date(2026,10,10));self.assertEqual(plan.first_payment_date,date(2026,11,10))
        self.assertEqual(self.db.query(InvestmentPlan).count(),1);self.assertEqual([p.id for p in plan.payments],payment_ids)
        self.assertEqual(plan.payments[0].due_date,date(2026,11,10));self.assertEqual(plan.payments[-1].due_date,date(2027,10,10))
        self.assertEqual(wallet_before,[(e.id,e.amount_cents,e.balance_after_cents) for e in self.db.query(WalletEntry)])
        self.assertEqual(original_bytes,json.dumps(agreements.serialize(original),sort_keys=True,default=str))
        self.assertFalse(row.execution_details["wallet_changed"])
        self.sign(row);self.assertEqual(self.db.query(InvestmentPlan).count(),1)

    def test_future_original_and_late_amendment_signature_preserve_explicit_period(self):
        plan,_=self.signed_legacy(date(2026,11,10))
        row,_=self.amendment_offer(plan)
        with patch.object(amendments,"israel_today",return_value=date(2026,10,11)):
            self.sign(row)
        self.assertEqual(plan.start_date,date(2026,10,10));self.assertEqual(plan.first_payment_date,date(2026,11,10))

    def test_paid_after_amendment_offer_or_changed_money_blocks_signature(self):
        plan,_=self.signed_legacy();row,_=self.amendment_offer(plan)
        plan.payments[0].status="paid";plan.payments[0].paid_at=self.today;self.db.commit()
        with self.assertRaisesRegex(ValueError,"תשלום או שליחת"):
            self.sign(row)
        self.db.rollback();self.assertEqual(row.status,"pending");self.assertEqual(plan.start_date,self.today)
        plan.payments[0].status="scheduled";plan.payments[0].paid_at=None;plan.principal+=1;self.db.commit()
        with self.assertRaisesRegex(ValueError,"נתוני המסלול השתנו"):
            self.sign(row)
        self.db.rollback();self.assertEqual(row.status,"pending")

    def test_amendment_preview_and_issue_are_admin_only_and_hash_bound(self):
        plan,_=self.signed_legacy()
        url=f"/api/v1/investments/plans/{plan.id}/date-amendment-preview"
        for user in (self.user,self.manager):
            self.current_user=user;self.assertEqual(self.client.post(url,json={"start_date":"2026-10-10"}).status_code,403)
        self.current_user=self.admin
        preview=self.client.post(url,json={"start_date":"2026-10-10"});self.assertEqual(preview.status_code,200)
        response=self.client.post(url.replace("-preview",""),json={"start_date":"2026-10-10","reviewed_document_hash":"0"*64})
        self.assertEqual(response.status_code,409);self.assertEqual(self.db.query(PlanAgreement).filter(PlanAgreement.kind=="amend_dates").count(),0)

    def test_replacement_clones_private_finances_atomically_and_invalidates_old_link(self):
        old,old_token=self.offer(date(2026,11,10))
        old_snapshot=copy.deepcopy(old.snapshot);old_private=copy.deepcopy(old.private_terms);old_hash=old.document_hash
        preview=amendments.opening_replacement_preview(self.db,old.id,date(2026,10,10))
        self.assertEqual(old.status,"pending");self.assertEqual(agreements.by_token(self.db,old_token).id,old.id)
        new,token=amendments.issue_opening_replacement(self.db,old.id,start_date=date(2026,10,10),first_payment_date=None,notes=None,
            actor_id=self.admin.id,reviewed_document_hash=preview["document_hash"])
        self.db.commit();self.assertEqual(old.status,"cancelled")
        self.assertEqual(old.snapshot,old_snapshot);self.assertEqual(old.private_terms,old_private);self.assertEqual(old.document_hash,old_hash)
        for key in ("principal","monthly_rate_percent","savings_rate_percent","manager_fee_percent","manager_savings_rate_percent","additional_funds"):
            self.assertEqual(new.private_terms[key],old_private[key])
        with self.assertRaises(ValueError):agreements.by_token(self.db,old_token)
        self.assertEqual(new.snapshot["supersedes_agreement_id"],old.id);self.assertEqual(self.db.query(InvestmentPlan).count(),0)
        self.sign(new);self.assertEqual(self.db.get(InvestmentPlan,new.plan_id).first_payment_date,date(2026,11,10))

    def test_replacement_stale_or_failed_insert_keeps_original_pending_link(self):
        old,token=self.offer(date(2026,11,10))
        preview=amendments.opening_replacement_preview(self.db,old.id,date(2026,10,10))
        with self.assertRaisesRegex(ValueError,"תנאי ההצעה השתנו"):
            amendments.issue_opening_replacement(self.db,old.id,start_date=date(2026,10,11),first_payment_date=None,notes=None,
                actor_id=self.admin.id,reviewed_document_hash=preview["document_hash"])
        self.db.rollback();self.assertEqual(old.status,"pending")
        original_flush=self.db.flush
        def reject_new_agreement(*args,**kwargs):
            if any(isinstance(v,PlanAgreement) and v is not old for v in self.db.new):
                raise RuntimeError("synthetic insert failure")
            return original_flush(*args,**kwargs)
        with patch.object(self.db,"flush",side_effect=reject_new_agreement),self.assertRaisesRegex(RuntimeError,"insert failure"):
            amendments.issue_opening_replacement(self.db,old.id,start_date=date(2026,10,10),first_payment_date=None,notes=None,
                actor_id=self.admin.id,reviewed_document_hash=preview["document_hash"])
        self.db.rollback();self.assertEqual(old.status,"pending");self.assertEqual(agreements.by_token(self.db,token).id,old.id)

    def test_amendment_failure_rolls_back_dates_and_signature_status_together(self):
        plan,_=self.signed_legacy();row,_=self.amendment_offer(plan)
        before=[(p.id,p.due_date,p.status) for p in plan.payments]
        original_flush=self.db.flush
        def fail_changed_dates(*args,**kwargs):
            if any(isinstance(v,InvestmentPlan) and v.start_date==date(2026,10,10) for v in self.db.dirty):
                raise RuntimeError("synthetic amendment flush failure")
            return original_flush(*args,**kwargs)
        with patch.object(self.db,"flush",side_effect=fail_changed_dates),self.assertRaisesRegex(RuntimeError,"flush failure"):
            self.sign(row)
        self.db.rollback()
        self.assertEqual(plan.start_date,self.today);self.assertIsNone(plan.first_payment_date);self.assertEqual(row.status,"pending")
        self.assertEqual(before,[(p.id,p.due_date,p.status) for p in plan.payments]);self.assertIsNone(row.signature_png)

    def test_amendment_rejects_completed_savings_and_nonmonthly_first_date(self):
        plan,_=self.signed_legacy()
        with self.assertRaisesRegex(ValueError,"חודש לאחר"):
            amendments.date_amendment_preview(self.db,plan.id,date(2026,10,10),date(2026,11,11))
        with patch.object(amendments,"israel_today",return_value=date(2026,11,2)):
            with self.assertRaisesRegex(ValueError,"צבירת חיסכון"):
                amendments.date_amendment_preview(self.db,plan.id,date(2026,11,10))

    def test_explicit_later_first_date_and_invalid_date_do_not_move_money(self):
        row,_=self.offer(first_payment_date=date(2026,11,10))
        self.sign(row);plan=self.db.get(InvestmentPlan,row.plan_id)
        self.assertEqual(plan.payments[0].due_date,date(2026,11,10));self.assertEqual(plan.payments[1].due_date,date(2026,12,10))
        other=Investor(name="Another synthetic investor");self.db.add(other);self.db.commit()
        before=self.db.query(WalletEntry).count()
        with self.assertRaisesRegex(ValueError,"חודש לפחות"):
            wallet.fund_plan(self.db,self.data(investor_id=other.id,principal=1000,additional_funds=1000,first_payment_date=self.today),1000,"bad-date-funding",self.admin.id)
        self.assertEqual(other.available_balance_cents,0);self.assertEqual(self.db.query(WalletEntry).count(),before)

    def test_pending_amendment_freezes_payment_actions_but_keeps_old_debt_and_history(self):
        plan,_=self.signed_legacy();amendment,_=self.amendment_offer(plan)
        payment=plan.payments[0]
        self.assertTrue(svc.serialize_plan(plan)["date_amendment_pending"])
        self.assertTrue(svc.serialize_payment(payment)["date_amendment_pending"])
        for payload in ({"status":"paid"},{"status":"skipped"},{"investor_amount":1}):
            response=self.client.patch(f"/api/v1/investments/payments/{payment.id}",json=payload)
            self.assertEqual(response.status_code,409);self.assertIn("ממתין לחתימת",response.text)
        self.assertEqual(self.client.post(f"/api/v1/investments/plans/{plan.id}/regenerate-schedule").status_code,409)
        self.assertEqual(self.client.post("/api/v1/investments/sync-payment-amounts",params={"investor_id":self.investor.id}).status_code,409)
        with self.assertRaises(svc.PendingDateAmendmentError):svc.sync_payment_amounts(self.db,plan)
        self.db.rollback()
        self.current_user=self.user
        self.assertEqual(self.client.post(f"/api/v1/investments/payments/{payment.id}/confirm").status_code,409)
        self.current_user=self.admin
        old=InvestmentPlan(investor_id=self.investor.id,principal=10000,plan_type="monthly",monthly_rate_percent=1,
            manager_fee_percent=0,start_date=date(2025,1,1),duration_months=12,status="completed",closed_on=self.today)
        self.db.add(old);self.db.flush()
        debt=Payment(plan_id=old.id,investor_id=self.investor.id,month_number=10,due_date=date(2026,10,1),investor_amount=3800,status="scheduled")
        self.db.add(debt);self.db.commit()
        response=self.client.post("/api/v1/investments/payments/mark-year-paid",params={"year":2026,"investor_id":self.investor.id})
        self.assertEqual(response.status_code,409);self.assertEqual(debt.status,"scheduled");self.assertEqual(payment.status,"scheduled")
        self.assertEqual(self.client.patch(f"/api/v1/investments/payments/{debt.id}",json={"status":"paid"}).status_code,200)
        self.assertEqual(debt.status,"awaiting_confirmation");self.assertEqual(payment.investor_amount,2019)
        self.sign(amendment)
        self.assertFalse(svc.serialize_payment(payment)["date_amendment_pending"])
        self.assertEqual(payment.due_date,date(2026,11,10));self.assertEqual(payment.status,"scheduled")

    def test_cancelled_amendment_releases_freeze_without_rewriting_old_schedule(self):
        plan,_=self.signed_legacy();row,_=self.amendment_offer(plan)
        before=[p.due_date for p in plan.payments]
        response=self.client.post(f"/api/v1/investments/agreements/{row.id}/cancel")
        self.assertEqual(response.status_code,200)
        self.assertFalse(svc.serialize_plan(plan)["date_amendment_pending"])
        self.assertEqual([p.due_date for p in plan.payments],before)

    def test_startup_repair_is_opt_in_and_skips_disputed_dates_without_crashing(self):
        plan,_=self.signed_legacy();self.amendment_offer(plan)
        self.assertEqual(repair.run_configured_payment_timing_repairs(self.engine,""),[])
        self.assertEqual(repair.run_configured_payment_timing_repairs(self.engine,"invalid"),[])
        result=repair.run_configured_payment_timing_repairs(self.engine,str(plan.id))
        self.assertEqual(result[0]["conflicts"][0]["reason"],"pending_date_amendment_requires_signature")
        self.assertIsNone(plan.first_payment_date)

    def test_reporting_helper_cannot_open_parallel_active_or_paused_plan(self):
        plan=InvestmentPlan(investor_id=self.investor.id,principal=10000,plan_type="monthly",
            monthly_rate_percent=1,manager_fee_percent=0,start_date=date(2026,1,1),duration_months=12,status="active")
        self.db.add(plan);self.db.commit()
        for status in ("active","paused"):
            plan.status=status;self.db.commit()
            result=svc.open_calendar_year_plans(self.db,year=2027)
            self.assertEqual(result["created_count"],0)
            self.assertIn({"investor_id":self.investor.id,"reason":"current_plan_exists"},result["skipped"])
            self.assertEqual(self.db.query(InvestmentPlan).filter_by(investor_id=self.investor.id).count(),1)
        self.assertEqual(self.db.query(WalletEntry).count(),0)

    def test_reporting_helper_preserves_unsigned_history_but_never_copies_signed_terms(self):
        plan=InvestmentPlan(investor_id=self.investor.id,principal=10000,plan_type="monthly",
            monthly_rate_percent=1,manager_fee_percent=0,start_date=date(2025,1,1),duration_months=12,status="completed")
        self.db.add(plan);self.db.commit()
        result=svc.open_calendar_year_plans(self.db,year=2024)
        self.assertEqual(result["created_count"],1)
        historical=self.db.get(InvestmentPlan,result["created"][0]["plan_id"])
        self.assertEqual(historical.status,"completed");self.assertIsNone(historical.first_payment_date)
        self.assertEqual(len(historical.payments),12);self.assertEqual(historical.payments[0].due_date,date(2024,1,1))
        signed=PlanAgreement(investor_id=self.investor.id,plan_id=plan.id,kind="open",status="signed",
            snapshot={"terms":{}},private_terms={},token_hash="b"*64,document_hash="a"*64,
            actor_user_id=self.admin.id,notice_id=self.notice().id,signed_at=utcnow(),expires_at=utcnow())
        self.db.add(signed);self.db.commit()
        result=svc.open_calendar_year_plans(self.db,year=2027)
        self.assertEqual(result["created_count"],0)
        self.assertIn({"investor_id":self.investor.id,"reason":"signed_plan_requires_new_agreement"},result["skipped"])
        self.assertEqual(self.db.query(WalletEntry).count(),0)

    def test_bulk_rechecks_status_and_year_after_refresh_before_sending(self):
        row,_=self.offer();self.sign(row);plan=self.db.get(InvestmentPlan,row.plan_id)
        year_rows=sorted((p for p in plan.payments if p.due_date.year==2026),key=lambda p:p.month_number)
        self.assertEqual(len(year_rows),2)
        real_lock=wallet.lock_investor;changed=False
        def changed_before_lock(db,investor_id):
            nonlocal changed
            if not changed:
                # Reproduce rows changed since the batch SELECT while retaining
                # its stale identity-map objects until the real refresh guard.
                changed=True
                db.execute(text("UPDATE payments SET due_date='2027-01-10' WHERE id=:id"),{"id":year_rows[0].id})
                db.execute(text("UPDATE payments SET status='awaiting_confirmation' WHERE id=:id"),{"id":year_rows[1].id})
            return real_lock(db,investor_id)
        with patch.object(wallet,"lock_investor",side_effect=changed_before_lock),patch.object(svc,"_notify_payment_confirmation_request") as notify:
            result=svc.mark_year_payments_paid(self.db,year=2026,investor_id=self.investor.id,actor=self.admin)
        self.assertEqual(result["marked_count"],0);notify.assert_not_called()
        self.assertEqual(year_rows[0].status,"scheduled");self.assertEqual(year_rows[0].due_date,date(2027,1,10))
        self.assertEqual(year_rows[1].status,"awaiting_confirmation")

    @contextmanager
    def file_database(self):
        saved=(self.db,self.investor,self.admin,self.manager,self.user)
        with tempfile.TemporaryDirectory(prefix="tazrim-payment-policy-") as directory:
            engine=create_engine("sqlite:///"+str(Path(directory)/"test.db"),connect_args={"check_same_thread":False,"timeout":8})
            InvestmentBase.metadata.create_all(engine)
            with self.engine.connect() as source,engine.begin() as target:
                for table in InvestmentBase.metadata.sorted_tables:
                    rows=[dict(r._mapping) for r in source.execute(table.select())]
                    if rows:target.execute(table.insert(),rows)
            self.db=Session(engine,expire_on_commit=False)
            self.investor=self.db.get(Investor,saved[1].id);self.admin=self.db.get(User,saved[2].id)
            self.manager=self.db.get(User,saved[3].id);self.user=self.db.get(User,saved[4].id)
            try:yield engine
            finally:
                self.db.close();engine.dispose()
                self.db,self.investor,self.admin,self.manager,self.user=saved

    def test_concurrent_paid_update_blocks_amendment_after_writer_commits(self):
        with self.file_database() as engine:
            plan,_=self.signed_legacy();row,_=self.amendment_offer(plan)
            paid_locked=threading.Event();release_paid=threading.Event();sign_started=threading.Event();results=[]
            payment_id=plan.payments[0].id;agreement_id=row.id
            def payer():
                with Session(engine) as db:
                    payment=db.get(Payment,payment_id);payment.status="paid";payment.paid_at=self.today
                    db.flush();paid_locked.set();release_paid.wait(3);db.commit();results.append("paid")
            def signer():
                with Session(engine) as db:
                    agreement=db.get(PlanAgreement,agreement_id);sign_started.set()
                    try:
                        agreements.sign(db,agreement,name="Synthetic signer",signature=PNG,accepted=True,document_hash=agreement.document_hash)
                        db.commit();results.append("unexpected_signed")
                    except ValueError as exc:
                        db.rollback();results.append(str(exc))
            one=threading.Thread(target=payer);two=threading.Thread(target=signer)
            one.start();self.assertTrue(paid_locked.wait(3));two.start();self.assertTrue(sign_started.wait(3));release_paid.set()
            one.join(5);two.join(5);self.assertFalse(one.is_alive());self.assertFalse(two.is_alive())
            self.assertIn("paid",results);self.assertTrue(any("תשלום או שליחת" in value for value in results))
            self.db.expire_all();self.assertEqual(self.db.get(PlanAgreement,agreement_id).status,"pending")
            self.assertEqual(self.db.get(InvestmentPlan,plan.id).start_date,self.today)

    def test_concurrent_legacy_pending_signatures_create_only_one_current_plan(self):
        with self.file_database() as engine:
            first,_=self.offer()
            second=PlanAgreement(investor_id=self.investor.id,kind="open",status="pending",snapshot=copy.deepcopy(first.snapshot),
                private_terms=copy.deepcopy(first.private_terms),token_hash="f"*64,document_hash=first.document_hash,
                actor_user_id=self.admin.id,notice_id=first.notice_id,expires_at=first.expires_at)
            self.db.add(second);self.db.commit()
            barrier=threading.Barrier(2);results=[]
            def sign_one(agreement_id):
                with Session(engine) as db:
                    row=db.get(PlanAgreement,agreement_id);barrier.wait(3)
                    try:
                        agreements.sign(db,row,name="Synthetic signer",signature=PNG,accepted=True,document_hash=row.document_hash)
                        db.commit();results.append("signed")
                    except ValueError as exc:
                        db.rollback();results.append(str(exc))
            threads=[threading.Thread(target=sign_one,args=(row.id,)) for row in (first,second)]
            for thread in threads:thread.start()
            for thread in threads:thread.join(6);self.assertFalse(thread.is_alive())
            self.assertEqual(results.count("signed"),1);self.assertTrue(any("כבר קיים מסלול" in value for value in results))
            self.db.expire_all();self.assertEqual(self.db.query(InvestmentPlan).count(),1)
            self.assertEqual(self.db.query(WalletEntry).filter(WalletEntry.operation_type=="plan_funding").count(),1)
            self.assertEqual(self.db.get(Investor,self.investor.id).available_balance_cents,0)


if __name__ == "__main__": unittest.main()
