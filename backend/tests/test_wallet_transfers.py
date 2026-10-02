import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
from threading import Barrier, Event
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, create_mock_engine, event, inspect, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.investments import router
from app.db.investment_base import InvestmentBase
from app.db.investment_session import get_investment_db
from app.db.schema_migrate import ensure_schema
from app.models.auth import User
from app.models.investments import Investor, InvestmentPlan, Payment, WalletEntry, WalletTransfer
from app.security.auth import get_current_user
from app.services import investment_service as investment, wallet_service as wallet


def sqlite_engine(url="sqlite://", *, memory=True):
    options = {"connect_args": {"check_same_thread": False, "timeout": 10}}
    if memory:
        options["poolclass"] = StaticPool
    engine = create_engine(url, **options)

    @event.listens_for(engine, "connect")
    def foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    return engine


class WalletTransferTests(unittest.TestCase):
    def setUp(self):
        self.engine = sqlite_engine()
        InvestmentBase.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.db = self.sessions()
        self.source = Investor(name="Synthetic source", available_balance_cents=100000)
        self.recipient = Investor(name="Synthetic recipient", available_balance_cents=20000)
        self.admin_shell = Investor(name="מנהל מערכת", is_manager=True)
        self.manager_book = Investor(name="Synthetic manager", is_manager=True, available_balance_cents=1000)
        self.db.add_all([self.source, self.recipient, self.admin_shell, self.manager_book])
        self.db.flush()
        self.admin = User(username="admin", role="manager", investor_id=self.admin_shell.id)
        self.owner = User(username="synthetic-source", role="investor", investor_id=self.source.id)
        self.recipient_user = User(username="synthetic-recipient", role="investor", investor_id=self.recipient.id)
        self.manager = User(username="synthetic-manager", role="manager", investor_id=self.manager_book.id)
        self.db.add_all([self.admin, self.owner, self.recipient_user, self.manager])
        self.plan = InvestmentPlan(investor_id=self.source.id, principal=50000, accrual_principal=50000,
                                   plan_type="hybrid", monthly_rate_percent=1, savings_rate_percent=2,
                                   start_date=date(2026, 1, 15), duration_months=12)
        self.db.add(self.plan)
        self.db.flush()
        self.payment = Payment(plan_id=self.plan.id, investor_id=self.source.id, month_number=1,
                               due_date=date(2026, 2, 15), investor_amount=500, manager_amount=100, status="paid")
        self.db.add(self.payment)
        self.db.commit()
        self.current_user = self.admin
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_current_user] = lambda: self.current_user
        app.dependency_overrides[get_investment_db] = lambda: self.db
        self.client = TestClient(app)
        self.url = f"/api/v1/investments/investors/{self.source.id}/wallet/transfer"

    def tearDown(self):
        self.client.close()
        self.db.close()
        self.engine.dispose()

    def payload(self, **changes):
        data = dict(recipient_investor_id=self.recipient.id, amount=250.01,
                    operation_key="synthetic-transfer-key", request_confirmed=True,
                    expected_source_balance=1000, notes="Private administrative note")
        data.update(changes)
        return data

    def transfer(self, **changes):
        data = self.payload(**changes)
        return wallet.transfer(self.db, self.source.id, data.pop("recipient_investor_id"),
                               data.pop("amount"), data.pop("operation_key"), self.admin.id, **data)

    def balances(self):
        self.db.expire_all()
        return self.source.available_balance_cents, self.recipient.available_balance_cents

    def assert_unchanged(self):
        self.assertEqual(self.balances(), (100000, 20000))
        self.assertEqual(self.db.query(WalletTransfer).count(), 0)
        self.assertEqual(self.db.query(WalletEntry).count(), 0)

    def test_success_exact_cents_linked_receipt_and_unchanged_plan_history(self):
        response = self.client.post(self.url, json=self.payload())
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(set(data), {"transfer_id", "source_investor_id", "recipient_investor_id", "amount",
                                     "source_balance_after", "recipient_balance_after"})
        self.assertEqual(data["amount"], 250.01)
        self.assertEqual(data["source_balance_after"], 749.99)
        self.assertEqual(data["recipient_balance_after"], 450.01)
        self.assertEqual(self.balances(), (74999, 45001))
        entries = self.db.query(WalletEntry).order_by(WalletEntry.id).all()
        self.assertEqual([e.operation_type for e in entries], ["transfer_out", "transfer_in"])
        self.assertEqual([e.amount_cents for e in entries], [-25001, 25001])
        self.assertEqual(sum(e.amount_cents for e in entries), 0)
        self.assertEqual(sum(self.balances()), 120000)
        self.assertEqual({e.transfer_id for e in entries}, {data["transfer_id"]})
        self.assertEqual([e.counterparty_investor_id for e in entries], [self.recipient.id, self.source.id])
        self.assertEqual([e.counterparty_name for e in entries], [self.recipient.name, self.source.name])
        self.assertTrue(all(e.actor_user_id == self.admin.id and e.plan_id is None for e in entries))
        self.assertEqual(self.plan.principal, 50000)
        self.assertEqual(self.plan.accrual_principal, 50000)
        self.assertEqual(self.plan.status, "active")
        self.assertEqual(self.payment.status, "paid")
        self.assertEqual(self.payment.investor_amount, 500)

    def test_entire_balance_and_one_cent(self):
        receipt = self.transfer(amount=1000)
        self.db.commit()
        self.assertEqual(self.balances(), (0, 120000))
        self.assertEqual(receipt.amount_cents, 100000)
        wallet.transfer(self.db, self.recipient.id, self.source.id, "0.01", "one-cent-transfer", self.admin.id,
                        request_confirmed=True, expected_source_balance=1200)
        self.db.commit()
        self.assertEqual(self.balances(), (1, 119999))

    def test_errors_leave_no_partial_transfer(self):
        for changes, status in [({"amount": 1000.01}, 409), ({"expected_source_balance": 999}, 409),
                                ({"recipient_investor_id": self.source.id}, 409),
                                ({"recipient_investor_id": 900000}, 404),
                                ({"recipient_investor_id": self.admin_shell.id}, 409)]:
            with self.subTest(changes=changes):
                response = self.client.post(self.url, json=self.payload(**changes))
                self.assertEqual(response.status_code, status, response.text)
                self.assert_unchanged()

    def test_missing_source_is_404_and_shell_source_rejected(self):
        response = self.client.post("/api/v1/investments/investors/900000/wallet/transfer", json=self.payload())
        self.assertEqual(response.status_code, 404)
        response = self.client.post(f"/api/v1/investments/investors/{self.admin_shell.id}/wallet/transfer",
                                    json=self.payload(expected_source_balance=0))
        self.assertEqual(response.status_code, 409)
        self.assert_unchanged()

    def test_recipient_balance_limit(self):
        self.recipient.available_balance_cents = 2_000_000_000
        self.db.commit()
        response = self.client.post(self.url, json=self.payload(amount=0.01))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.balances(), (100000, 2_000_000_000))
        self.assertEqual(self.db.query(WalletEntry).count(), 0)

    def test_payload_validation_consent_precision_and_limits(self):
        invalid = [{"request_confirmed": False}, {"request_confirmed": 1}, {"request_confirmed": "true"},
                   {"amount": 0}, {"amount": -1}, {"amount": "NaN"}, {"amount": "Infinity"},
                   {"amount": 0.001}, {"amount": 20_000_000.01}, {"expected_source_balance": -1},
                   {"expected_source_balance": 1000.001}, {"recipient_investor_id": True},
                   {"recipient_investor_id": 1.5}, {"operation_key": "        "}, {"notes": "x" * 501}]
        for changes in invalid:
            with self.subTest(changes=changes):
                response = self.client.post(self.url, json=self.payload(**changes))
                self.assertEqual(response.status_code, 422, response.text)
                self.assert_unchanged()
        missing = self.payload()
        del missing["request_confirmed"]
        self.assertEqual(self.client.post(self.url, json=missing).status_code, 422)

    def test_consent_also_checked_by_service(self):
        with self.assertRaises(ValueError):
            self.transfer(request_confirmed=False)
        self.db.commit()
        self.assert_unchanged()

    def test_only_system_admin_can_transfer(self):
        for user in [self.owner, self.recipient_user, self.manager]:
            with self.subTest(user=user.username):
                self.current_user = user
                self.assertEqual(self.client.post(self.url, json=self.payload()).status_code, 403)
                with self.assertRaises(PermissionError):
                    wallet.transfer(self.db, self.source.id, self.recipient.id, 10, "blocked-transfer-key",
                                    user.id, request_confirmed=True, expected_source_balance=1000)
                self.assert_unchanged()

    def test_personal_manager_investor_with_capital_is_allowed(self):
        self.manager_book.name = "סהר"
        self.db.commit()
        receipt = self.transfer(recipient_investor_id=self.manager_book.id)
        self.db.commit()
        self.assertEqual(receipt.recipient_balance_after_cents, 26001)

    def test_ordinary_manager_investment_portfolio_with_capital_is_allowed(self):
        self.db.add(InvestmentPlan(investor_id=self.manager_book.id, principal=100,
                                   start_date=date(2026, 1, 1), duration_months=12))
        self.db.commit()
        receipt = self.transfer(recipient_investor_id=self.manager_book.id)
        self.db.commit()
        self.assertEqual(receipt.recipient_balance_after_cents, 26001)

    def test_replay_returns_original_receipt_before_stale_balance_precondition(self):
        first = self.client.post(self.url, json=self.payload()).json()
        wallet.deposit(self.db, self.source.id, 100, "subsequent-source-deposit", self.admin.id)
        wallet.deposit(self.db, self.recipient.id, 20, "subsequent-recipient-deposit", self.admin.id)
        self.db.commit()
        again = self.client.post(self.url, json=self.payload())
        self.assertEqual(again.status_code, 200, again.text)
        self.assertEqual(again.json(), first)
        self.assertEqual(self.balances(), (84999, 47001))
        self.assertEqual(self.db.query(WalletEntry).count(), 4)
        self.assertEqual(self.db.query(WalletTransfer).count(), 1)

    def test_changed_payload_cannot_reuse_key(self):
        self.transfer()
        self.db.commit()
        for changes in [{"amount": 250.02}, {"recipient_investor_id": self.manager_book.id},
                        {"expected_source_balance": 749.99}, {"notes": "Changed private instruction"}]:
            with self.subTest(changes=changes):
                response = self.client.post(self.url, json=self.payload(**changes))
                self.assertEqual(response.status_code, 409, response.text)
                self.assertEqual(self.balances(), (74999, 45001))
                self.assertEqual(self.db.query(WalletEntry).count(), 2)
        response = self.client.post(f"/api/v1/investments/investors/{self.recipient.id}/wallet/transfer",
                                    json=self.payload(recipient_investor_id=self.source.id, expected_source_balance=450.01))
        self.assertEqual(response.status_code, 409)

    def test_existing_deposit_key_cannot_be_used_for_transfer_or_the_reverse(self):
        wallet.deposit(self.db, self.source.id, 10, "shared-operation-key", self.admin.id)
        self.db.commit()
        response = self.client.post(self.url, json=self.payload(operation_key="shared-operation-key", expected_source_balance=1010))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.db.query(WalletTransfer).count(), 0)
        self.transfer(expected_source_balance=1010)
        self.db.commit()
        with self.assertRaises(ValueError):
            wallet.deposit(self.db, self.source.id, 250.01, "synthetic-transfer-key", self.admin.id)
        self.assertEqual(self.db.query(WalletEntry).count(), 3)

    def test_credit_failure_rolls_back_even_when_caller_catches_and_commits(self):
        original = wallet.movement

        def fail_credit(db, investor, amount, kind, *args, **kwargs):
            if kind == "transfer_in":
                raise RuntimeError("synthetic credit failure")
            return original(db, investor, amount, kind, *args, **kwargs)

        with patch.object(wallet, "movement", side_effect=fail_credit), self.assertRaises(RuntimeError):
            self.transfer()
        self.db.commit()
        self.assert_unchanged()

    def test_credit_ledger_flush_failure_rolls_back_debit_and_receipt(self):
        original = self.db.flush

        def fail_second_ledger(*args, **kwargs):
            if any(isinstance(row, WalletEntry) and row.operation_type == "transfer_in" for row in self.db.new):
                raise IntegrityError("synthetic flush", {}, ValueError("credit rejected"))
            return original(*args, **kwargs)

        with patch.object(self.db, "flush", side_effect=fail_second_ledger), self.assertRaises(IntegrityError):
            self.transfer()
        self.db.commit()
        self.assert_unchanged()

    def test_service_leaves_commit_to_caller(self):
        self.transfer()
        self.db.rollback()
        self.assert_unchanged()

    def test_locks_both_investors_in_ascending_order(self):
        original = wallet.lock_investor
        calls = []

        def record_lock(db, investor_id):
            calls.append(investor_id)
            return original(db, investor_id)

        with patch.object(wallet, "lock_investor", side_effect=record_lock):
            wallet.transfer(self.db, self.recipient.id, self.source.id, 10, "opposite-direction-key", self.admin.id,
                            request_confirmed=True, expected_source_balance=200)
        self.assertEqual(calls, sorted([self.source.id, self.recipient.id]))
        self.db.rollback()

    def test_history_is_scoped_and_admin_notes_are_private(self):
        self.transfer()
        self.db.commit()
        self.current_user = self.owner
        response = self.client.get(f"/api/v1/investments/investors/{self.source.id}/wallet")
        self.assertEqual(response.status_code, 200)
        row = response.json()["entries"][0]
        self.assertEqual(row["type"], "transfer_out")
        self.assertEqual(row["counterparty_name"], self.recipient.name)
        self.assertEqual(set(row), {"id", "plan_id", "type", "amount", "balance_after", "created_at",
                                    "transfer_id", "counterparty_investor_id", "counterparty_name"})
        self.assertEqual(self.client.get(f"/api/v1/investments/investors/{self.recipient.id}/wallet").status_code, 403)
        self.current_user = self.recipient_user
        row = self.client.get(f"/api/v1/investments/investors/{self.recipient.id}/wallet").json()["entries"][0]
        self.assertEqual(row["type"], "transfer_in")
        self.assertNotIn("notes", row)
        self.current_user = self.manager
        row = self.client.get(f"/api/v1/investments/investors/{self.source.id}/wallet").json()["entries"][0]
        self.assertNotIn("notes", row)
        self.current_user = self.admin
        row = self.client.get(f"/api/v1/investments/investors/{self.source.id}/wallet").json()["entries"][0]
        self.assertEqual(row["notes"], "Private administrative note")
        self.assertNotIn("recipient_balance_after", row)

    def test_counterparty_snapshot_and_replay_survive_rename_and_deletion(self):
        source_id = self.source.id
        source_name = self.source.name
        receipt = self.transfer(amount=1000)
        self.db.commit()
        self.source.name = "Renamed synthetic source"
        self.db.commit()
        investment.delete_investor_and_history(self.db, investor_id=source_id)
        self.db.expire_all()
        incoming = self.db.query(WalletEntry).filter(WalletEntry.operation_type == "transfer_in").one()
        self.assertIsNone(incoming.counterparty_investor_id)
        self.assertEqual(incoming.counterparty_name, source_name)
        self.assertEqual(self.db.query(WalletTransfer).one().source_investor_id, source_id)
        again = wallet.transfer(self.db, source_id, self.recipient.id, 1000, "synthetic-transfer-key", self.admin.id,
                                request_confirmed=True, expected_source_balance=1000, notes="Private administrative note")
        self.assertEqual(again.id, receipt.id)
        self.assertEqual(self.db.query(WalletEntry).count(), 2)

    def test_deletion_explicitly_detaches_counterparty_even_if_legacy_sqlite_fks_are_off(self):
        source_id = self.source.id
        self.transfer(amount=1000)
        self.db.commit()
        self.db.connection().exec_driver_sql("PRAGMA foreign_keys=OFF")
        self.assertEqual(self.db.connection().exec_driver_sql("PRAGMA foreign_keys").scalar(), 0)
        investment.delete_investor_and_history(self.db, investor_id=source_id)
        self.db.expire_all()
        incoming = self.db.query(WalletEntry).filter(WalletEntry.operation_type == "transfer_in").one()
        self.assertIsNone(incoming.counterparty_investor_id)
        self.assertEqual(incoming.counterparty_name, "Synthetic source")
        self.assertEqual(self.db.query(WalletTransfer).one().source_investor_id, source_id)


class WalletTransferConcurrencyTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="wallet-transfer-test-")
        self.engine = sqlite_engine("sqlite:///" + (Path(self.directory.name) / "wallet.db").as_posix(), memory=False)
        InvestmentBase.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.sessions() as db:
            investors = [Investor(name="Source", available_balance_cents=10000),
                         Investor(name="Recipient", available_balance_cents=10000),
                         Investor(name="מנהל מערכת", is_manager=True)]
            db.add_all(investors)
            db.flush()
            actor = User(username="admin", role="manager", investor_id=investors[2].id)
            db.add(actor)
            db.commit()
            self.source_id, self.recipient_id, self.actor_id = investors[0].id, investors[1].id, actor.id

    def tearDown(self):
        self.engine.dispose()
        self.directory.cleanup()

    def race(self, requests):
        barrier = Barrier(len(requests))

        def perform(source, recipient, amount, key):
            with self.sessions() as db:
                barrier.wait(timeout=10)
                try:
                    receipt = wallet.transfer(db, source, recipient, amount, key, self.actor_id,
                                              request_confirmed=True, expected_source_balance=100)
                    db.commit()
                    return ("ok", receipt.id)
                except ValueError as exc:
                    db.rollback()
                    return ("conflict", str(exc))

        with ThreadPoolExecutor(max_workers=len(requests)) as executor:
            return list(executor.map(lambda item: perform(*item), requests))

    def test_same_key_concurrently_credits_once_and_both_retries_receive_receipt(self):
        request = (self.source_id, self.recipient_id, 70, "concurrent-identical-key")
        outcomes = self.race([request, request])
        self.assertEqual([o[0] for o in outcomes], ["ok", "ok"])
        self.assertEqual(outcomes[0][1], outcomes[1][1])
        with self.sessions() as db:
            self.assertEqual(db.get(Investor, self.source_id).available_balance_cents, 3000)
            self.assertEqual(db.get(Investor, self.recipient_id).available_balance_cents, 17000)
            self.assertEqual(db.query(WalletEntry).count(), 2)
            self.assertEqual(db.query(WalletTransfer).count(), 1)

    def test_competing_withdrawals_cannot_spend_balance_twice(self):
        outcomes = self.race([(self.source_id, self.recipient_id, 70, "concurrent-first-key"),
                              (self.source_id, self.recipient_id, 70, "concurrent-second-key")])
        self.assertEqual(sorted(o[0] for o in outcomes), ["conflict", "ok"])
        with self.sessions() as db:
            self.assertEqual(sum(i.available_balance_cents for i in db.query(Investor)), 20000)
            self.assertEqual(db.get(Investor, self.source_id).available_balance_cents, 3000)
            self.assertEqual(db.query(WalletEntry).count(), 2)

    def test_opposing_transfers_do_not_deadlock_or_leave_half_ledger(self):
        outcomes = self.race([(self.source_id, self.recipient_id, 70, "opposing-first-key"),
                              (self.recipient_id, self.source_id, 70, "opposing-second-key")])
        self.assertEqual(sorted(o[0] for o in outcomes), ["conflict", "ok"])
        with self.sessions() as db:
            self.assertEqual(sum(i.available_balance_cents for i in db.query(Investor)), 20000)
            entries = db.query(WalletEntry).all()
            self.assertEqual(len(entries), 2)
            self.assertEqual(sum(row.amount_cents for row in entries), 0)

    def test_delete_waits_for_pending_credit_then_rechecks_balance(self):
        with self.sessions() as db:
            db.get(Investor, self.recipient_id).available_balance_cents = 0
            db.commit()
        credit_db = self.sessions()
        delete_db = self.sessions()
        # This session saw an empty recipient before the transfer started.
        cached_empty = delete_db.get(Investor, self.recipient_id)
        self.assertEqual(cached_empty.available_balance_cents, 0)
        wallet.transfer(credit_db, self.source_id, self.recipient_id, 70, "pending-credit-key", self.actor_id,
                        request_confirmed=True, expected_source_balance=100)
        deletion_started = Event()
        original_begin = wallet.begin_wallet_write

        def observe_lock(db):
            deletion_started.set()
            return original_begin(db)

        def delete_empty_recipient():
            try:
                investment.delete_investor_and_history(delete_db, investor_id=self.recipient_id)
                return "deleted"
            except ValueError:
                delete_db.rollback()
                return "blocked"

        try:
            with patch.object(wallet, "begin_wallet_write", side_effect=observe_lock):
                with ThreadPoolExecutor(max_workers=1) as executor:
                    deletion = executor.submit(delete_empty_recipient)
                    self.assertTrue(deletion_started.wait(timeout=10))
                    credit_db.commit()
                    self.assertEqual(deletion.result(timeout=10), "blocked")
            with self.sessions() as db:
                self.assertEqual(db.get(Investor, self.recipient_id).available_balance_cents, 7000)
                self.assertEqual(sum(i.available_balance_cents for i in db.query(Investor)), 10000)
                self.assertEqual(db.query(WalletEntry).count(), 2)
        finally:
            credit_db.close()
            delete_db.close()


