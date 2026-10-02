"""Read-only by default. Apply requires the exact reviewed dry-run digest."""
from __future__ import annotations
import argparse
import json
from datetime import datetime
from app.db.investment_session import InvestmentSessionLocal
from app.services.payment_schedule_reconciliation import reconcile_opening_payment_dates

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan-id", type=int, action="append", required=True)
    parser.add_argument("--signed-since", type=datetime.fromisoformat)
    parser.add_argument("--signed-until", type=datetime.fromisoformat)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-digest")
    args = parser.parse_args()
    if args.apply and not args.expected_digest:
        parser.error("--apply requires --expected-digest from a reviewed dry run")
    with InvestmentSessionLocal() as db:
        result = reconcile_opening_payment_dates(db, args.plan_id, dry_run=not args.apply,
            signed_since=args.signed_since, signed_until=args.signed_until, expected_digest=args.expected_digest)
        if args.apply:
            db.commit()
        print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
