import { useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { GlowButton } from "../components/GlowButton";
import { useAuth } from "../context/AuthContext";
import { getRoomById, ROOMS } from "../data/rooms";

export function RoomDetailPage() {
  const { roomId = "" } = useParams();
  const navigate = useNavigate();
  const { user, toggleFavorite, openRoom } = useAuth();
  const room = getRoomById(roomId) ?? ROOMS[0];
  const liked = user.favorites.includes(room.id);
  const index = Math.max(1, ROOMS.findIndex((r) => r.id === room.id) + 1);

  async function startExperience() {
    if (room.locked && !user.isPremium) {
      navigate("/app/premium");
      return;
    }
    await openRoom(room.id);
    navigate(`/app/success?room=${encodeURIComponent(room.id)}`);
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
          <h1>{room.title}</h1>
          <p>{room.description}</p>
          <GlowButton onClick={() => void startExperience()}>
            התחל את החוויה
          </GlowButton>
        </div>
      </section>
    </AppShell>
  );
}
