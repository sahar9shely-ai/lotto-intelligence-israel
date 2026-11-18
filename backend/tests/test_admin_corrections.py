"""Admin corrections: every undo keeps history, logs activity and never changes other figures."""
import unittest
from datetime import date, timedelta
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.agreements import router as agreements_router
from app.api.v1.corrections import router as corrections_router
from app.api.v1.investments import router as investments_router
from app.db.investment_base import InvestmentBase
from app.db.investment_session import get_investment_db
from app.models.auth import ActivityEvent, User
from app.models.investments import Investor, InvestmentPlan, Payment, PlanAgreement, PlanNotice, WalletEntry
from app.security.auth import get_current_user
from app.services import investment_service as svc

TODAY = date(2026, 11, 18)


def sqlite_engine():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    return engine


class AdminCorrectionsTests(unittest.TestCase):
    def setUp(self):
        self.engine = sqlite_engine()
        InvestmentBase.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine, expire_on_commit=False)()
        self.alice = Investor(name="Synthetic Alice", available_balance_cents=0)
        self.bob = Investor(name="Synthetic Bob", available_balance_cents=0)
        self.shell = Investor(name="מנהל מערכת", is_manager=True)
        self.helper_book = Investor(name="Synthetic helper", is_manager=True)
        self.db.add_all([self.alice, self.bob, self.shell, self.helper_book]); self.db.flush()
        self.admin = User(username="admin", role="manager", investor_id=self.shell.id)
        self.helper = User(username="helper", role="manager", investor_id=self.helper_book.id)
        self.alice_user = User(username="alice", role="investor", investor_id=self.alice.id)
        self.db.add_all([self.admin, self.helper, self.alice_user]); self.db.commit()
        self.current_user = self.admin
        app = FastAPI()
        for router in (investments_router, agreements_router, corrections_router):
            app.include_router(router)
        app.dependency_overrides[get_current_user] = lambda: self.current_user
        app.dependency_overrides[get_investment_db] = lambda: self.db
        self.client = TestClient(app)
        self.today = patch.object(svc, "israel_today", return_value=TODAY)
        self.today.start()

    def tearDown(self):
        self.today.stop()
        self.client.close(); self.db.close(); self.engine.dispose()

    # helpers -------------------------------------------------------------
    def balance(self, investor):
        self.db.expire_all()
        return self.db.get(Investor, investor.id).available_balance_cents

    def deposit(self, investor, amount, key):
        r = self.client.post(f"/api/v1/investments/investors/{investor.id}/wallet/deposit",
                             json={"amount": amount, "operation_key": key})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()["id"]

    def reverse(self, investor, entry_id, reason="נרשם בטעות"):
        return self.client.post(f"/api/v1/investments/investors/{investor.id}/wallet/entries/{entry_id}/reverse",
                                json={"reason": reason})

    def kinds(self):
        return [row.kind for row in self.db.query(ActivityEvent).order_by(ActivityEvent.id).all()]

    def open_agreement(self, investor, principal=1000):
        r = self.client.post("/api/v1/investments/agreements/open", json={
            "investor_id": investor.id, "principal": principal, "additional_funds": principal - self.balance(investor) / 100,
            "plan_type": "monthly", "monthly_rate_percent": 1.5, "savings_rate_percent": 0,
            "manager_fee_percent": 0.5, "start_date": (TODAY + timedelta(days=5)).isoformat(), "duration_months": 12,
            "notice_requested_on": TODAY.isoformat()})
        self.assertEqual(r.status_code, 201, r.text)
        return r.json()

    # wallet --------------------------------------------------------------
    def test_deposit_reversal_restores_balance_once_and_keeps_history(self):
        entry = self.deposit(self.alice, 1500.25, "deposit-key-0001")
        self.assertEqual(self.balance(self.alice), 150025)
        r = self.reverse(self.alice, entry)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.balance(self.alice), 0)
        self.assertEqual(self.reverse(self.alice, entry).status_code, 409)
        self.assertEqual(self.balance(self.alice), 0)
        rows = self.db.query(WalletEntry).order_by(WalletEntry.id).all()
        self.assertEqual([(r.operation_type, r.amount_cents) for r in rows], [("deposit", 150025), ("deposit_reversal", -150025)])
        self.assertEqual(rows[1].admin_notes, "נרשם בטעות")
        self.assertIn("wallet_deposit", self.kinds())
        self.assertIn("wallet_reversal", self.kinds())
        history = self.client.get(f"/api/v1/investments/investors/{self.alice.id}/wallet").json()
        original = next(e for e in history["entries"] if e["id"] == entry)
        self.assertTrue(original["reversed"]); self.assertFalse(original["reversible"])

    def test_deposit_reversal_refused_when_money_already_left_the_balance(self):
        entry = self.deposit(self.alice, 1000, "deposit-key-0002")
        self.db.add(PlanNotice(investor_id=self.alice.id, purpose="withdraw", requested_on=TODAY - timedelta(days=40), actor_user_id=self.admin.id))
        self.db.commit()
        r = self.client.post(f"/api/v1/investments/investors/{self.alice.id}/wallet/withdraw",
                             json={"amount": 600, "operation_key": "withdraw-key-0001"})
        self.assertEqual(r.status_code, 200, r.text)
        r = self.reverse(self.alice, entry)
        self.assertEqual(r.status_code, 409)
        self.assertEqual(self.balance(self.alice), 40000)
        withdrawal = self.db.query(WalletEntry).filter_by(operation_type="withdraw").one()
        self.assertEqual(self.reverse(self.alice, withdrawal.id).status_code, 200)
        self.assertEqual(self.balance(self.alice), 100000)

    def test_transfer_reversal_moves_money_back_and_is_blocked_if_recipient_spent_it(self):
        self.deposit(self.alice, 1000, "deposit-key-0003")
        r = self.client.post(f"/api/v1/investments/investors/{self.alice.id}/wallet/transfer", json={
            "recipient_investor_id": self.bob.id, "amount": "400.00", "operation_key": "transfer-key-0001",
            "request_confirmed": True, "expected_source_balance": "1000.00"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIn("wallet_transfer", self.kinds())
        out_row = self.db.query(WalletEntry).filter_by(operation_type="transfer_out").one()
        r = self.reverse(self.alice, out_row.id)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual((self.balance(self.alice), self.balance(self.bob)), (100000, 0))
        self.assertEqual(self.reverse(self.alice, out_row.id).status_code, 409)

    def test_reversal_blocked_by_pending_opening_agreement_and_signed_flows(self):
        entry = self.deposit(self.alice, 1000, "deposit-key-0004")
        agreement = self.open_agreement(self.alice, principal=1000)
        r = self.reverse(self.alice, entry)
        self.assertEqual(r.status_code, 409)
        self.assertIn("הסכם פתיחה", r.json()["detail"])
        self.assertEqual(self.balance(self.alice), 100000)
        self.assertEqual(self.client.post(f"/api/v1/investments/agreements/{agreement['id']}/cancel", json={"reason": "טעות"}).status_code, 200)
        self.assertIn("agreement_cancelled", self.kinds())
        self.assertEqual(self.reverse(self.alice, entry).status_code, 200)

    def test_only_system_admin_can_reverse(self):
        entry = self.deposit(self.alice, 100, "deposit-key-0005")
        self.current_user = self.helper
        self.assertEqual(self.reverse(self.alice, entry).status_code, 403)
        self.current_user = self.alice_user
        self.assertEqual(self.reverse(self.alice, entry).status_code, 403)
        self.assertEqual(self.balance(self.alice), 10000)

    def test_withdrawal_with_too_recent_request_records_nothing(self):
        self.deposit(self.alice, 500, "deposit-key-0006")
        r = self.client.post(f"/api/v1/investments/investors/{self.alice.id}/wallet/withdraw", json={
            "amount": 100, "operation_key": "withdraw-key-0002", "requested_on": (TODAY - timedelta(days=3)).isoformat()})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(self.db.query(PlanNotice).count(), 0)
        self.assertEqual(self.balance(self.alice), 50000)
        r = self.client.post(f"/api/v1/investments/investors/{self.alice.id}/wallet/withdraw", json={
            "amount": 100, "operation_key": "withdraw-key-0003", "requested_on": (TODAY - timedelta(days=45)).isoformat()})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.db.query(PlanNotice).count(), 1)
        self.assertEqual(self.balance(self.alice), 40000)

    # notices and agreements ----------------------------------------------
    def test_notice_cancel_rules(self):
        r = self.client.post(f"/api/v1/investments/investors/{self.bob.id}/notices", json={"purpose": "new"})
        notice_id = r.json()["id"]
        agreement = self.client.post("/api/v1/investments/agreements/open", json={
            "investor_id": self.bob.id, "notice_id": notice_id, "principal": 2000, "additional_funds": 2000,
            "plan_type": "monthly", "monthly_rate_percent": 1, "manager_fee_percent": 0,
            "start_date": TODAY.isoformat(), "duration_months": 6}).json()
        r = self.client.post(f"/api/v1/investments/investors/{self.bob.id}/notices/{notice_id}/cancel", json={})
        self.assertEqual(r.status_code, 409)
        self.client.post(f"/api/v1/investments/agreements/{agreement['id']}/cancel")
        r = self.client.post(f"/api/v1/investments/investors/{self.bob.id}/notices/{notice_id}/cancel", json={"reason": "נרשם בטעות"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIsNotNone(r.json()["cancelled_at"])
        self.assertIsNotNone(self.db.get(PlanNotice, notice_id))  # kept, not deleted
        reuse = self.client.post("/api/v1/investments/agreements/open", json={
            "investor_id": self.bob.id, "notice_id": notice_id, "principal": 2000, "additional_funds": 2000,
            "plan_type": "monthly", "monthly_rate_percent": 1, "manager_fee_percent": 0,
            "start_date": TODAY.isoformat(), "duration_months": 6})
        self.assertEqual(reuse.status_code, 409)
        self.assertIn("notice_cancelled", self.kinds())

    def test_failed_opening_leaves_no_notice_behind(self):
        r = self.client.post("/api/v1/investments/agreements/open", json={
            "investor_id": self.bob.id, "principal": 2000, "additional_funds": 1000,  # mismatch on purpose
            "plan_type": "monthly", "monthly_rate_percent": 1, "manager_fee_percent": 0,
            "start_date": TODAY.isoformat(), "duration_months": 6, "notice_requested_on": TODAY.isoformat()})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(self.db.query(PlanNotice).count(), 0)
        self.assertEqual(self.db.query(PlanAgreement).count(), 0)

    def test_admin_revises_pending_opening_terms_before_signature(self):
        first = self.open_agreement(self.bob, principal=5000)
        self.assertEqual(first["private_terms"]["manager_fee_percent"], 0.5)
        r = self.client.post(f"/api/v1/investments/agreements/{first['id']}/revise", json={
            "investor_id": self.bob.id, "principal": 7000, "additional_funds": 7000, "plan_type": "monthly",
            "monthly_rate_percent": 1.2, "savings_rate_percent": 0, "manager_fee_percent": 0.4,
            "start_date": (TODAY + timedelta(days=7)).isoformat(), "duration_months": 24,
            "revision_notes": "סכום מעודכן לפי שיחה"})
        self.assertEqual(r.status_code, 201, r.text)
        second = r.json()
        self.assertEqual(second["snapshot"]["terms"]["principal"], 7000)
        self.assertEqual(second["snapshot"]["supersedes_agreement_id"], first["id"])
        self.db.expire_all()
        self.assertEqual(self.db.get(PlanAgreement, first["id"]).status, "cancelled")
        self.assertEqual(self.db.query(InvestmentPlan).count(), 0)  # nothing executed before signature
        self.assertEqual(self.balance(self.bob), 0)
        self.assertIn("agreement_revised", self.kinds())
        self.current_user = self.helper
        self.assertEqual(self.client.post(f"/api/v1/investments/agreements/{second['id']}/revise", json={
            "investor_id": self.bob.id, "principal": 1, "plan_type": "monthly", "manager_fee_percent": 0,
            "start_date": TODAY.isoformat()}).status_code, 403)

    # payments ------------------------------------------------------------
    def make_plan(self, *, closed=False):
        plan = InvestmentPlan(investor_id=self.alice.id, principal=10000, accrual_principal=10000, plan_type="monthly",
                              monthly_rate_percent=1, manager_fee_percent=0, start_date=date(2026, 1, 1), duration_months=12,
                              status="completed" if closed else "active", closed_on=date(2026, 10, 1) if closed else None)
        self.db.add(plan); self.db.flush()
        payment = Payment(plan_id=plan.id, investor_id=self.alice.id, month_number=1, due_date=date(2026, 2, 1),
                          investor_amount=100, manager_amount=0, status="paid", paid_at=date(2026, 2, 1))
        self.db.add(payment); self.db.commit()
        return plan, payment

    def test_reverting_confirmed_payment_is_logged(self):
        _, payment = self.make_plan()
        r = self.client.patch(f"/api/v1/investments/payments/{payment.id}", json={"status": "scheduled"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["status"], "scheduled")
        self.assertIn("payment_status_reverted", self.kinds())

    def test_closed_plan_payments_are_history(self):
        _, payment = self.make_plan(closed=True)
        r = self.client.patch(f"/api/v1/investments/payments/{payment.id}", json={"status": "scheduled"})
        self.assertEqual(r.status_code, 409)
        self.db.expire_all()
        self.assertEqual(self.db.get(Payment, payment.id).status, "paid")

    def test_corrections_hub_lists_undoable_items(self):
        self.deposit(self.alice, 250, "deposit-key-0007")
        self.open_agreement(self.bob, principal=3000)
        self.make_plan()
        data = self.client.get("/api/v1/investments/admin/corrections").json()
        self.assertTrue(data["is_system_admin"])
        self.assertEqual([row["type"] for row in data["wallet"]], ["deposit"])
        self.assertTrue(data["wallet"][0]["reversible"])
        self.assertEqual(len(data["agreements"]), 1)
        self.assertTrue(data["agreements"][0]["can_revise"])
        self.assertEqual(len(data["confirmed_payments"]), 0)  # paid in February: outside the recent window
        self.current_user = self.alice_user
        self.assertEqual(self.client.get("/api/v1/investments/admin/corrections").status_code, 403)

    # integrity ----------------------------------------------------------
    def test_integrity_check_reports_without_changing_anything(self):
        self.deposit(self.alice, 300, "deposit-key-0008")
        plan, _ = self.make_plan()
        self.db.add(Payment(plan_id=plan.id, investor_id=self.alice.id, month_number=2, due_date=date(2026, 3, 1),
                            investor_amount=100, manager_amount=0, status="scheduled"))
        self.db.commit()
        clean = self.client.get("/api/v1/investments/admin/integrity").json()
        self.assertEqual(clean["errors"], 0, clean["issues"])
        # Simulate drift: balance and an open payment no longer match their sources.
        self.db.get(Investor, self.alice.id).available_balance_cents = 99999
        self.db.query(Payment).filter_by(month_number=2).one().investor_amount = 123
        self.db.commit()
        report = self.client.get("/api/v1/investments/admin/integrity").json()
        areas = sorted(row["area"] for row in report["issues"] if row["severity"] == "error")
        self.assertEqual(areas, ["יתרה זמינה", "תשלומים"])
        self.db.expire_all()
        self.assertEqual(self.db.get(Investor, self.alice.id).available_balance_cents, 99999)  # untouched
        self.current_user = self.alice_user
        self.assertEqual(self.client.get("/api/v1/investments/admin/integrity").status_code, 403)


if __name__ == "__main__":
    unittest.main()
