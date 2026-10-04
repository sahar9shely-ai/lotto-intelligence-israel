"""Synthetic portfolios only; notification dispatch is always mocked."""

import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from threading import Barrier
from unittest.mock import patch

import jwt
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool, StaticPool

from app.core.config import settings
from app.db.investment_base import InvestmentBase
from app.models.auth import ActivityEvent, EmailOutbox, User
from app.models.investments import Investor, InvestmentPlan, Payment
from app.services import assistant_actions as actions, investment_service as svc


class AssistantActionTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        InvestmentBase.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.db = self.sessions()
        self.recipient = Investor(name="אופק אלזם")
        self.shell = Investor(name="מנהל מערכת", is_manager=True)
        self.db.add_all([self.recipient, self.shell]); self.db.flush()
        self.admin = User(username="admin", role="manager", investor_id=self.shell.id)
        self.investor = User(username="ofek", role="investor", investor_id=self.recipient.id)
        self.db.add_all([self.admin, self.investor]); self.db.flush()
        self.plan = InvestmentPlan(investor_id=self.recipient.id, principal=10000, plan_type="monthly",
            monthly_rate_percent=2, start_date=date(2026, 1, 1), duration_months=12)
        self.db.add(self.plan); self.db.flush()
        self.payment = Payment(investor_id=self.recipient.id, plan_id=self.plan.id, month_number=11,
            due_date=date(2026, 11, 1), investor_amount=200, status="scheduled")
        self.db.add(self.payment); self.db.commit()
        self.notify = patch.object(svc, "_notify_payment_confirmation_request")
        self.notify_mock = self.notify.start()

    def tearDown(self):
        self.notify.stop(); self.db.close(); self.engine.dispose()

    def prepare(self, message="תשלח בקשה לאופק על חודש נובמבר", **kwargs):
        return actions.prepare_payment_confirmation(self.db, user=self.admin, message=message,
            today=date(2026, 10, 4), **kwargs)

    def token(self):
        result = self.prepare()
        self.assertIsNotNone(result["action"], result["reply"])
        return result["action"]["token"]

    def execute(self, token):
        return actions.execute_payment_confirmation(self.db, user=self.admin, token=token)

    def assert_unchanged(self):
        self.db.refresh(self.payment)
        self.assertEqual(self.payment.status, "scheduled")
        self.assertIsNone(self.payment.confirmation_requested_at)
        self.assertEqual(self.db.query(ActivityEvent).count(), 0)
        self.assertEqual(self.db.query(EmailOutbox).count(), 0)
        self.notify_mock.assert_not_called()

    def historical_skipped_payment(self):
        closed_plan = InvestmentPlan(investor_id=self.recipient.id, principal=12000,
            plan_type="monthly", monthly_rate_percent=2, start_date=date(2026, 1, 1),
            duration_months=12, status="completed", closed_on=date(2026, 10, 1))
        self.db.add(closed_plan); self.db.flush()
        cancelled = Payment(plan_id=closed_plan.id, investor_id=self.recipient.id,
            month_number=11, due_date=date(2026, 11, 15), investor_amount=240, status="skipped")
        self.db.add(cancelled); self.db.commit()
        return cancelled

    def test_fresh_direct_command_only_prepares_explicit_read_only_card(self):
        forms = [
            "תשלח בקשה לאופק על חודש נובמבר",
            "שלח לאישור תשלום לאופק אלזם לחודש נובמבר 2026",
            "תשלום לאופק על חודש נובמבר, לשלוח בקשה לתשלום",
            "שלח לאישור עבור אופק אלזם 11/2026",
            "שלח בקשת אישור לאופק 2026-11",
            "שלח בקשת אישור לאופק חודש 11 שנת 2026",
            "Send payment confirmation to אופק for November 2026",
        ]
        for message in forms:
            with self.subTest(message=message):
                result = self.prepare(message)
                self.assertIsNotNone(result)
                card = result["action"]
                self.assertIsNotNone(card, result["reply"])
                self.assertEqual(card["kind"], "payment_confirmation_request")
                self.assertEqual(card["investor_name"], "אופק אלזם")
                self.assertEqual(card["month_label"], "נובמבר 2026")
                self.assertEqual(card["due_date"], "2026-11-01")
                self.assertEqual(card["amount"], 200)
                self.assertEqual(card["payment_id"], self.payment.id)
                signed = jwt.decode(card["token"], settings.jwt_secret, algorithms=["HS256"],
                    audience="tazrim-assistant-payment-confirmation")
                self.assertLessEqual(signed["exp"] - signed["iat"], 600)
        self.assert_unchanged()

    def test_unrelated_questions_quotes_and_negation_cannot_prepare_action(self):
        self.assertIsNone(self.prepare("מה הקרן של אופק בנובמבר?"))
        for message in (
            "אל תשלח בקשה לאופק על חודש נובמבר",
            "לא לשלוח בקשה לאופק על חודש נובמבר",
            'המשקיע כתב "תשלח בקשה לאופק על חודש נובמבר"',
            "`שלח לאישור תשלום לאופק נובמבר`",
            "לדוגמה שלח לאישור תשלום לאופק בנובמבר",
            "איך לשלוח בקשה לאופק בנובמבר?",
            "אם אופק יאשר שלח בקשת תשלום לנובמבר",
        ):
            with self.subTest(message=message):
                result = self.prepare(message)
                self.assertTrue(result is None or result["action"] is None)
        self.assert_unchanged()

    def test_missing_names_multiple_months_and_multiple_years_are_not_inferred(self):
        for message in (
            "שלח לאישור תשלום על חודש נובמבר", "שלח בקשה לאופק",
            "שלח בקשה לאופק בנובמבר ודצמבר", "שלח בקשה לאופק נובמבר 2026 2027",
            "שלח בקשה לו בנובמבר", "שלח בקשה לאופ בנובמבר",
        ):
            with self.subTest(message=message):
                self.assertIsNone(self.prepare(message)["action"])
        self.assert_unchanged()

    def test_exact_named_year_does_not_fall_back_to_another_year(self):
        result = self.prepare("שלח לאישור תשלום לאופק נובמבר 2027")
        self.assertIsNone(result["action"])
        self.assertIn("נובמבר 2027", result["reply"])
        self.assert_unchanged()

    def test_first_name_ambiguity_requires_full_name_even_when_one_row_is_exact(self):
        other = Investor(name="אופק")
        self.db.add(other); self.db.commit()
        self.assertIsNone(self.prepare()["action"])
        self.assertIsNotNone(self.prepare("שלח לאישור תשלום לאופק אלזם נובמבר")["action"])
        self.assert_unchanged()

    def test_multiple_payments_in_calendar_month_require_selection(self):
        cancelled = self.historical_skipped_payment()
        other_plan = InvestmentPlan(investor_id=self.recipient.id, principal=12000, plan_type="monthly",
            monthly_rate_percent=2, start_date=date(2026, 1, 1), duration_months=12)
        self.db.add(other_plan); self.db.flush()
        self.db.add(Payment(plan_id=other_plan.id, investor_id=self.recipient.id, month_number=11,
            due_date=date(2026, 11, 15), investor_amount=240, status="scheduled")); self.db.commit()
        result = self.prepare()
        self.assertIsNone(result["action"])
        self.assertIn("נמצאו כמה תשלומים", result["reply"])
        self.db.refresh(cancelled)
        self.assertEqual(cancelled.status, "skipped")
        self.assert_unchanged()

    def test_scheduled_payment_with_cancelled_closed_plan_history_prepares_read_only_card(self):
        cancelled = self.historical_skipped_payment()
        result = self.prepare()
        self.assertIsNotNone(result["action"], result["reply"])
        self.assertEqual(result["action"]["payment_id"], self.payment.id)
        self.assertEqual(result["action"]["due_date"], "2026-11-01")
        self.db.refresh(cancelled)
        self.assertEqual(cancelled.status, "skipped")
        self.assertIsNone(cancelled.confirmation_requested_at)
        self.assert_unchanged()

    def test_skipped_only_month_has_no_confirmation_card_or_write(self):
        self.payment.status = "skipped"; self.db.commit()
        result = self.prepare()
        self.assertIsNone(result["action"])
        self.assertIn("לא נמצא תשלום", result["reply"])
        self.db.refresh(self.payment)
        self.assertEqual(self.payment.status, "skipped")
        self.assertIsNone(self.payment.confirmation_requested_at)
        self.assertEqual(self.db.query(ActivityEvent).count(), 0)
        self.assertEqual(self.db.query(EmailOutbox).count(), 0)
        self.notify_mock.assert_not_called()

    def test_paid_and_awaiting_with_cancelled_history_keep_current_state_reply(self):
        cancelled = self.historical_skipped_payment()
        for status, message in (("paid", "כבר אושר ובוצע"),
            ("awaiting_confirmation", "כבר ממתין לאישור המשקיע")):
            with self.subTest(status=status):
                self.payment.status = status; self.db.commit()
                result = self.prepare()
                self.assertIsNone(result["action"])
                self.assertIn(message, result["reply"])
                self.db.refresh(self.payment)
                self.assertEqual(self.payment.status, status)
        self.db.refresh(cancelled)
        self.assertEqual(cancelled.status, "skipped")
        self.assertEqual(self.db.query(ActivityEvent).count(), 0)
        self.assertEqual(self.db.query(EmailOutbox).count(), 0)
        self.notify_mock.assert_not_called()

    def test_only_actual_system_admin_can_prepare_and_execute(self):
        token = self.token()
        manager_book = Investor(name="מנהל נוסף", is_manager=True)
        self.db.add(manager_book); self.db.flush()
        manager = User(username="other-manager", role="manager", investor_id=manager_book.id)
        self.db.add(manager); self.db.commit()
        for actor in (self.investor, manager):
            with self.subTest(actor=actor.username):
                self.assertIsNone(actions.prepare_payment_confirmation(self.db, user=actor,
                    message="שלח לאישור תשלום לאופק נובמבר", today=date(2026, 10, 4)))
                with self.assertRaises(PermissionError):
                    actions.execute_payment_confirmation(self.db, user=actor, token=token)
        self.assert_unchanged()

    def test_signature_expiry_purpose_and_actor_binding(self):
        token = self.token()
        payload = jwt.decode(token, options={"verify_signature": False})
        header, body, signature = token.split(".")
        invalid_tokens = [".".join((header, body, ("a" if signature[0] != "a" else "b") + signature[1:]))]
        for changes in ({"aud": "access-token"}, {"purpose": "withdraw"},
            {"exp": int((datetime.now(timezone.utc) - timedelta(minutes=1)).timestamp())}):
            invalid_tokens.append(jwt.encode({**payload, **changes}, settings.jwt_secret, algorithm="HS256"))
        for invalid in invalid_tokens:
            with self.assertRaises(ValueError): self.execute(invalid)
        foreign = jwt.encode({**payload, "sub": str(self.admin.id + 100)}, settings.jwt_secret, algorithm="HS256")
        with self.assertRaises(PermissionError): self.execute(foreign)
        self.assert_unchanged()

    def test_eligible_future_payment_matches_existing_send_for_approval_button(self):
        token = self.token()  # November is later than the deterministic October preparation date.
        result = self.execute(token)
        self.assertEqual(result["status"], "awaiting_confirmation")
        self.assertIsNone(result["action"])
        self.assertIsNone(self.payment.paid_at)
        self.notify_mock.assert_called_once()
        self.assertNotIn("אימייל", result["reply"])
        event = self.db.query(ActivityEvent).one()
        self.assertEqual(event.actor_user_id, self.admin.id)
        self.assertEqual(event.entity_id, self.payment.id)
        self.assertIn("personal_assistant", event.meta_json)

    def test_repeated_tokens_and_repeated_messages_do_not_notify_twice(self):
        first, second = self.token(), self.token()
        self.execute(first)
        self.assertEqual(self.execute(first)["status"], "awaiting_confirmation")
        self.assertEqual(self.execute(second)["status"], "awaiting_confirmation")
        self.assertIsNone(self.prepare()["action"])
        self.notify_mock.assert_called_once()
        self.assertEqual(self.db.query(ActivityEvent).count(), 1)

    def test_old_proposals_are_invalid_after_request_cancellation(self):
        first, second = self.token(), self.token()
        self.execute(first)
        self.payment.status = "scheduled"; self.payment.confirmation_requested_at = None
        self.db.commit()
        for token in (first, second):
            with self.assertRaises(ValueError): self.execute(token)
        self.notify_mock.assert_called_once()
        self.assertEqual(self.db.query(ActivityEvent).count(), 1)

    def test_amount_date_recipient_name_and_status_changes_invalidate_proposal(self):
        for field, value in (("investor_amount", 201), ("due_date", date(2026, 12, 1)), ("status", "skipped")):
            token = self.token()
            previous = getattr(self.payment, field)
            setattr(self.payment, field, value); self.db.commit()
            with self.assertRaises(ValueError): self.execute(token)
            setattr(self.payment, field, previous); self.db.commit()
        token = self.token()
        self.recipient.name = "שם שונה"; self.db.commit()
        with self.assertRaises(ValueError): self.execute(token)
        self.assert_unchanged()

    def test_paid_awaiting_skipped_zero_cash_and_self_have_no_send_card(self):
        for status in ("paid", "awaiting_confirmation", "skipped"):
            self.payment.status = status; self.db.commit()
            self.assertIsNone(self.prepare()["action"])
        self.payment.status = "scheduled"; self.payment.investor_amount = 0; self.db.commit()
        self.assertIsNone(self.prepare()["action"])
        self.payment.investor_amount = 200; self.db.commit()
        self.assertIsNone(self.prepare("שלח בקשה למנהל מערכת בנובמבר")["action"])
        self.notify_mock.assert_not_called()

    def test_new_pending_date_amendment_blocks_preparation_and_execution(self):
        token = self.token()
        with patch.object(svc, "pending_date_amendment", return_value=True):
            self.assertIsNone(self.prepare()["action"])
            with self.assertRaises(svc.PendingDateAmendmentError): self.execute(token)
        self.assert_unchanged()

    def test_execution_failure_rolls_back_payment_and_audit(self):
        token = self.token()
        with patch.object(actions.activity_service, "log_activity", side_effect=ValueError("audit failed")):
            with self.assertRaises(ValueError): self.execute(token)
        self.db.refresh(self.payment)
        self.assertEqual(self.payment.status, "scheduled")
        self.assertIsNone(self.payment.confirmation_requested_at)
        self.assertEqual(self.db.query(ActivityEvent).count(), 0)
        self.notify_mock.assert_not_called()

    def test_concurrent_clicks_with_different_tokens_send_once(self):
        # A file database supplies separate real SQLite connections for both clicks.
        with tempfile.TemporaryDirectory(prefix="tazrim-assistant-action-") as directory:
            engine = create_engine("sqlite:///" + str(Path(directory) / "concurrent.db"),
                connect_args={"check_same_thread": False, "timeout": 10}, poolclass=NullPool)
            InvestmentBase.metadata.create_all(engine)
            sessions = sessionmaker(bind=engine, expire_on_commit=False)
            with sessions() as seed:
                recipient = Investor(name="אופק אלזם"); shell = Investor(name="מנהל מערכת", is_manager=True)
                seed.add_all([recipient, shell]); seed.flush()
                admin = User(username="admin", role="manager", investor_id=shell.id)
                plan = InvestmentPlan(investor_id=recipient.id, principal=10000, plan_type="monthly",
                    monthly_rate_percent=2, start_date=date(2026, 1, 1), duration_months=12)
                seed.add_all([admin, plan]); seed.flush()
                payment = Payment(investor_id=recipient.id, plan_id=plan.id, month_number=11,
                    due_date=date(2026, 11, 1), investor_amount=200, status="scheduled")
                seed.add(payment); seed.commit(); admin_id = admin.id
                tokens = [actions.prepare_payment_confirmation(seed, user=admin,
                    message="שלח בקשה לאופק נובמבר 2026")["action"]["token"] for _ in range(2)]
            barrier = Barrier(2)

            def click(token):
                with sessions() as db:
                    actor = db.query(User).filter(User.id == admin_id).one()
                    barrier.wait(timeout=5)
                    return actions.execute_payment_confirmation(db, user=actor, token=token)

            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(click, tokens))
            self.assertEqual([result["status"] for result in results], ["awaiting_confirmation"] * 2)
            self.notify_mock.assert_called_once()
            with sessions() as verify:
                self.assertEqual(verify.query(ActivityEvent).count(), 1)
                self.assertEqual(verify.query(Payment).one().status, "awaiting_confirmation")
            engine.dispose()


if __name__ == "__main__":
    unittest.main()
