import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { GlowButton } from "../components/GlowButton";
import { CATEGORIES, getRoomsByCategory, type RoomCategory } from "../data/rooms";

export function ManualSelectPage() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<RoomCategory>("romantic");

  return (
    <AppShell showBack backTo="/app/surprise" hideNav title="בחר חדר הפתעה">
      <section className="section">
        <h1 className="page-title">בחר חדר הפתעה</h1>
        <p className="page-sub">כל חדר — חוויה אחרת</p>
        <div className="room-grid room-grid--select">
          {CATEGORIES.map((cat) => {
            const active = selected === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                className={`room-card room-card--button${active ? " is-selected" : ""}`}
                style={{ backgroundImage: `url(${cat.image})` }}
                onClick={() => setSelected(cat.id)}
              >
                <div className="room-card__veil" />
                {active ? <span className="room-card__check">✓</span> : null}
                <span className="room-card__icon">{cat.icon}</span>
                <div className="room-card__text">
                  <strong>{cat.title.replace("חדר ", "")}</strong>
                  <span>{cat.subtitle}</span>
                </div>
              </button>
            );
          })}
        </div>
        <GlowButton
          onClick={() => {
            const rooms = getRoomsByCategory(selected);
            const room = rooms[0];
            if (room) navigate(`/app/loading?room=${encodeURIComponent(room.id)}`);
          }}
        >
          !הפתיעו אותי ✦
        </GlowButton>
        <p className="secure-note">100% דיסקרטי ובטוח</p>
      </section>
    </AppShell>
  );
}

export function CategoryRoomsPage() {
  const { categoryId = "romantic" } = useParams();
  const rooms = useMemo(
    () => getRoomsByCategory(categoryId as RoomCategory),
    [categoryId],
  );
  const category = CATEGORIES.find((c) => c.id === categoryId);

  return (
    <AppShell showBack backTo="/app/home" hideNav>
      <section className="section">
        <h1 className="page-title">{category?.title ?? "חדרים"}</h1>
        <p className="page-sub">{category?.subtitle}</p>
        <div className="discover-list">
          {rooms.map((room) => (
            <Link key={room.id} to={`/app/room/${room.id}`} className="discover-card">
              <img src={room.image} alt="" />
              <div>
                <strong>{room.title}</strong>
                <p>{room.subtitle}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
