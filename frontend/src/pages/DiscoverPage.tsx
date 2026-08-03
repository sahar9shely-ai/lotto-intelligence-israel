import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { CATEGORIES, ROOMS, type RoomCategory } from "../data/rooms";

const FILTERS: Array<{ id: "all" | "new" | RoomCategory; label: string }> = [
  { id: "all", label: "הכל" },
  { id: "new", label: "חדש" },
  ...CATEGORIES.map((c) => ({ id: c.id as RoomCategory, label: c.title.replace("חדר ", "") })),
];

export function DiscoverPage() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");

  const rooms = useMemo(() => {
    return ROOMS.filter((room) => {
      if (filter === "new" && !room.isNew) return false;
      if (filter !== "all" && filter !== "new" && room.category !== filter) {
        return false;
      }
      if (!query.trim()) return true;
      const q = query.trim();
      return room.title.includes(q) || room.subtitle.includes(q);
    });
  }, [filter, query]);

  return (
    <AppShell>
      <section className="section">
        <h1 className="page-title">לגלות עוד</h1>
        <label className="search-field">
          <span aria-hidden>⌕</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש חדרים..."
          />
        </label>
        <div className="chip-row">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`chip${filter === item.id ? " is-active" : ""}`}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="discover-list">
          {rooms.map((room) => (
            <Link
              key={room.id}
              to={`/app/room/${room.id}`}
              className="discover-card"
            >
              <img src={room.image} alt="" />
              <div>
                <div className="discover-card__top">
                  <strong>{room.title}</strong>
                  {room.isNew ? <span className="badge">חדש</span> : null}
                  {room.premium ? <span className="badge badge--gold">פרימיום</span> : null}
                </div>
                <p>{room.subtitle}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
