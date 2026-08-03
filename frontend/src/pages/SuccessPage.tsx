import { useNavigate, useSearchParams } from "react-router-dom";
import { GlowButton } from "../components/GlowButton";
import { Logo } from "../components/Logo";
import { getRoomById } from "../data/rooms";

export function SuccessPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const room = getRoomById(params.get("room") || "");

  return (
    <div className="screen success-screen">
      <button
        type="button"
        className="icon-btn success-screen__back"
        onClick={() => navigate(-1)}
        aria-label="חזרה"
      >
        ›
      </button>
      <Logo size="sm" />
      <h1>פותחים חוויה חדשה</h1>
      <p>ההרפתקה שלך מתחילה עכשיו...</p>

      <div className="success-screen__doors" aria-hidden>
        <div className="door door--left" />
        <div className="door door--right" />
        <div className="door-light">
          <span className="door-cube">❒</span>
        </div>
      </div>

      <div className="success-card">
        <div className="success-card__check">✓</div>
        <h2>!ההזמנה הושלמה</h2>
        <p>{room ? `${room.title} מחכה לך` : "ניפגש בחדר"}...</p>
        <GlowButton onClick={() => navigate("/app/home")}>
          ‹ לעמוד הבית
        </GlowButton>
      </div>
    </div>
  );
}
