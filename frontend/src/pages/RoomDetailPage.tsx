import { useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { GlowButton } from "../components/GlowButton";
import { useAuth } from "../context/AuthContext";
import { formatIls, getRoomById, ROOMS } from "../data/rooms";

export function RoomDetailPage() {
  const { roomId = "" } = useParams();
  const navigate = useNavigate();
  const { user, toggleFavorite } = useAuth();
  const room = getRoomById(roomId) ?? ROOMS[0];
  const liked = user.favorites.includes(room.id);
  const alreadyOwned = user.openedRooms.includes(room.id);
  const index = Math.max(1, ROOMS.findIndex((r) => r.id === room.id) + 1);

  function startExperience() {
    if (room.locked && !user.isPremium) {
      navigate("/app/premium");
      return;
    }
    if (alreadyOwned || (room.premium && user.isPremium)) {
      navigate(`/app/success?room=${encodeURIComponent(room.id)}`);
      return;
    }
    navigate(`/app/pay?kind=room&item=${encodeURIComponent(room.id)}`);
  }

  return (
    <AppShell showBack backTo="/app/discover" hideNav>
      <section className="room-detail">
        <div className="room-detail__hero">
          <img src={room.image} alt="" />
          <div className="room-detail__meta">
            <span>
              {index}/{ROOMS.length}
            </span>
            <button
              type="button"
              className={`heart-btn${liked ? " is-on" : ""}`}
              aria-label="מועדף"
              onClick={() => void toggleFavorite(room.id)}
            >
              {liked ? "♥" : "♡"}
            </button>
          </div>
        </div>
        <div className="room-detail__body">
          <div className="room-detail__price-row">
            <h1>{room.title}</h1>
            <span className="price-tag">{formatIls(room.priceIls)}</span>
          </div>
          <p>{room.description}</p>
          {room.premium ? (
            <p className="page-sub">חדר פרימיום · ניתן גם לשדרג ולפתוח בחינם</p>
          ) : null}
          <GlowButton onClick={startExperience}>
            {alreadyOwned
              ? "היכנסו לחדר"
              : `הזמינו בביט · ${formatIls(room.priceIls)}`}
          </GlowButton>
          <p className="secure-note">תשלום מאובטח באפליקציית ביט</p>
        </div>
      </section>
    </AppShell>
  );
}
