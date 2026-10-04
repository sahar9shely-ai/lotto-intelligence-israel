import { FormEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";
import { downloadAssistantPdf } from "../utils/assistantPdf";
import type { AuthUser } from "../types/auth";
import type { AssistantPaymentAction } from "../types/assistant";

type Msg = { role: "user" | "assistant"; content: string };
type Suggestion = { label: string; message: string };
type Cta = { href: string; label: string };

const FALLBACK_GREETING = "שלום. אפשר לשאול על התיק, התשלום הבא, או על הוספת השקעה.";

export function PersonalAssistant() {
  const { user } = useAuth();
  if (!user) return null;
  return <AssistantConversation key={`${user.id}:${user.investor_id}:${user.username}:${user.role}:${user.is_manager}`} user={user}/>;
}

function AssistantConversation({user}: {user: AuthUser}) {
  const canQueryAll = user.username === "admin" && user.is_manager;
  const mounted = useRef(true);
  const requestVersion = useRef(0);
  const busyRef = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestVersion.current += 1;
    };
  }, []);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [cta, setCta] = useState<Cta | null>(null);
  const [action, setAction] = useState<AssistantPaymentAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [llmReady, setLlmReady] = useState<boolean | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open, action, actionError]);

  function isCurrent(version: number) {
    return mounted.current && version === requestVersion.current;
  }

  function clearAction() {
    setAction(null);
    setActionError(null);
  }

  function closeConversation() {
    requestVersion.current += 1;
    busyRef.current = false;
    setBusy(false);
    setConfirming(false);
    clearAction();
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const version = ++requestVersion.current;
    clearAction();
    api
      .assistantOpening()
      .then((opening) => {
        if (cancelled || !isCurrent(version)) return;
        setMessages([{ role: "assistant", content: opening.greeting }]);
        setSuggestions(opening.suggestions || []);
        setCta(opening.cta || null);
        setLlmReady(Boolean(opening.configured));
      })
      .catch(() => {
        if (cancelled || !isCurrent(version)) return;
        setMessages([{ role: "assistant", content: FALLBACK_GREETING }]);
        setSuggestions([
          { label: "מה המצב שלי", message: "מה המצב שלי?" },
          { label: "הוספת השקעה", message: "איך מוסיפים השקעה או מבקשים תוספת?" },
        ]);
        setCta(
          canQueryAll
            ? { href: "/quotes", label: "לפתיחת הצעה חדשה" }
            : { href: "/investors?action=topup", label: "לבקש תוספת או מסלול" },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [open, canQueryAll]);

  async function sendText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busyRef.current) return;
    const version = ++requestVersion.current;
    busyRef.current = true;
    clearAction();
    setCta(null);
    setInput("");
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setBusy(true);
    try {
      const res = await api.assistantChat({ message: trimmed, history });
      if (!isCurrent(version)) return;
      setMessages((prev) => [...prev, { role: "assistant", content: res.reply }]);
      if (typeof res.configured === "boolean") setLlmReady(res.configured);
      const nextAction = canQueryAll && res.action?.kind === "payment_confirmation_request"
        ? res.action
        : null;
      setAction(nextAction);
      setCta(nextAction ? null : res.cta || null);
      if (nextAction) setSuggestions([]);
      else if (res.suggestions) setSuggestions(res.suggestions);
    } catch (err) {
      if (!isCurrent(version)) return;
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: err instanceof Error ? err.message : "לא הצלחתי לענות כרגע",
        },
      ]);
    } finally {
      if (!isCurrent(version)) return;
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function confirmAction() {
    if (!canQueryAll || !action || busyRef.current) return;
    const version = ++requestVersion.current;
    busyRef.current = true;
    setBusy(true);
    setConfirming(true);
    setActionError(null);
    try {
      const result = await api.assistantConfirmAction({ token: action.token });
      if (!isCurrent(version)) return;
      clearAction();
      setCta(null);
      setMessages((prev) => [...prev, { role: "assistant", content: result.reply }]);
    } catch (err) {
      if (!isCurrent(version)) return;
      setActionError(err instanceof Error ? err.message : "לא הצלחתי לשלוח כרגע. אפשר לנסות שוב.");
    } finally {
      if (!isCurrent(version)) return;
      busyRef.current = false;
      setBusy(false);
      setConfirming(false);
    }
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    await sendText(input);
  }

  async function closeAndNotify() {
    if (busyRef.current) return;
    const version = ++requestVersion.current;
    busyRef.current = true;
    clearAction();
    setBusy(true);
    try {
      const history = messages
        .filter((m) => m.content)
        .map((m) => ({ role: m.role, content: m.content }));
      await api.assistantEndSession({ history });
    } catch {
      /* ignore */
    } finally {
      if (isCurrent(version)) closeConversation();
    }
  }

  async function exportPdf() {
    if (busyRef.current) return;
    const version = requestVersion.current;
    busyRef.current = true;
    setBusy(true);
    try {
      const brief = await api.assistantPortfolioBrief();
      if (!isCurrent(version)) return;
      await downloadAssistantPdf({
        name: brief.investor_name,
        brief,
        transcript: messages,
      });
    } catch {
      /* silent — keep the chat clean */
    } finally {
      if (!isCurrent(version)) return;
      busyRef.current = false;
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
        aria-label={open ? "סגירת העוזר האישי" : "עוזר אישי"}
        onClick={() => open ? closeConversation() : setOpen(true)}
      >
        <svg className="assistant-mascot" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
          <ellipse cx="32" cy="59" rx="18" ry="3" fill="#143b30" opacity=".12"/>
          <path d="M21 49 18 56M43 49 46 56" stroke="#185c46" strokeWidth="4" strokeLinecap="round"/>
          <path d="M13 32 7 37M51 29 57 22 55 17" fill="none" stroke="#185c46" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx="32" cy="31" r="23" fill="#bd9254"/>
          <circle cx="32" cy="30" r="21" fill="#d6f6d9" stroke="#185c46" strokeWidth="2"/>
          <circle cx="32" cy="30" r="17.5" fill="none" stroke="#63ac7a" strokeWidth="1" opacity=".6"/>
          <text x="32" y="24" textAnchor="middle" fontFamily="Arial,sans-serif" fontWeight="bold" fontSize="13" fill="#185c46">₪</text>
          <ellipse cx="25" cy="31" rx="2.1" ry="2.8" fill="#143b30"/>
          <ellipse cx="39" cy="31" rx="2.1" ry="2.8" fill="#143b30"/>
          <path d="M26 39q6 6 12 0" fill="none" stroke="#143b30" strokeWidth="2" strokeLinecap="round"/>
          <ellipse cx="21" cy="37" rx="3" ry="1.6" fill="#f1b6a5" opacity=".7"/>
          <ellipse cx="43" cy="37" rx="3" ry="1.6" fill="#f1b6a5" opacity=".7"/>
          <path d="m49 7 1.5-4 1.5 4 4 1.5-4 1.5-1.5 4L49 10l-4-1.5Z" fill="#bd9254"/>
        </svg>
        <span className="assistant-fab__label">עוזר אישי</span>
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
            {canQueryAll && action ? (
              <section className="assistant-action" aria-label="אישור שליחת בקשת קבלה" aria-busy={confirming}>
                <h3>בקשת אישור קבלה</h3>
                <dl className="assistant-action__details">
                  <div><dt>משקיע</dt><dd>{action.investor_name}</dd></div>
                  <div><dt>חודש</dt><dd>{action.month_label}</dd></div>
                  <div><dt>סכום</dt><dd>{new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 2 }).format(action.amount)}</dd></div>
                </dl>
                <p className="assistant-action__note">הבקשה מיועדת לאישור קבלת תשלום שכבר הועבר.</p>
                {actionError ? <p className="assistant-action__error" role="alert">{actionError}</p> : null}
                <div className="assistant-action__buttons">
                  <button type="button" className="btn btn--primary" onClick={() => void confirmAction()} disabled={busy}>
                    {confirming ? "שולח בקשת אישור…" : "שלח בקשת אישור קבלה"}
                  </button>
                  <button type="button" className="btn btn--ghost" onClick={clearAction} disabled={busy}>ביטול</button>
                </div>
              </section>
            ) : null}
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

          {canQueryAll && llmReady === false ? (
            <p className="assistant-llm-hint">
              המודל לא מחובר. חברו מפתח ב
              <Link to="/settings" onClick={closeConversation}>
                הגדרות
              </Link>
              {" "}
              או GEMINI_API_KEY ב־Render.
            </p>
          ) : null}

          {cta?.href ? (
            <Link className="assistant-cta" to={cta.href} onClick={closeConversation}>
              {cta.label}
            </Link>
          ) : null}

          <form className="assistant-panel__form" onSubmit={send}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                canQueryAll
                  ? "שאלה על משקיע, קרן, תשלומים או הצעות…"
                  : "שאלה על התיק או על תוספת…"
              }
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
