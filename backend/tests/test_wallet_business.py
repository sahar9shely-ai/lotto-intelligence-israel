import unittest
from datetime import date
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.investment_base import InvestmentBase
from app.db.investment_session import get_investment_db
from app.models.auth import User
from app.models.investments import Investor, InvestmentPlan, Payment, WalletEntry
from app.security.auth import get_current_user
from app.services import investment_service as svc, wallet_service as wallet


class WalletBusinessTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        InvestmentBase.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.db = self.sessions()
        self.investor = Investor(name="Synthetic investor")
        self.admin_investor = Investor(name="מנהל מערכת", is_manager=True)
        self.db.add_all([self.investor, self.admin_investor]); self.db.flush()
        self.admin = User(username="admin", role="manager", investor_id=self.admin_investor.id)
        self.user = User(username="synthetic", role="investor", investor_id=self.investor.id)
        self.db.add_all([self.admin, self.user]); self.db.commit()
        self.plan = InvestmentPlan(investor_id=self.investor.id, principal=60000, accrual_principal=60000,
            plan_type="hybrid", monthly_rate_percent=5000/60000*100, savings_rate_percent=2200/60000*100,
            manager_fee_percent=1, start_date=date(2025,1,1), duration_months=36)
        self.db.add(self.plan); self.db.flush()
        self.paid = Payment(plan_id=self.plan.id, investor_id=self.investor.id, month_number=1,
            due_date=date(2025,1,1), investor_amount=5000, manager_amount=600, status="paid")
        self.overdue = Payment(plan_id=self.plan.id, investor_id=self.investor.id, month_number=13,
            due_date=date(2026,1,1), investor_amount=5000, manager_amount=600, status="scheduled")
        self.future = Payment(plan_id=self.plan.id, investor_id=self.investor.id, month_number=15,
            due_date=date(2026,3,1), investor_amount=5000, manager_amount=600, status="awaiting_confirmation")
        self.db.add_all([self.paid,self.overdue,self.future]); self.db.commit()

    def tearDown(self):
        self.db.close(); self.engine.dispose()

    def close(self):
        with patch.object(wallet, "israel_today", return_value=date(2026,2,1)):
            result = wallet.close_plan(self.db,self.plan.id,self.admin.id)
            self.db.commit()
            return result

    def test_simple_savings_after_year_one_and_full_month_boundaries(self):
        for months in [12,13,24]:
            self.assertEqual(svc.projected_compound_savings(60000,2,months)["projected_savings_balance"],1200*months)
            rows=svc.month_savings_ledger(principal=60000,savings_rate_percent=2,duration_months=months)
            self.assertEqual(rows[-1]["cumulative_savings"],1200*months)
            self.assertFalse(any(row["compounded"] for row in rows))
        self.assertEqual(svc.completed_months(date(2026,1,31),date(2026,2,27),cap=12),0)
        self.assertEqual(svc.completed_months(date(2026,1,31),date(2026,2,28),cap=12),1)
        self.assertEqual(svc.completed_months(date(2026,1,31),date(2026,3,30),cap=12),1)

    def test_investor_and_plan_use_same_israeli_day_at_utc_midnight_boundary(self):
        with patch.object(svc,"israel_today",return_value=date(2026,2,1)), patch.object(svc,"date",wraps=date) as server_date:
            server_date.today.return_value=date(2026,1,31)
            investor=svc.serialize_investor(self.investor)
            plan=svc.serialize_plan(self.plan)
        self.assertEqual(investor["current_savings_balance"],28600)
        self.assertEqual(plan["current_savings_balance"],28600)

    def test_close_credits_once_stops_savings_preserves_paid_and_old_debt(self):
        self.close()
        self.assertEqual(self.investor.available_balance_cents,8860000)
        self.assertEqual(self.plan.closing_savings_cents,2860000)
        self.assertEqual(self.paid.status,"paid"); self.assertEqual(self.paid.investor_amount,5000)
        self.assertEqual(self.overdue.status,"scheduled"); self.assertEqual(self.future.status,"skipped")
        self.close()
        self.assertEqual(self.investor.available_balance_cents,8860000)
        self.assertEqual(self.db.query(WalletEntry).count(),1)
        self.assertEqual(svc.accrued_savings_for_plan(self.plan,date(2030,1,1)),28600)
        self.assertEqual(svc.available_savings_for_plan(self.plan,date(2030,1,1)),0)
        report=svc.build_plan_status_report(self.plan)
        self.assertEqual(report["months"][-1]["savings_accrual"],0)
        self.assertEqual(report["months"][-1]["cumulative_savings"],28600)

    def test_withdraw_then_fund_all_remaining_and_retries(self):
        self.close()
        wallet.withdraw(self.db,self.investor.id,10000,"withdraw-test-key",self.admin.id); self.db.commit()
        wallet.withdraw(self.db,self.investor.id,10000,"withdraw-test-key",self.admin.id); self.db.commit()
        self.assertEqual(self.investor.available_balance_cents,7860000)
        data=dict(investor_id=self.investor.id,principal=78600,plan_type="hybrid",monthly_rate_percent=5,
                  savings_rate_percent=2,manager_fee_percent=1,manager_savings_rate_percent=0.5,
                  start_date=date(2026,2,1),duration_months=12)
        new=wallet.fund_plan(self.db,dict(data),0,"fund-test-key",self.admin.id); self.db.commit()
        again=wallet.fund_plan(self.db,dict(data),0,"fund-test-key",self.admin.id); self.db.commit()
        self.assertEqual(again.id,new.id); self.assertEqual(new.principal,78600)
        self.assertEqual(self.investor.available_balance_cents,0)
        self.assertEqual(len(new.payments),12)
        march=[p for p in new.payments if p.due_date==date(2026,3,1)]
        self.assertEqual(len(march),1)  # old canceled payment remains separately
        self.assertEqual(self.future.status,"skipped")
        self.assertEqual(svc.manager_savings_for_plan(new,date(2026,2,1)),0)

    def test_rejects_partial_funding_excess_withdrawal_and_key_reuse(self):
        self.close()
        with self.assertRaises(ValueError): wallet.withdraw(self.db,self.investor.id,90000,"too-much-key",self.admin.id)
        data=dict(investor_id=self.investor.id,principal=50000,plan_type="monthly",monthly_rate_percent=5,
                  savings_rate_percent=0,manager_fee_percent=1,manager_savings_rate_percent=0,
                  start_date=date(2026,2,1),duration_months=12)
        with self.assertRaises(ValueError): wallet.fund_plan(self.db,data,0,"partial-fund-key",self.admin.id)
        wallet.withdraw(self.db,self.investor.id,100,"same-withdraw-key",self.admin.id); self.db.commit()
        with self.assertRaises(ValueError): wallet.withdraw(self.db,self.investor.id,200,"same-withdraw-key",self.admin.id)
        self.assertEqual(self.investor.available_balance_cents,8850000)

    def test_deposit_and_funding_are_audited_and_rollback_together(self):
        data=dict(investor_id=self.investor.id,principal=1000,plan_type="monthly",monthly_rate_percent=5,
                  savings_rate_percent=0,manager_fee_percent=1,manager_savings_rate_percent=1,
                  start_date=date(2026,10,1),duration_months=12)
        wallet.fund_plan(self.db,dict(data),1000,"deposit-fund-key",self.admin.id)
        self.db.rollback()
        self.assertEqual(self.db.query(WalletEntry).count(),0)
        self.assertEqual(self.db.query(InvestmentPlan).count(),1)
        new=wallet.fund_plan(self.db,dict(data),1000,"deposit-fund-key",self.admin.id); self.db.commit()
        self.assertEqual([e.operation_type for e in self.db.query(WalletEntry).order_by(WalletEntry.id)], ["deposit","plan_funding"])
        self.assertEqual(new.manager_savings_start_date,date(2026,10,1))

    def test_standalone_deposit_is_audited_once_and_funds_a_later_plan(self):
        self.close()
        entry=wallet.deposit(self.db,self.investor.id,1250.75,"standalone-deposit",self.admin.id)
        self.db.commit()
        again=wallet.deposit(self.db,self.investor.id,1250.75,"standalone-deposit",self.admin.id)
        self.db.commit()
        self.assertEqual(again.id,entry.id)
        self.assertEqual(entry.actor_user_id,self.admin.id)
        self.assertEqual(entry.operation_type,"deposit")
        self.assertIsNone(entry.plan_id)
        self.assertEqual(self.investor.available_balance_cents,8985075)
        self.assertEqual(self.db.query(InvestmentPlan).count(),1)
        self.assertEqual(self.plan.principal,60000)
        self.assertEqual(self.plan.status,"completed")
        data=dict(investor_id=self.investor.id,principal=89850.75,plan_type="monthly",monthly_rate_percent=2,
                  savings_rate_percent=0,manager_fee_percent=0,manager_savings_rate_percent=0,
                  start_date=date(2026,10,1),duration_months=12)
        new=wallet.fund_plan(self.db,data,0,"after-standalone-deposit",self.admin.id); self.db.commit()
        self.assertEqual(new.principal,89850.75)
        self.assertEqual(self.investor.available_balance_cents,0)
        self.assertEqual(self.db.query(WalletEntry).filter_by(operation_type="deposit").count(),1)

    def test_standalone_deposit_rejects_invalid_amounts_reused_keys_and_overflow(self):
        for amount in [0,-1,0.001,float("nan"),float("inf"),20000000.01]:
            with self.subTest(amount=amount), self.assertRaises(ValueError):
                wallet.deposit(self.db,self.investor.id,amount,"invalid-deposit",self.admin.id)
        wallet.deposit(self.db,self.investor.id,10,"unique-deposit",self.admin.id); self.db.commit()
        with self.assertRaises(ValueError):
            wallet.deposit(self.db,self.investor.id,11,"unique-deposit",self.admin.id)
        with self.assertRaises(ValueError):
            wallet.deposit(self.db,self.admin_investor.id,10,"unique-deposit",self.admin.id)
        with self.assertRaises(ValueError):
            wallet.deposit(self.db,self.investor.id,20000000,"overflow-deposit",self.admin.id)
        self.db.rollback()
        self.assertEqual(self.investor.available_balance_cents,1000)
        self.assertEqual(self.db.query(WalletEntry).count(),1)

    def test_standalone_deposit_api_is_admin_only_and_visible_in_owner_history(self):
        from app.api.v1.investments import router
        app=FastAPI(); app.include_router(router)
        app.dependency_overrides[get_investment_db]=lambda:self.db
        other_investor=Investor(name="Other manager",is_manager=True)
        self.db.add(other_investor); self.db.flush()
        other_manager=User(username="other-manager",role="manager",investor_id=other_investor.id)
        self.db.add(other_manager); self.db.commit()
        url=f"/api/v1/investments/investors/{self.investor.id}/wallet/deposit"
        body={"amount":350.25,"operation_key":"api-deposit-key"}
        with TestClient(app) as client:
            for actor in [self.user,other_manager]:
                app.dependency_overrides[get_current_user]=lambda actor=actor:actor
                self.assertEqual(client.post(url,json=body).status_code,403)
            self.assertEqual(self.investor.available_balance_cents,0)
            app.dependency_overrides[get_current_user]=lambda:self.admin
            first=client.post(url,json=body)
            self.assertEqual(first.status_code,200,first.text)
            self.assertEqual(first.json()["balance_after"],350.25)
            self.assertEqual(client.post(url,json=body).json(),first.json())
            self.assertEqual(client.post(url,json={**body,"amount":351}).status_code,409)
            self.assertEqual(client.post(url,json={**body,"amount":0}).status_code,422)
            self.assertEqual(client.post(url,json={**body,"amount":0.001}).status_code,409)
            self.assertEqual(client.post("/api/v1/investments/investors/999999/wallet/deposit",json=body).status_code,404)
            app.dependency_overrides[get_current_user]=lambda:self.user
            history=client.get(f"/api/v1/investments/investors/{self.investor.id}/wallet").json()
            self.assertEqual(history["available_balance"],350.25)
            self.assertEqual(len(history["entries"]),1)
            self.assertEqual(history["entries"][0]["type"],"deposit")
            self.assertNotIn("actor_user_id",history["entries"][0])
            self.assertEqual(client.get(f"/api/v1/investments/investors/{self.admin_investor.id}/wallet").status_code,403)

    def test_investor_api_omits_manager_finances_and_cannot_operate_wallet(self):
        from app.api.v1.investments import router
        app=FastAPI(); app.include_router(router)
        app.dependency_overrides[get_investment_db]=lambda:self.db
        app.dependency_overrides[get_current_user]=lambda:self.user
        with TestClient(app) as client:
            for path in ["plans", "dashboard", "payments", "payment-report?year=2026", f"plans/{self.plan.id}/status-report"]:
                response=client.get("/api/v1/investments/"+path)
                self.assertEqual(response.status_code,200,response.text)
                def assert_private(value):
                    if isinstance(value,list):
                        for row in value: assert_private(row)
                    elif isinstance(value,dict):
                        for key,row in value.items():
                            self.assertFalse("manager" in key and key not in {"is_manager"},key)
                            assert_private(row)
                assert_private(response.json())
            self.assertEqual(client.get("/api/v1/investments/manager-income").status_code,403)
            self.assertEqual(client.post(f"/api/v1/investments/plans/{self.plan.id}/close").status_code,403)
            self.assertEqual(client.post(f"/api/v1/investments/investors/{self.investor.id}/wallet/withdraw",json={"amount":1,"operation_key":"investor-key"}).status_code,403)

    def test_manager_savings_accrues_only_from_activation_and_freezes_at_closure(self):
        self.plan.manager_savings_rate_percent=1
        self.plan.manager_savings_start_date=date(2025,12,1)
        self.db.commit()
        self.assertEqual(svc.manager_savings_for_plan(self.plan,date(2025,11,30)),0)
        self.assertEqual(svc.manager_savings_for_plan(self.plan,date(2026,1,15)),600)
        self.close()
        self.assertEqual(svc.manager_savings_for_plan(self.plan,date(2030,1,1)),1200)
        income=svc.get_manager_income_board(self.db)
        self.assertEqual(income["accrued_manager_savings_total"],1200)
        self.assertEqual(income["monthly_manager_savings_total"],0)
        self.assertEqual(income["paid_manager_cash_total"],600)

    def test_schema_migration_preserves_old_payments_and_allows_new_plan_same_date(self):
        from app.db.schema_migrate import ensure_schema
        from sqlalchemy.schema import CreateTable
        with self.engine.begin() as conn:
            conn.execute(text("DROP TABLE payments"))
            definition=str(CreateTable(Payment.__table__).compile(self.engine))
            definition=definition.replace("CONSTRAINT uq_payments_plan_month UNIQUE (plan_id, month_number)",
                "CONSTRAINT uq_payments_plan_month UNIQUE (plan_id, month_number), CONSTRAINT uq_payments_investor_due UNIQUE (investor_id, due_date)")
            conn.execute(text(definition))
            conn.execute(text("INSERT INTO payments (id,plan_id,investor_id,month_number,due_date,investor_amount,manager_amount,status) VALUES (101,:p,:i,1,'2026-01-01',5000,600,'paid')"),{"p":self.plan.id,"i":self.investor.id})
        ensure_schema(self.engine)
        ensure_schema(self.engine)
        with self.engine.begin() as conn:
            row=conn.execute(text("SELECT investor_amount,status FROM payments WHERE id=101")).one()
            self.assertEqual(tuple(row),(5000,"paid"))
            other=InvestmentPlan(investor_id=self.investor.id,principal=1000,plan_type="monthly",monthly_rate_percent=1,manager_fee_percent=0,start_date=date(2026,1,1),duration_months=12)
            self.db.add(other); self.db.flush()
            self.db.add(Payment(plan_id=other.id,investor_id=self.investor.id,month_number=1,due_date=date(2026,1,1),investor_amount=10,manager_amount=0,status="scheduled"))
            self.db.commit()


if __name__ == "__main__": unittest.main()
