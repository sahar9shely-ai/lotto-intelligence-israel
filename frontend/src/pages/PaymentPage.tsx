import { useMemo, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { GlowButton } from "../components/GlowButton";
import { useAuth } from "../context/AuthContext";
import {
  formatIls,
  getPremiumPlan,
  getRoomById,
} from "../data/rooms";
import { api, type BitPayment } from "../services/api";

function normalizePhoneInput(value: string): string {
  return value.replace(/[^\d+]/g, "");
}

export function PaymentPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, token, isGuest, applyServerUser, updateUser } = useAuth();

  const kind = (params.get("kind") === "premium" ? "premium" : "room") as
    | "room"
    | "premium";
  const itemId = params.get("item") || "";

  const item = useMemo(() => {
    if (kind === "premium") {
      const plan = getPremiumPlan(itemId) ?? getPremiumPlan("premium-month");
      return {
        id: plan!.id,
        title: plan!.title,
        subtitle: plan!.subtitle,
        amount: plan!.priceIls,
        image: null as string | null,
      };
    }
    const room = getRoomById(itemId);
    if (!room) return null;
    return {
      id: room.id,
      title: room.title,
      subtitle: room.subtitle,
      amount: room.priceIls,
      image: room.image,
    };
  }, [itemId, kind]);

  const [phone, setPhone] = useState(user.phone || "");
  const [step, setStep] = useState<"form" | "waiting" | "done">("form");
  const [payment, setPayment] = useState<BitPayment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!item) {
    return (
      <AppShell showBack backTo="/app/home" hideNav>
        <section className="section">
          <h1 className="page-title">תשלום</h1>
          <p className="page-sub">לא נמצא פריט לתשלום</p>
          <GlowButton onClick={() => navigate("/app/home")}>חזרה לבית</GlowButton>
        </section>
      </AppShell>
    );
  }

  async function startBitPayment(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const created = await api.createBitPayment(
        { kind, itemId: item!.id, phone },
        token,
      );
      setPayment(created);
      if (!isGuest) {
        await updateUser({ phone: created.phone });
      }
      setStep("waiting");

      // Try opening Bit app / website on the phone.
      const probe = window.open(created.bitDeepLink, "_blank");
      if (!probe) {
        window.location.href = created.bitFallbackUrl;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "יצירת תשלום נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function confirmPaid() {
    if (!payment) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.confirmBitPayment(payment.id, token);
      setPayment(result.payment);
      if (result.user) {
        applyServerUser(result.user);
      } else if (isGuest) {
        // Local guest entitlement after Bit confirm.
        if (kind === "premium") {
          await updateUser({ isPremium: true, points: user.points + 200 });
        } else {
          const openedRooms = user.openedRooms.includes(item!.id)
            ? user.openedRooms
            : [...user.openedRooms, item!.id];
          await updateUser({
            openedRooms,
            roomsOpened: openedRooms.length,
            points: user.points + 100,
            orders: [
              {
                id: result.payment.id,
                kind,
                itemId: item!.id,
                title: item!.title,
                amountIls: item!.amount,
                method: "bit",
                paidAt: new Date().toISOString(),
              },
              ...(user.orders || []),
            ],
          });
        }
      }
      setStep("done");
      const successQuery =
        kind === "room"
          ? `room=${encodeURIComponent(item!.id)}&paid=1&method=bit&amount=${item!.amount}`
          : `premium=1&paid=1&method=bit&amount=${item!.amount}`;
      navigate(`/app/success?${successQuery}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "אישור התשלום נכשל");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell showBack backTo={kind === "premium" ? "/app/premium" : `/app/room/${item.id}`} hideNav>
      <section className="section pay-screen">
        <div className="bit-badge" aria-hidden>
          bit
        </div>
        <h1 className="page-title">תשלום בביט</h1>
        <p className="page-sub">מאובטח · מהיר · בלי פרטי אשראי באפליקציה</p>

        <div className="pay-summary">
          {item.image ? <img src={item.image} alt="" /> : <div className="pay-summary__diamond">◆</div>}
          <div>
            <strong>{item.title}</strong>
            <p>{item.subtitle}</p>
            <span className="price-tag">{formatIls(item.amount)}</span>
          </div>
        </div>

        {step === "form" ? (
          <form className="auth-form" onSubmit={startBitPayment}>
            <label className="field">
              <span>מספר טלפון המחובר לביט</span>
              <input
                value={phone}
                onChange={(e) => setPhone(normalizePhoneInput(e.target.value))}
                placeholder="05XXXXXXXX"
                inputMode="tel"
                dir="ltr"
                required
              />
            </label>

            <div className="pay-method is-active">
              <div className="pay-method__icon">bit</div>
              <div>
                <strong>ביט</strong>
                <small>תשלום באפליקציית ביט של בנק הפועלים</small>
              </div>
              <span className="pay-method__check">✓</span>
            </div>

            {error ? <p className="form-error">{error}</p> : null}

            <button type="submit" className="bit-pay-btn" disabled={busy}>
              {busy ? "פותחים את ביט..." : `שלמו ${formatIls(item.amount)} בביט`}
            </button>
            <p className="secure-note">
              בלחיצה תיפתח ביט. לאחר התשלום חזרו לכאן ואשרו.
            </p>
            {isGuest ? (
              <p className="page-sub">
                מומלץ{" "}
                <button type="button" className="text-link" onClick={() => navigate("/login")}>
                  להתחבר
                </button>{" "}
                כדי לשמור את ההזמנה בטלפון אחר
              </p>
            ) : null}
          </form>
        ) : null}

        {step === "waiting" && payment ? (
          <div className="bit-waiting">
            <div className="bit-qr" aria-hidden>
              <span>bit</span>
              <small>QR / Push</small>
            </div>
            <h2>ממתינים לאישור בביט</h2>
            <p>
              סכום לתשלום: <strong>{formatIls(payment.amountIls)}</strong>
            </p>
            <p className="page-sub">
              אם ביט לא נפתחה אוטומטית, לחצו שוב על הכפתור למטה.
            </p>
            <a className="bit-pay-btn" href={payment.bitDeepLink}>
              פתחו שוב את ביט
            </a>
            <a className="text-link" href={payment.bitFallbackUrl} target="_blank" rel="noreferrer">
              פתיחה בדפדפן bitpay.co.il
            </a>
            {error ? <p className="form-error">{error}</p> : null}
            <GlowButton onClick={() => void confirmPaid()} disabled={busy}>
              {busy ? "מאשרים..." : "שילמתי בביט — המשיכו"}
            </GlowButton>
            <p className="secure-note">מזהה תשלום: {payment.id}</p>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
