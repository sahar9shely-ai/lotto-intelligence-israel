import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { useAuth } from "../context/AuthContext";
import {
  api,
  type BotReply,
  type CommunityMessage,
  type OnlineUser,
} from "../services/api";

type Tab = "live" | "bot";

interface BotMessage {
  id: string;
  role: "user" | "bot";
  text: string;
  at: string;
  suggestions?: BotReply["suggestions"];
}

const GUEST_ID_KEY = "goturs_guest_chat_id";

function getGuestId(): string {
  let id = localStorage.getItem(GUEST_ID_KEY);
  if (!id) {
    id = `guest_${crypto.randomUUID().slice(0, 8)}`;
    localStorage.setItem(GUEST_ID_KEY, id);
  }
  return id;
}

const BOT_STARTER: BotMessage = {
  id: "bot-hello",
  role: "bot",
  text:
    "היי, אני העוזרת של GOT URS 💜\nספרי לי מה בא לך — רומנטי, פינוק, מסיבה, הפתעה או פרימיום — ואעזור לך לסגור חדר בביט.",
  at: new Date().toISOString(),
  suggestions: [
    { label: "רומנטי", path: "/app/pay?kind=room&item=romantic-1" },
    { label: "הפתיעי אותי", path: "/app/surprise" },
    { label: "פרימיום", path: "/app/pay?kind=premium&item=premium-month" },
  ],
};

export function ChatPage() {
  const navigate = useNavigate();
  const { user, token, isGuest } = useAuth();
  const [tab, setTab] = useState<Tab>("live");
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [online, setOnline] = useState<OnlineUser[]>([]);
  const [selfId, setSelfId] = useState("");
  const [botMessages, setBotMessages] = useState<BotMessage[]>([BOT_STARTER]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const guest = useMemo(
    () =>
      isGuest
        ? { guestId: getGuestId(), guestName: user.name || "אורח/ת" }
        : undefined,
    [isGuest, user.name],
  );

  useEffect(() => {
    let cancelled = false;

    async function pull() {
      try {
        const feed = await api.getCommunity(token, guest);
        if (cancelled) return;
        setMessages(feed.messages);
        setOnline(feed.online);
        setSelfId(feed.selfId);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "שגיאת קהילה");
        }
      }
    }

    void pull();
    const timer = window.setInterval(() => {
      void pull();
      void api.presence(token, guest).catch(() => undefined);
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [token, guest]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, botMessages, tab]);

  async function sendLive(e: FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setText("");
    setBusy(true);
    try {
      const feed = await api.sendCommunity(value, token, guest);
      setMessages(feed.messages);
      setOnline(feed.online);
      setSelfId(feed.selfId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שליחה נכשלה");
      setText(value);
    } finally {
      setBusy(false);
    }
  }

  async function sendBot(value: string) {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setBotMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "user",
        text: trimmed,
        at: new Date().toISOString(),
      },
    ]);
    try {
      const reply = await api.botChat(trimmed);
      setBotMessages((prev) => [
        ...prev,
        {
          id: reply.id,
          role: "bot",
          text: reply.text,
          at: reply.at,
          suggestions: reply.suggestions,
        },
      ]);
    } catch (err) {
      setBotMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "bot",
          text: err instanceof Error ? err.message : "הבוט לא זמין כרגע",
          at: new Date().toISOString(),
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function onBotSubmit(e: FormEvent) {
    e.preventDefault();
    const value = text;
    setText("");
    await sendBot(value);
  }

  return (
    <AppShell>
      <section className="chat-screen community-screen">
        <div className="chat-screen__head">
          <h1>קהילה חיה</h1>
          <p>
            {online.length} מחוברים עכשיו · כולם עם כולם
          </p>
        </div>

        <div className="community-tabs">
          <button
            type="button"
            className={`community-tabs__btn${tab === "live" ? " is-active" : ""}`}
            onClick={() => setTab("live")}
          >
            צ'אט חי
          </button>
          <button
            type="button"
            className={`community-tabs__btn${tab === "bot" ? " is-active" : ""}`}
            onClick={() => setTab("bot")}
          >
            עוזרת לסגירת חדר
          </button>
        </div>

        {tab === "live" ? (
          <>
            <div className="online-row" aria-label="מחוברים">
              {online.length === 0 ? (
                <span className="online-row__empty">מחכים לחברים...</span>
              ) : (
                online.map((person) => (
                  <span
                    key={person.id}
                    className={`online-chip${person.id === selfId ? " is-me" : ""}`}
                  >
                    <i />
                    {person.name}
                  </span>
                ))
              )}
            </div>

            <div className="chat-thread" ref={threadRef}>
              {messages.length === 0 ? (
                <div className="community-empty">
                  <p>עדיין שקט כאן...</p>
                  <small>כתבו משהו — כל מי שמחובר יראה אותכם</small>
                </div>
              ) : (
                messages.map((msg) => {
                  const mine = msg.userId === selfId;
                  return (
                    <div
                      key={msg.id}
                      className={`bubble community-bubble${mine ? " bubble--me" : " bubble--them"}`}
                    >
                      {!mine ? (
                        <strong className="community-bubble__name">{msg.name}</strong>
                      ) : null}
                      <span>{msg.text}</span>
                    </div>
                  );
                })
              )}
            </div>

            {error ? <p className="form-error">{error}</p> : null}

            <form className="chat-input" onSubmit={sendLive}>
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="כתבו לכולם בקהילה..."
                maxLength={500}
              />
              <button type="submit" aria-label="שלח" disabled={busy}>
                ➤
              </button>
            </form>
          </>
        ) : (
          <>
            <div className="chat-thread" ref={threadRef}>
              {botMessages.map((msg) => (
                <div key={msg.id}>
                  <div
                    className={`bubble${msg.role === "user" ? " bubble--me" : " bubble--bot"}`}
                  >
                    {msg.role === "bot" ? (
                      <strong className="community-bubble__name">עוזרת GOT URS</strong>
                    ) : null}
                    <span style={{ whiteSpace: "pre-wrap" }}>{msg.text}</span>
                  </div>
                  {msg.suggestions?.length ? (
                    <div className="bot-suggestions">
                      {msg.suggestions.map((s) => (
                        <button
                          key={`${msg.id}-${s.path}-${s.label}`}
                          type="button"
                          className="bot-chip"
                          onClick={() => navigate(s.path)}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="bot-quick">
              {["רומנטי", "פינוק", "הפתעה", "פרימיום", "כמה זה עולה"].map((q) => (
                <button
                  key={q}
                  type="button"
                  className="bot-chip"
                  onClick={() => void sendBot(q)}
                  disabled={busy}
                >
                  {q}
                </button>
              ))}
            </div>

            <form className="chat-input" onSubmit={onBotSubmit}>
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="שאלו את הבוט איזה חדר לסגור..."
                maxLength={500}
              />
              <button type="submit" aria-label="שלח" disabled={busy}>
                ➤
              </button>
            </form>
          </>
        )}
      </section>
    </AppShell>
  );
}
