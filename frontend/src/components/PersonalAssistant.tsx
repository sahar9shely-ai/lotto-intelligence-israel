import { FormEvent, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";
import { downloadAssistantPdf } from "../utils/assistantPdf";

type Msg = { role: "user" | "assistant"; content: string };

export function PersonalAssistant() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "היי, אני העוזר האישי שלך לתיק. אפשר לשאול על הקרן, ההחזר החודשי, החיסכון, או לחשב מה קורה אם מוסיפים סכום.",
    },
  ]);
  const [note, setNote] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  if (!user) return null;

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setBusy(true);
    setNote(null);
    try {
      const res = await api.assistantChat({ message: text, history });
      setMessages((prev) => [...prev, { role: "assistant", content: res.reply }]);
      if (res.pdf_suggested) {
        setNote("אפשר להוריד סיכום PDF מהכפתור למטה");
      }
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

  async function closeAndNotify() {
    setBusy(true);
    try {
      const history = messages
        .filter((m) => m.content)
        .map((m) => ({ role: m.role, content: m.content }));
      const res = await api.assistantEndSession({ history });
      setNote(res.detail || "השיחה נסגרה");
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
      setNote("ה־PDF ירד למכשיר");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "הורדת PDF נכשלה");
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
            <div>
              <strong>עוזר אישי</strong>
              <span className="muted">
                {user.investor_name || user.username} · רק התיק שלך
              </span>
            </div>
            <div className="assistant-panel__head-actions">
              <button type="button" className="btn btn--small btn--ghost" onClick={exportPdf} disabled={busy}>
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

          <div className="assistant-panel__messages">
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
            <div ref={bottomRef} />
          </div>

          {note ? <p className="assistant-panel__note">{note}</p> : null}

          <form className="assistant-panel__form" onSubmit={send}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="למשל: מה הקרן שלי? או אם אוסיף 10000 כמה יוצא?"
              disabled={busy}
              aria-label="הודעה לעוזר האישי"
            />
            <button type="submit" className="btn btn--primary" disabled={busy || !input.trim()}>
              {busy ? "..." : "שלח"}
            </button>
          </form>
          <p className="assistant-panel__hint muted">
            מזומן וחיסכון בנפרד · בלי שינוי במערכת · רק התיק שלך
          </p>
        </section>
      ) : null}
    </>
  );
}
