import { Link, useNavigate } from "react-router-dom";
import { GlowButton } from "../components/GlowButton";
import { Logo } from "../components/Logo";
import { useAuth } from "../context/AuthContext";

export function WelcomePage() {
  const navigate = useNavigate();
  const { continueAsGuest } = useAuth();

  return (
    <div className="screen welcome-screen">
      <div className="welcome-screen__glow" aria-hidden />
      <Logo size="lg" />
      <p className="welcome-screen__tagline">
        האפליקציה שלך להרגיש בלתי נשכחת
      </p>

      <div className="welcome-screen__hero">
        <img
          src="https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=900&q=80"
          alt=""
          className="welcome-screen__image"
        />
        <div className="welcome-screen__fade" />
      </div>

      <div className="welcome-screen__actions">
        <GlowButton onClick={() => navigate("/app/home")}>
          <span>✦</span> התחל עכשיו <span>‹</span>
        </GlowButton>
        <GlowButton variant="ghost" onClick={() => navigate("/login")}>
          <span className="ghost-avatar" aria-hidden>
            ☺
          </span>
          התחבר
        </GlowButton>
        <button
          type="button"
          className="text-link"
          onClick={() => {
            continueAsGuest();
            navigate("/app/home");
          }}
        >
          כניסת אורחים ›
        </button>
        <p className="welcome-screen__hint">
          כבר יש חשבון?{" "}
          <Link to="/login">התחבר/י</Link> כדי לסנכרן לטלפון אחר
        </p>
      </div>
    </div>
  );
}
