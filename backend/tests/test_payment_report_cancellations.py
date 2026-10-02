"""Cancelled schedules stay auditable without inflating payable summaries."""
import unittest
from datetime import date
from types import SimpleNamespace

from app.services import investment_service as svc
import test_wallet_business as helpers


class PaymentReportCancellationTests(unittest.TestCase):
    def test_totals_keep_paid_and_unpaid_debt_but_exclude_cancelled_rows(self):
        rows = [
            SimpleNamespace(status="paid", investor_amount=5000, manager_amount=600),
            SimpleNamespace(status="scheduled", investor_amount=5000, manager_amount=600),
            SimpleNamespace(status="awaiting_confirmation", investor_amount=2658.01, manager_amount=100),
            SimpleNamespace(status="skipped", investor_amount=5000, manager_amount=600),
            SimpleNamespace(status="skipped", investor_amount=5000, manager_amount=600),
        ]
        report = svc._payment_totals(rows)
        self.assertEqual(report["planned_investor"], 12658.01)
        self.assertEqual(report["planned_manager"], 1300)
        self.assertEqual(report["paid_investor"], 5000)
        self.assertEqual(report["paid_count"], 1)
        self.assertEqual(report["skipped_count"], 2)
        self.assertEqual(report["total_count"], 5)
        self.assertEqual(rows[-1].investor_amount, 5000)

    def test_closed_report_keeps_cancelled_history_without_cash_growth(self):
        helpers.WalletBusinessTests.setUp(self)
        try:
            self.plan.duration_months = 3
            self.plan.start_date = date(2026, 1, 1)
            self.plan.status = "completed"
            self.plan.closed_on = date(2026, 2, 2)
            self.plan.closing_accrued_savings = 2200
            self.paid.month_number = 1
            self.paid.due_date = date(2026, 1, 1)
            self.overdue.month_number = 2
            self.overdue.due_date = date(2026, 2, 1)
            self.future.month_number = 3
            self.future.due_date = date(2026, 3, 1)
            self.future.status = "skipped"
            self.db.commit()
            self.db.refresh(self.plan)
            report = svc.build_plan_status_report(self.plan)
            months = report["months"]
            self.assertEqual([m["cumulative_cash"] for m in months], [5000, 10000, 10000])
            self.assertEqual(months[-1]["cash_amount"], 5000)
            self.assertEqual(months[-1]["status"], "skipped")
            self.assertEqual(report["paid_cash_total"], 5000)
            self.assertEqual(self.future.investor_amount, 5000)
            self.assertEqual(self.overdue.status, "scheduled")
            self.plan.duration_months = 4
            self.future.month_number = 4
            self.future.due_date = date(2026, 4, 1)
            missing = svc.build_plan_status_report(self.plan)["months"][2]
            self.assertEqual(missing["status"], "skipped")
            self.assertEqual(missing["cash_amount"], 0)
            self.assertEqual(missing["manager_amount"], 0)
            self.assertEqual(missing["cumulative_cash"], 10000)
        finally:
            helpers.WalletBusinessTests.tearDown(self)
