import { FormEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";
import { downloadAssistantPdf } from "../utils/assistantPdf";

type Msg = { role: "user" | "assistant"; content: string };
type Suggestion = { label: string; message: string };
type Cta = { href: string; label: string };

const FALLBACK_GREETING = "שלום. אפשר לשאול על התיק, התשלום הבא, או על הוספת השקעה.";

export function PersonalAssistant() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [cta, setCta] = useState<Cta | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    api
      .assistantOpening()
      .then((opening) => {
        if (cancelled) return;
        setMessages([{ role: "assistant", content: opening.greeting }]);
        setSuggestions(opening.suggestions || []);
        setCta(opening.cta || null);
      })
      .catch(() => {
        if (cancelled) return;
        setMessages([{ role: "assistant", content: FALLBACK_GREETING }]);
        setSuggestions([
          { label: "מה המצב שלי", message: "מה המצב שלי?" },
          { label: "הוספת השקעה", message: "איך מוסיפים השקעה או מבקשים תוספת?" },
        ]);
        setCta(
          user.is_manager
            ? { href: "/quotes", label: "לפתיחת הצעה חדשה" }
            : { href: "/investors?action=topup", label: "לבקש תוספת או מסלול" },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [open, user]);

  if (!user) return null;

  async function sendText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setBusy(true);
    try {
      const res = await api.assistantChat({ message: trimmed, history });
      setMessages((prev) => [...prev, { role: "assistant", content: res.reply }]);
      if (res.cta?.href && res.cta.label) setCta(res.cta);
      if (res.suggestions?.length) setSuggestions(res.suggestions);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: err instanceof Error ? err.message : "לא הצלחתי לענות כרגע",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    await sendText(input);
  }

  async function closeAndNotify() {
    setBusy(true);
    try {
      const history = messages
        .filter((m) => m.content)
        .map((m) => ({ role: m.role, content: m.content }));
      await api.assistantEndSession({ history });
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  async function exportPdf() {
    setBusy(true);
    try {
      const brief = await api.assistantPortfolioBrief();
      await downloadAssistantPdf({
        name: brief.investor_name,
        brief,
        transcript: messages,
      });
    } catch {
      /* silent — keep the chat clean */
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={open ? "assistant-fab is-open" : "assistant-fab"}
        aria-expanded={open}
        aria-controls="personal-assistant-panel"
        onClick={() => setOpen((v) => !v)}
      >
        עוזר אישי
      </button>

      {open ? (
        <section
          id="personal-assistant-panel"
          className="assistant-panel"
          role="dialog"
          aria-label="עוזר אישי"
        >
          <header className="assistant-panel__head">
            <h2 className="assistant-panel__title">עוזר אישי</h2>
            <div className="assistant-panel__head-actions">
              <button
                type="button"
                className="btn btn--small btn--ghost"
                onClick={exportPdf}
                disabled={busy}
                title="הורדת סיכום"
              >
                PDF
              </button>
              <button
                type="button"
                className="btn btn--small btn--ghost"
                onClick={closeAndNotify}
                disabled={busy}
              >
                סיום
              </button>
            </div>
          </header>

          <div className="assistant-panel__messages" ref={listRef}>
            {messages.map((m, i) => (
              <div
                key={`${m.role}-${i}`}
                className={
                  m.role === "user"
                    ? "assistant-bubble assistant-bubble--user"
                    : "assistant-bubble assistant-bubble--bot"
                }
              >
                {m.content.split("\n").map((line, li) => (
                  <p key={li}>{line || "\u00a0"}</p>
                ))}
              </div>
            ))}
            {busy ? (
              <div className="assistant-bubble assistant-bubble--bot assistant-typing" aria-hidden>
                <span />
                <span />
                <span />
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>

          {suggestions.length > 0 ? (
            <div className="assistant-chips" role="group" aria-label="שאלות מוצעות">
              {suggestions.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  className="assistant-chip"
                  disabled={busy}
                  onClick={() => void sendText(chip.message)}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          ) : null}

          {cta?.href ? (
            <Link className="assistant-cta" to={cta.href} onClick={() => setOpen(false)}>
              {cta.label}
            </Link>
          ) : null}

          <form className="assistant-panel__form" onSubmit={send}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="שאלה על התיק או על תוספת…"
              disabled={busy}
              aria-label="הודעה לעוזר האישי"
            />
            <button
              type="submit"
              className="btn btn--primary assistant-send"
              disabled={busy || !input.trim()}
            >
              שלח
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}
