import { FormEvent, useCallback, useEffect, useState } from "react";
import { useConfirm } from "../components/ConfirmDialog";
import { Panel } from "../components/Panel";
import { disableIdentityAutofill, PasswordField } from "../components/PasswordField";
import { Toast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import type { AuthUser, PasswordResetRequestItem } from "../types/auth";
import { formatDate } from "../utils/format";
import { formatPhoneDisplay, toWhatsAppNumber, whatsAppAccessUrl } from "../utils/whatsapp";

function lockPageScroll() {
  const body = document.body;
  const previousOverflow = body.style.overflow;
  body.classList.add("modal-open");
  body.style.overflow = "hidden";
  return () => {
    body.classList.remove("modal-open");
    body.style.overflow = previousOverflow;
  };
}

function readPassword(fd: FormData, name: string) {
  return String(fd.get(name) || "");
}

function accessShareTarget(
  user: AuthUser,
  passwordOverride?: string,
): {
  name: string;
  phone?: string | null;
  access_username?: string | null;
  access_password?: string | null;
} {
  return {
    name: user.investor_name,
    phone: user.phone,
    access_username: user.username,
    access_password: passwordOverride || user.access_password,
  };
}

function canSendAccess(user: AuthUser, passwordOverride?: string): boolean {
  const password = passwordOverride || user.access_password;
  return Boolean(toWhatsAppNumber(user.phone) && user.username && password && user.has_password);
}

export function UsersPage() {
  const { user: currentUser } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { data: users, error, loading, reload, setData } = useAsync(() => api.users(), []);
  const {
    data: resetRequests,
    reload: reloadRequests,
  } = useAsync(() => api.passwordResetRequests(true), []);
  const { data: siteStatus } = useAsync(() => api.siteStatus(), []);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [fulfillTarget, setFulfillTarget] = useState<PasswordResetRequestItem | null>(null);
  const [fulfillPassword, setFulfillPassword] = useState("");
  const [savingId, setSavingId] = useState<number | "create" | "fulfill" | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<number, string>>({});
  const [formRev, setFormRev] = useState<Record<number, number>>({});
  const [focusPasswordUserId, setFocusPasswordUserId] = useState<number | null>(null);
  const clearMessage = useCallback(() => setMessage(null), []);
  const publicUrl = siteStatus?.public_url || window.location.origin;

  function jumpToUserPassword(userId: number) {
    setFocusPasswordUserId(userId);
    window.requestAnimationFrame(() => {
      const card = document.getElementById(`user-card-${userId}`);
      const details = card?.querySelector("details.user-editor");
      if (details instanceof HTMLDetailsElement) details.open = true;
      const input = document.getElementById(`new-password-${userId}`);
      const target = input ?? card;
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (input instanceof HTMLInputElement) {
        window.setTimeout(() => input.focus(), 280);
      }
    });
  }

  function showSaveError(userId: number | null, text: string) {
    setErrorMsg(text);
    if (userId != null) {
      setCardErrors((prev) => ({ ...prev, [userId]: text }));
      window.setTimeout(() => {
        document
          .getElementById(`user-save-error-${userId}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 0);
    }
  }

  useEffect(() => {
    if (!showCreate && !fulfillTarget) return;
    return lockPageScroll();
  }, [showCreate, fulfillTarget]);

  function openAccessWhatsApp(
    user: AuthUser,
    passwordOverride?: string,
  ): boolean {
    if (!canSendAccess(user, passwordOverride)) {
      setErrorMsg("חסר טלפון, סיסמה פעילה או שם משתמש — שמרו את הפרטים ונסו שוב");
      return false;
    }
    const url = whatsAppAccessUrl(accessShareTarget(user, passwordOverride), publicUrl);
    if (!url) {
      setErrorMsg("לא ניתן לפתוח וואטסאפ — בדקו את מספר הטלפון");
      return false;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    setMessage(`נפתחה הודעת וואטסאפ עם פרטי הכניסה עבור ${user.investor_name}`);
    return true;
  }

  async function saveUser(user: AuthUser, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (savingId) return;
    setErrorMsg(null);
    setCardErrors((prev) => {
      const next = { ...prev };
      delete next[user.id];
      return next;
    });
    const form = e.currentTarget;
    const fd = new FormData(form);
    const sendWhatsApp = fd.get("send_whatsapp") === "on";
    const phone = String(fd.get("phone") || "").trim() || null;
    const username = String(fd.get("username") || "").trim();
    const newPassword = readPassword(fd, "new_password").trim();
    if (!/^[a-zA-Z0-9._-]{2,64}$/.test(username)) {
      showSaveError(
        user.id,
        "שם משתמש חייב להכיל אותיות באנגלית / ספרות / . _ - (2–64 תווים), בלי רווחים",
      );
      return;
    }
    if (newPassword && newPassword.length < 8) {
      showSaveError(user.id, "הסיסמה חייבת להכיל לפחות 8 תווים");
      return;
    }
    setSavingId(user.id);
    try {
      const saved = await api.updateUser(user.id, {
        investor_name: String(fd.get("investor_name") || "").trim(),
        username,
        email: String(fd.get("email") || "").trim() || null,
        phone,
        role: String(fd.get("role") || "investor"),
        is_active: String(fd.get("is_active") || "true") === "true",
        ...(newPassword ? { new_password: newPassword } : {}),
      });
      setData((list) => (list ?? []).map((row) => (row.id === saved.id ? saved : row)));
      setFormRev((prev) => ({ ...prev, [user.id]: (prev[user.id] || 0) + 1 }));
      if (sendWhatsApp) {
        openAccessWhatsApp(
          {
            ...saved,
            access_password: newPassword || saved.access_password,
            has_password: newPassword ? true : saved.has_password,
          },
          newPassword || undefined,
        );
      }
      setMessage(
        newPassword
          ? sendWhatsApp
            ? "המשתמש עודכן, הסיסמה הוגדרה ונפתחה הודעת וואטסאפ."
            : "המשתמש עודכן והסיסמה הוגדרה על ידך."
          : sendWhatsApp
            ? "המשתמש עודכן ונפתחה הודעת וואטסאפ עם פרטי הכניסה."
            : "המשתמש עודכן.",
      );
      reloadRequests();
    } catch (err) {
      showSaveError(user.id, err instanceof Error ? err.message : "עדכון נכשל");
    } finally {
      setSavingId(null);
    }
  }

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (savingId) return;
    setErrorMsg(null);
    const fd = new FormData(e.currentTarget);
    const sendWhatsApp = fd.get("send_whatsapp") === "on";
    const phone = String(fd.get("phone") || "").trim() || undefined;
    const password = readPassword(fd, "password");
    if (password.length < 8) {
      setErrorMsg("הסיסמה חייבת להכיל לפחות 8 תווים");
      return;
    }
    setSavingId("create");
    try {
      const created = await api.createAccessUser({
        name: String(fd.get("name") || "").trim(),
        username: String(fd.get("username") || "").trim(),
        password,
        email: String(fd.get("email") || "").trim() || undefined,
        role: String(fd.get("role") || "investor"),
        phone,
      });
      if (sendWhatsApp) {
        openAccessWhatsApp(
          {
            ...created,
            phone: phone ?? null,
            access_password: password,
            has_password: true,
          },
          password,
        );
      }
      setShowCreate(false);
      setMessage(
        sendWhatsApp
          ? "משתמש חדש נוצר ונפתחה הודעת וואטסאפ עם פרטי הכניסה."
          : "משתמש חדש נוצר עם שם משתמש וסיסמה.",
      );
      reload();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "יצירה נכשלה");
    } finally {
      setSavingId(null);
    }
  }

  async function confirmFulfill(e: FormEvent) {
    e.preventDefault();
    if (!fulfillTarget || savingId) return;
    if (fulfillPassword.length < 8) {
      setErrorMsg("הסיסמה חייבת להכיל לפחות 8 תווים");
      return;
    }
    setSavingId("fulfill");
    try {
      await api.fulfillPasswordReset(fulfillTarget.id, fulfillPassword);
      setMessage(`הסיסמה של ${fulfillTarget.display_name} עודכנה.`);
      setFulfillTarget(null);
      setFulfillPassword("");
      reload();
      reloadRequests();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "עדכון סיסמה נכשל");
    } finally {
      setSavingId(null);
    }
  }

  async function rejectRequest(req: PasswordResetRequestItem) {
    const ok = await confirm({
      title: `דחיית בקשה של ${req.display_name}`,
      message: `לדחות את בקשת האיפוס של ${req.display_name}? הבקשה תיסגר והמשתמש יוכל לפתוח בקשה חדשה.`,
      confirmLabel: "דחיית הבקשה",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.rejectPasswordReset(req.id);
      setMessage(`הבקשה של ${req.display_name} נדחתה.`);
      reloadRequests();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "דחייה נכשלה");
    }
  }

  async function deleteUserAccount(user: AuthUser) {
    const ok = await confirm({
      title: `מחיקת ${user.investor_name}`,
      message: [
        `למחוק לצמיתות את ${user.investor_name} (${user.username})?`,
        "",
        "יפעל מחיקה מלאה:",
        "• משתמש וכניסה לאתר",
        "• כל המסלולים והתשלומים",
        "• בקשות הוספת מסלול",
        "• הצעות שהומרו למשקיע הזה",
        "",
        "לא ניתן לשחזר.",
      ].join("\n"),
      confirmLabel: "מחיקה לצמיתות",
      danger: true,
    });
    if (!ok) return;
    setErrorMsg(null);
    try {
      await api.deleteUser(user.id);
      setMessage(`${user.investor_name} נמחק מהמערכת יחד עם כל ההיסטוריה.`);
      reload();
      reloadRequests();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "מחיקה נכשלה");
    }
  }

  function canDeleteUser(user: AuthUser): boolean {
    if (user.is_manager || user.role === "manager") return false;
    if (currentUser?.id === user.id) return false;
    return true;
  }

  if (loading) return <div className="state state--loading">טוען משתמשים...</div>;
  if (error)
    return (
      <div className="state state--error">
        <p>{error}</p>
        <button type="button" className="btn" onClick={reload}>
          נסה שוב
        </button>
      </div>
    );

  const pendingUsers = (users ?? []).filter((u) => !u.has_password);
  const pendingResets = resetRequests ?? [];

  return (
    <div className="page">
      {confirmDialog}
      <header className="page-intro page-intro--admin">
        <div>
          <h1 className="page-intro__title">משתמשים והרשאות</h1>
        </div>
        <div className="page-head__actions">
          <button type="button" className="btn btn--ghost btn--small" onClick={() => setShowCreate(true)}>
            משתמש חדש
          </button>
        </div>
      </header>

      {message ? <Toast message={message} onClear={clearMessage} /> : null}
      {errorMsg ? <p className="form-error">{errorMsg}</p> : null}

      {pendingResets.length > 0 ? (
        <Panel
          title="בקשות איפוס סיסמה"
        >
          <ul className="list">
            {pendingResets.map((req) => (
              <li key={req.id} className="list__row">
                <div>
                  <strong>
                    {req.display_name} · {req.username}
                  </strong>
                  <span className="muted">
                    {formatDate(req.created_at)}
                    {req.note ? ` · ${req.note}` : ""}
                  </span>
                </div>
                <div className="action-bar">
                  <button
                    type="button"
                    className="btn btn--small btn--admin"
                    onClick={() => {
                      setFulfillPassword("");
                      setFulfillTarget(req);
                    }}
                  >
                    אשר והגדר סיסמה
                  </button>
                  <button type="button" className="btn btn--small btn--ghost" onClick={() => rejectRequest(req)}>
                    דחה
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {pendingUsers.length > 0 ? (
        <Panel
          title="ממתינים להגדרת סיסמה"
        >
          <ul className="list">
            {pendingUsers.map((u) => (
              <li key={u.id} className="list__row">
                <button
                  type="button"
                  className="list__pick"
                  onClick={() => jumpToUserPassword(u.id)}
                >
                  <strong>
                    {u.investor_name} · {u.username}
                  </strong>
                  <span className="muted">לחצו להגדרת סיסמה</span>
                </button>
                <button
                  type="button"
                  className="btn btn--small btn--admin hide-on-phone"
                  onClick={() => jumpToUserPassword(u.id)}
                >
                  הגדר סיסמה
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {(users ?? []).map((u) => (
        <div
          key={u.id}
          id={`user-card-${u.id}`}
          className={`user-card-anchor${focusPasswordUserId === u.id ? " is-target" : ""}`}
        >
        <Panel
          className="user-card"
          title={u.investor_name}
        >
          <p className="user-card__meta">
            <span>
              שם משתמש <strong dir="ltr">{u.username}</strong>
            </span>
            {u.phone ? <span>טלפון {formatPhoneDisplay(u.phone)}</span> : null}
            <span>
              {u.has_password
                ? u.must_reset_password
                  ? "יחליף סיסמה בכניסה"
                  : "יש גישה פעילה"
                : "ממתין לסיסמה מהמנהל"}
            </span>
          </p>
          {cardErrors[u.id] ? (
            <p id={`user-save-error-${u.id}`} className="form-error" role="alert">
              {cardErrors[u.id]}
            </p>
          ) : null}
          <details className="user-editor" {...(!u.has_password ? { open: true } : {})}>
            <summary className="user-editor__summary">
              <span>{u.has_password ? "עריכת פרטים וסיסמה" : "הגדרת סיסמה ופרטים"}</span>
            </summary>
            <form
              key={`${u.id}-${formRev[u.id] || 0}`}
              className="form user-form"
              autoComplete="off"
              onSubmit={(e) => void saveUser(u, e)}
            >
              <div className="form__grid">
                <label>
                  שם
                  <input name="investor_name" defaultValue={u.investor_name} required autoComplete="off" />
                </label>
                <label>
                  שם משתמש
                  <input
                    name="username"
                    defaultValue={u.username}
                    required
                    dir="ltr"
                    minLength={2}
                    maxLength={64}
                    pattern="[A-Za-z0-9._\-]+"
                    title="אותיות באנגלית, ספרות, נקודה, מקף או קו תחתון — בלי רווחים"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    {...disableIdentityAutofill}
                  />
                </label>
                <label>
                  מייל (אופציונלי ליצירת קשר)
                  <input
                    name="email"
                    type="email"
                    defaultValue={u.email && !u.email.endsWith("@local.tazrim") ? u.email : ""}
                    placeholder="אופציונלי"
                    autoComplete="off"
                  />
                </label>
                <label>
                  טלפון (לשליחת וואטסאפ)
                  <input
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    defaultValue={u.phone ?? ""}
                    placeholder="05X-XXX-XXXX"
                    autoComplete="off"
                  />
                </label>
                <label>
                  הרשאה
                  <select name="role" defaultValue={u.role}>
                    <option value="investor">משקיע — רואה רק את שלו</option>
                    <option value="manager">מנהל — גישה מלאה + התראות</option>
                  </select>
                </label>
                <label>
                  סטטוס חשבון
                  <select name="is_active" defaultValue={u.is_active === false ? "false" : "true"}>
                    <option value="true">פעיל</option>
                    <option value="false">מושבת</option>
                  </select>
                </label>
                <PasswordField
                  className="user-form__password"
                  label="סיסמה חדשה (רק אתה מגדיר)"
                  name="new_password"
                  id={`new-password-${u.id}`}
                  autoComplete="new-password"
                  enterKeyHint="done"
                  placeholder={u.has_password ? "השאר ריק כדי לא לשנות" : "לפחות 8 תווים"}
                />
                {u.role !== "manager" && u.has_password ? (
                  <label className="checkbox-row">
                    <input name="send_whatsapp" type="checkbox" />
                    <span>פתח וואטסאפ עם שם משתמש וסיסמה אחרי שמירה</span>
                  </label>
                ) : null}
              </div>
              <div className="action-bar user-form__actions">
                <button type="submit" className="btn btn--admin" disabled={savingId === u.id}>
                  {savingId === u.id ? "שומר..." : "שמור"}
                </button>
                {u.role !== "manager" && u.has_password ? (
                  <button
                    type="button"
                    className="btn btn--whatsapp"
                    onClick={() => openAccessWhatsApp(u)}
                  >
                    שליחת כניסה בוואטסאפ
                  </button>
                ) : null}
                {canDeleteUser(u) ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--danger"
                    onClick={() => void deleteUserAccount(u)}
                  >
                    מחיקת משקיע והיסטוריה
                  </button>
                ) : null}
              </div>
              <p className="hint">
                כניסה אחרונה: {u.last_login_at ? formatDate(u.last_login_at) : "עדיין לא התחבר"}
              </p>
            </form>
          </details>
        </Panel>
        </div>
      ))}

      {showCreate ? (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="create-user-title">
          <button
            type="button"
            className="modal__backdrop"
            aria-label="סגירה"
            onClick={() => setShowCreate(false)}
          />
          <div className="modal__sheet">
            <header className="modal__head">
              <h2 id="create-user-title">משתמש חדש</h2>
              <button type="button" className="modal__close" aria-label="סגירה" onClick={() => setShowCreate(false)}>
                ×
              </button>
            </header>
            <form className="form modal__form" autoComplete="off" onSubmit={(e) => void onCreate(e)}>
              <div className="modal__body">
                {errorMsg ? <p className="form-error">{errorMsg}</p> : null}
                <label>
                  שם
                  <input name="name" required placeholder="שם המשקיע" autoComplete="off" />
                </label>
                <label>
                  שם משתמש
                  <input
                    name="username"
                    required
                    placeholder="revital"
                    dir="ltr"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    {...disableIdentityAutofill}
                  />
                </label>
                <PasswordField
                  label="סיסמה התחלתית"
                  name="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  enterKeyHint="done"
                />
                <label>
                  מייל (אופציונלי)
                  <input name="email" type="email" placeholder="אופציונלי" autoComplete="off" />
                </label>
                <label>
                  הרשאה
                  <select name="role" defaultValue="investor">
                    <option value="investor">משקיע — רואה רק את שלו</option>
                    <option value="manager">מנהל — גישה מלאה</option>
                  </select>
                </label>
                <label>
                  טלפון
                  <input name="phone" type="tel" inputMode="tel" placeholder="05X-XXX-XXXX" autoComplete="tel" />
                </label>
                <label className="checkbox-row">
                  <input name="send_whatsapp" type="checkbox" defaultChecked />
                  <span>פתח וואטסאפ עם שם משתמש וסיסמה אחרי יצירה</span>
                </label>
              </div>
              <div className="modal__actions">
                <button type="button" className="btn btn--ghost" onClick={() => setShowCreate(false)}>
                  ביטול
                </button>
                <button type="submit" className="btn btn--admin" disabled={savingId === "create"}>
                  {savingId === "create" ? "יוצר..." : "צור משתמש"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {fulfillTarget ? (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="fulfill-password-title">
          <button
            type="button"
            className="modal__backdrop"
            aria-label="סגירה"
            onClick={() => {
              setFulfillTarget(null);
              setFulfillPassword("");
            }}
          />
          <div className="modal__sheet">
            <header className="modal__head">
              <h2 id="fulfill-password-title">סיסמה חדשה ל-{fulfillTarget.display_name}</h2>
              <button
                type="button"
                className="modal__close"
                aria-label="סגירה"
                onClick={() => {
                  setFulfillTarget(null);
                  setFulfillPassword("");
                }}
              >
                ×
              </button>
            </header>
            <form className="form modal__form" autoComplete="off" onSubmit={(e) => void confirmFulfill(e)}>
              <div className="modal__body">
                {errorMsg ? <p className="form-error">{errorMsg}</p> : null}
                <p className="muted">שם משתמש: {fulfillTarget.username}</p>
                <PasswordField
                  label="סיסמה חדשה"
                  name="fulfill_password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  enterKeyHint="done"
                  value={fulfillPassword}
                  onChange={(e) => setFulfillPassword(e.target.value)}
                />
              </div>
              <div className="modal__actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => {
                    setFulfillTarget(null);
                    setFulfillPassword("");
                  }}
                >
                  ביטול
                </button>
                <button type="submit" className="btn btn--admin" disabled={savingId === "fulfill"}>
                  {savingId === "fulfill" ? "שומר..." : "אשר ושמור סיסמה"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
