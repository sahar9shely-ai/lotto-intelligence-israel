import { Link, useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { GlowButton } from "../components/GlowButton";
import { CATEGORIES } from "../data/rooms";

export function HomePage() {
  const navigate = useNavigate();

  return (
    <AppShell showMenu>
      <section className="hero-block">
        <div className="hero-block__media">
          <img
            src="https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=900&q=80"
            alt=""
          />
          <div className="hero-block__overlay">
            <h1>חדרים בהפתעה</h1>
            <p>כל חדר משהו אחר... אתם בוחרים, אנחנו מפתיעים</p>
            <GlowButton onClick={() => navigate("/app/surprise")}>
              התחל עכשיו ✦
            </GlowButton>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">
          <span>✦</span> בחרו את סוג ההפתעה <span>✦</span>
        </h2>
        <div className="room-grid">
          {CATEGORIES.map((cat) => (
            <Link
              key={cat.id}
              to={`/app/rooms/${cat.id}`}
              className="room-card"
              style={{ backgroundImage: `url(${cat.image})` }}
            >
              <div className="room-card__veil" />
              <span className="room-card__icon">{cat.icon}</span>
              <div className="room-card__text">
                <strong>{cat.title}</strong>
                <span>{cat.subtitle}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <button
        type="button"
        className="ready-banner"
        onClick={() => navigate("/app/surprise")}
      >
        <span className="ready-banner__gift" aria-hidden>
          ❒
        </span>
        <span className="ready-banner__text">
          <strong>אני מוכן/ה להפתעה</strong>
          <small>תנו לנו לבחור בשבילכם</small>
        </span>
        <span className="ready-banner__arrow" aria-hidden>
          ‹
        </span>
      </button>
    </AppShell>
  );
}
