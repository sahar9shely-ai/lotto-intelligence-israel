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
      content: "היי, מה שלומך? 😊\nאני כאן לעזור לך בכל שאלה על התיק.",
    },
  ]);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
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
    try {
      const res = await api.assistantChat({ message: text, history });
      setMessages((prev) => [...prev, { role: "assistant", content: res.reply }]);
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

          <form className="assistant-panel__form" onSubmit={send}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="כתבו כאן…"
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
