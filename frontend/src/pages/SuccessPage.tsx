import { useNavigate, useSearchParams } from "react-router-dom";
import { GlowButton } from "../components/GlowButton";
import { Logo } from "../components/Logo";
import { formatIls, getRoomById } from "../data/rooms";

export function SuccessPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const room = getRoomById(params.get("room") || "");
  const paid = params.get("paid") === "1";
  const premium = params.get("premium") === "1";
  const amount = Number(params.get("amount") || 0);
  const method = params.get("method");

  return (
    <div className="screen success-screen">
      <button
        type="button"
        className="icon-btn success-screen__back"
        onClick={() => navigate(-1)}
        aria-label="חזרה"
      >
        →
      </button>
      <Logo size="sm" />
      <h1>{paid ? "התשלום התקבל" : "פותחים חוויה חדשה"}</h1>
      <p>
        {premium
          ? "ברוכים הבאים ל-GOT URS Premium"
          : "ההרפתקה שלך מתחילה עכשיו..."}
      </p>

      <div className="success-screen__doors" aria-hidden>
        <div className="door door--left" />
        <div className="door door--right" />
        <div className="door-light">
          <span className="door-cube">❒</span>
        </div>
      </div>

      <div className="success-card">
        <div className="success-card__check">✓</div>
        <h2>{paid ? "!ההזמנה שולמה בביט" : "!ההזמנה הושלמה"}</h2>
        <p>
          {premium
            ? "החשבון שודרג לפרימיום"
            : room
              ? `${room.title} מחכה לך`
              : "ניפגש בחדר"}
          ...
        </p>
        {paid && amount > 0 ? (
          <p className="sync-ok">
            {formatIls(amount)} · {method === "bit" ? "ביט" : method}
          </p>
        ) : null}
        <GlowButton onClick={() => navigate("/app/home")}>
          ‹ לעמוד הבית
        </GlowButton>
      </div>
    </div>
  );
}
