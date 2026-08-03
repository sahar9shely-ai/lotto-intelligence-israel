import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Logo } from "../components/Logo";
import { getRoomById, pickSurpriseRoom } from "../data/rooms";

export function LoadingPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const roomId = params.get("room") || pickSurpriseRoom().id;

  useEffect(() => {
    const room = getRoomById(roomId) ?? pickSurpriseRoom();
    const timer = window.setTimeout(() => {
      navigate(`/app/room/${room.id}`, { replace: true });
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [navigate, roomId]);

  return (
    <div className="screen loading-screen">
      <Logo size="sm" />
      <div className="loading-screen__door">
        <img
          src="https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=900&q=80"
          alt=""
        />
        <div className="loading-screen__light" />
      </div>
      <h1>פותחים חוויה חדשה</h1>
      <p>ההרפתקה שלך מתחילה עכשיו...</p>
      <div className="pulse-heart" aria-hidden>
        ♡
      </div>
    </div>
  );
}
