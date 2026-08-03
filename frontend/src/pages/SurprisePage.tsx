import { useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { GlowButton } from "../components/GlowButton";
import { pickSurpriseRoom } from "../data/rooms";
import { useAuth } from "../context/AuthContext";

export function SurprisePage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  function surpriseMe() {
    const room = pickSurpriseRoom(user.openedRooms);
    navigate(`/app/loading?room=${encodeURIComponent(room.id)}`);
  }

  return (
    <AppShell showBack backTo="/app/home" hideNav>
      <section className="surprise-screen">
        <h1>בחרי חדר בהפתעה</h1>
        <p>ותני לנו לבחור עבורך...</p>

        <div className="mystery-cube" aria-hidden>
          <div className="mystery-cube__glow" />
          <div className="mystery-cube__box">?</div>
          <span className="mystery-cube__heart">♡</span>
        </div>

        <ul className="feature-bullets">
          <li>כל חדר — חוויה אחרת</li>
          <li>מותאם לאווירה שלך</li>
          <li>הפתעה חדשה בכל פעם</li>
        </ul>

        <GlowButton onClick={surpriseMe}>הפתיעי אותי ✨</GlowButton>
        <button
          type="button"
          className="text-link"
          onClick={() => navigate("/app/manual")}
        >
          בחירת חדר ידנית
        </button>
        <p className="secure-note">100% דיסקרטי ובטוח</p>
      </section>
    </AppShell>
  );
}