class WalletTransferMigrationTests(unittest.TestCase):
    def test_postgresql_transfer_tables_compile_with_foreign_keys_and_direction_index(self):
        # DDL compilation only: no PostgreSQL server/production connection here.
        statements = []
        dialect = postgresql.dialect()
        engine = create_mock_engine("postgresql+psycopg://", lambda sql, *args, **kwargs:
                                    statements.append(str(sql.compile(dialect=dialect))))
        InvestmentBase.metadata.create_all(engine, checkfirst=False)
        receipt_ddl = next(sql for sql in statements if "CREATE TABLE investor_wallet_transfers" in sql)
        entry_ddl = next(sql for sql in statements if "CREATE TABLE investor_wallet_entries" in sql)
        self.assertIn("id VARCHAR(36) NOT NULL", receipt_ddl)
        self.assertIn("UNIQUE (operation_key)", receipt_ddl)
        self.assertNotIn("FOREIGN KEY(source_investor_id)", receipt_ddl)
        self.assertIn("FOREIGN KEY(transfer_id) REFERENCES investor_wallet_transfers (id)", entry_ddl)
        self.assertIn("FOREIGN KEY(counterparty_investor_id) REFERENCES investors (id) ON DELETE SET NULL", entry_ddl)
        self.assertTrue(any("CREATE UNIQUE INDEX uq_wallet_entries_transfer_direction" in sql for sql in statements))

    def test_upgrades_populated_old_wallet_schema_twice_without_rebuilding_history(self):
        engine = sqlite_engine()
        # Install the actual pre-transfer wallet table first; create_all must skip it.
        with engine.begin() as conn:
            conn.execute(text("""CREATE TABLE investor_wallet_entries (
                id INTEGER PRIMARY KEY, investor_id INTEGER REFERENCES investors(id) ON DELETE SET NULL,
                investor_name VARCHAR(120) NOT NULL, plan_id INTEGER REFERENCES investment_plans(id) ON DELETE SET NULL,
                operation_key VARCHAR(100) NOT NULL UNIQUE, operation_type VARCHAR(32) NOT NULL,
                amount_cents INTEGER NOT NULL, balance_after_cents INTEGER NOT NULL,
                request_fingerprint VARCHAR(64) NOT NULL, actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at DATETIME NOT NULL)"""))
        InvestmentBase.metadata.create_all(engine)
        sessions = sessionmaker(bind=engine, expire_on_commit=False)
        with sessions() as db:
            source, recipient, admin_shell = Investor(name="Old source", available_balance_cents=12500), Investor(name="Old recipient"), Investor(name="מנהל מערכת", is_manager=True)
            db.add_all([source, recipient, admin_shell])
            db.flush()
            actor = User(username="admin", role="manager", investor_id=admin_shell.id)
            db.add(actor)
            db.flush()
            source_id, recipient_id, actor_id = source.id, recipient.id, actor.id
            db.execute(text("""INSERT INTO investor_wallet_entries
                (id,investor_id,investor_name,operation_key,operation_type,amount_cents,balance_after_cents,request_fingerprint,actor_user_id,created_at)
                VALUES (101,:id,'Old source','old-deposit-key','deposit',12500,12500,'old-fingerprint',:actor,'2026-01-01')"""), {"id": source_id, "actor": actor_id})
            db.commit()
        ensure_schema(engine)
        ensure_schema(engine)
        columns = {column["name"] for column in inspect(engine).get_columns("investor_wallet_entries")}
        self.assertTrue({"transfer_id", "counterparty_investor_id", "counterparty_name", "admin_notes"} <= columns)
        self.assertIn("investor_wallet_transfers", inspect(engine).get_table_names())
        self.assertTrue(any(index["name"] == "uq_wallet_entries_transfer_direction" and index["unique"]
                            for index in inspect(engine).get_indexes("investor_wallet_entries")))
        with sessions() as db:
            old = db.get(WalletEntry, 101)
            self.assertEqual(old.amount_cents, 12500)
            self.assertEqual(old.operation_key, "old-deposit-key")
            self.assertIsNone(old.transfer_id)
            self.assertIsNone(old.counterparty_investor_id)
            self.assertIsNone(old.counterparty_name)
            self.assertIsNone(old.admin_notes)
            receipt = wallet.transfer(db, source_id, recipient_id, 25, "upgraded-transfer-key", actor_id,
                                      request_confirmed=True, expected_source_balance=125)
            db.commit()
            self.assertEqual(receipt.source_balance_after_cents, 10000)
            self.assertEqual(db.query(WalletEntry).count(), 3)
        # SQLite's reflection parser may omit options of inline ALTER-added FKs;
        # its own catalog confirms the constraint enforced by the database.
        with engine.connect() as conn:
            foreign_keys = conn.execute(text("PRAGMA foreign_key_list(investor_wallet_entries)")).mappings().all()
        counterparty = next(fk for fk in foreign_keys if fk["from"] == "counterparty_investor_id")
        self.assertEqual(counterparty["on_delete"], "SET NULL")
        engine.dispose()
