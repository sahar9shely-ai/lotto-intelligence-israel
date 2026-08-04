from __future__ import annotations

import json
import smtplib
from email.message import EmailMessage
from typing import Optional

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.auth import EmailOutbox


def send_email(
    db: Session,
    *,
    to_email: str,
    subject: str,
    body: str,
    kind: str = "generic",
    meta: Optional[dict] = None,
) -> EmailOutbox:
    entry = EmailOutbox(
        to_email=to_email,
        subject=subject,
        body=body,
        kind=kind,
        meta_json=json.dumps(meta or {}, ensure_ascii=False),
    )
    db.add(entry)
    db.flush()

    if settings.smtp_host and settings.smtp_from:
        try:
            msg = EmailMessage()
            msg["Subject"] = subject
            msg["From"] = settings.smtp_from
            msg["To"] = to_email
            msg.set_content(body)
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
                if settings.smtp_use_tls:
                    smtp.starttls()
                if settings.smtp_user:
                    smtp.login(settings.smtp_user, settings.smtp_password)
                smtp.send_message(msg)
        except Exception as exc:  # noqa: BLE001 — keep outbox even if SMTP fails
            print(f"[email] SMTP failed for {to_email}: {exc}")
    else:
        print(f"[email:{kind}] to={to_email} subject={subject}\n{body}\n")

    return entry
