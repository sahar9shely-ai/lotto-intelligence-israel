import { FormEvent, useCallback, useState } from "react";
import { useConfirm } from "../components/ConfirmDialog";
import { Panel } from "../components/Panel";
import { PasswordField } from "../components/PasswordField";
import { Toast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import type { AuthUser, PasswordResetRequestItem } from "../types/auth";
import { formatDate } from "../utils/format";
import { formatPhoneDisplay, toWhatsAppNumber, whatsAppAccessUrl } from "../utils/whatsapp";

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
  const { data: users, error, loading, reload } = useAsync(() => api.users(), []);
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
  const clearMessage = useCallback(() => setMessage(null), []);
  const publicUrl = siteStatus?.public_url || window.location.origin;

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
    setErrorMsg(null);
    const fd = new FormData(e.currentTarget);
    const sendWhatsApp = fd.get("send_whatsapp") === "on";
    const phone = String(fd.get("phone") || "").trim() || null;
    try {
      await api.updateUser(user.id, {
        investor_name: String(fd.get("investor_name") || "").trim(),
        username: String(fd.get("username") || "").trim(),
        email: String(fd.get("email") || "").trim() || null,
        phone,
        role: String(fd.get("role") || "investor"),
        is_active: String(fd.get("is_active") || "true") === "true",
      });
      const newPassword = String(fd.get("new_password") || "");
      if (newPassword) {
        await api.setUserPassword(user.id, newPassword);
      }
      const updatedUser: AuthUser = {
        ...user,
        investor_name: String(fd.get("investor_name") || "").trim(),
        username: String(fd.get("username") || "").trim(),
        phone,
        access_password: newPassword || user.access_password,
        has_password: newPassword ? true : user.has_password,
      };
      if (sendWhatsApp) {
        openAccessWhatsApp(updatedUser, newPassword || undefined);
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
      reload();
      reloadRequests();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "עדכון נכשל");
    }
  }

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMsg(null);
    const fd = new FormData(e.currentTarget);
    const sendWhatsApp = fd.get("send_whatsapp") === "on";
    const phone = String(fd.get("phone") || "").trim() || undefined;
    const password = String(fd.get("password") || "");
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
    }
  }

  async function confirmFulfill(e: FormEvent) {
    e.preventDefault();
    if (!fulfillTarget) return;
    if (fulfillPassword.length < 8) {
      setErrorMsg("הסיסמה חייבת להכיל לפחות 8 תווים");
      return;
    }
    try {
      await api.fulfillPasswordReset(fulfillTarget.id, fulfillPassword);
      setMessage(`הסיסמה של ${fulfillTarget.display_name} עודכנה.`);
      setFulfillTarget(null);
      setFulfillPassword("");
      reload();
      reloadRequests();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "עדכון סיסמה נכשל");
    }
  }

  async function rejectRequest(req: PasswordResetRequestItem) {
    if (!window.confirm(`לדחות את בקשת האיפוס של ${req.display_name}?`)) return;
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
          <p className="page-intro__eyebrow">ניהול גישה</p>
          <h1 className="page-intro__title">משתמשים והרשאות</h1>
          <p className="page-intro__lead">
            התחברות בשם משתמש וסיסמה · רק אתה מגדיר סיסמאות, מאשר איפוסים ושולח כניסה בוואטסאפ.
          </p>
        </div>
        <div className="page-head__actions">
          <button type="button" className="btn btn--admin" onClick={() => setShowCreate(true)}>
            + משתמש חדש
          </button>
        </div>
      </header>

      {message ? <Toast message={message} onClear={clearMessage} /> : null}
      {errorMsg ? <p className="form-error">{errorMsg}</p> : null}

      {pendingResets.length > 0 ? (
        <Panel
          title="בקשות איפוס סיסמה"
          subtitle={`${pendingResets.length} ממתינות לאישור שלך`}
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
          subtitle={`${pendingUsers.length} משתמשים בלי סיסמה פעילה`}
        >
          <ul className="list">
            {pendingUsers.map((u) => (
              <li key={u.id} className="list__row">
                <div>
                  <strong>
                    {u.investor_name} · {u.username}
                  </strong>
                  <span className="muted">הגדר סיסמה בטופס למטה</span>
                </div>
                <span className="badge badge--scheduled">
                  {u.role === "manager" ? "מנהל" : "משקיע"}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {(users ?? []).map((u) => (
        <Panel
          key={u.id}
          title={u.investor_name}
          subtitle={
            u.has_password
              ? `שם משתמש: ${u.username}${u.phone ? ` · ${formatPhoneDisplay(u.phone)}` : ""} · יש גישה פעילה`
              : `שם משתמש: ${u.username}${u.phone ? ` · ${formatPhoneDisplay(u.phone)}` : ""} · ממתין לסיסמה מהמנהל`
          }
        >
          <form className="form" onSubmit={(e) => saveUser(u, e)}>
            <div className="form__grid">
              <label>
                שם
                <input name="investor_name" defaultValue={u.investor_name} required />
              </label>
              <label>
                שם משתמש
                <input name="username" defaultValue={u.username} required />
              </label>
              <label>
                מייל (אופציונלי ליצירת קשר)
                <input
                  name="email"
                  type="email"
                  defaultValue={u.email && !u.email.endsWith("@local.tazrim") ? u.email : ""}
                  placeholder="אופציונלי"
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
                label="סיסמה חדשה (רק אתה מגדיר)"
                name="new_password"
                minLength={8}
                autoComplete="new-password"
                placeholder={u.has_password ? "השאר ריק כדי לא לשנות" : "חובה להגדיר"}
              />
              {u.role !== "manager" && u.has_password ? (
                <label className="checkbox-row">
                  <input name="send_whatsapp" type="checkbox" />
                  <span>פתח וואטסאפ עם שם משתמש וסיסמה אחרי שמירה</span>
                </label>
              ) : null}
            </div>
            <div className="action-bar">
              <button type="submit" className="btn btn--admin">
                שמור
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
        </Panel>
      ))}

      {showCreate ? (
        <div className="modal" role="dialog" aria-modal="true">
          <button
            type="button"
            className="modal__backdrop"
            aria-label="סגירה"
            onClick={() => setShowCreate(false)}
          />
          <div className="modal__sheet">
            <header className="modal__head">
              <h2>משתמש חדש</h2>
              <button type="button" className="btn btn--ghost" onClick={() => setShowCreate(false)}>
                סגור
              </button>
            </header>
            <form className="form" onSubmit={onCreate}>
              <label>
                שם
                <input name="name" required placeholder="שם המשקיע" />
              </label>
              <label>
                שם משתמש
                <input name="username" required placeholder="revital" autoComplete="off" />
              </label>
              <PasswordField
                label="סיסמה התחלתית"
                name="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
              <label>
                מייל (אופציונלי)
                <input name="email" type="email" placeholder="אופציונלי" />
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
                <input name="phone" type="tel" inputMode="tel" placeholder="05X-XXX-XXXX" />
              </label>
              <label className="checkbox-row">
                <input name="send_whatsapp" type="checkbox" defaultChecked />
                <span>פתח וואטסאפ עם שם משתמש וסיסמה אחרי יצירה</span>
              </label>
              <button type="submit" className="btn btn--admin">
                צור משתמש
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {fulfillTarget ? (
        <div className="modal" role="dialog" aria-modal="true">
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
              <h2>סיסמה חדשה ל-{fulfillTarget.display_name}</h2>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  setFulfillTarget(null);
                  setFulfillPassword("");
                }}
              >
                סגור
              </button>
            </header>
            <form className="form" onSubmit={confirmFulfill}>
              <p className="muted">שם משתמש: {fulfillTarget.username}</p>
              <PasswordField
                label="סיסמה חדשה"
                name="fulfill_password"
                required
                minLength={8}
                autoComplete="new-password"
                value={fulfillPassword}
                onChange={(e) => setFulfillPassword(e.target.value)}
              />
              <button type="submit" className="btn btn--admin">
                אשר ושמור סיסמה
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
