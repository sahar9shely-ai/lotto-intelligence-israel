import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import { usePushNotifications } from "../context/PushNotificationsContext";
import { loadTutorialMedia, type TutorialMedia } from "../services/tutorialMedia";
import "./pushNotificationAccess.css";

function ActivationGuide() {
  const [open, setOpen] = useState(false);
  const [media, setMedia] = useState<TutorialMedia | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!open) return;
    setError(false);
    const controller = new AbortController();
    let loaded: TutorialMedia | null = null;
    loadTutorialMedia("08-notifications", controller.signal).then(result => {
      loaded = result;
      if (!controller.signal.aborted) setMedia(result); else result.dispose();
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => { controller.abort(); loaded?.dispose(); setMedia(null); };
  }, [open]);
  return <details className="push-activation__guide" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>סרטון 8: הפעלת התראות</summary>
    {media && !error ? <video controls playsInline preload="metadata" src={media.video} poster={media.poster} aria-label="הפעלת התראות בתזרים" onError={() => setError(true)}>
      <track kind="captions" src={media.captions} srcLang="he" label="עברית" />
    </video> : open && !error ? <p role="status">טוענים את ההדרכה…</p> : null}
    <ol>
      <li>ב־iPhone או iPad: פתחו את תזרים ב־Safari, לחצו על שיתוף ואז הוספה למסך הבית. פתחו את תזרים מהסמל שנוסף.</li>
      <li>לחצו על הפעל התראות, ואז אשרו את בקשת ההרשאה שמופיעה במכשיר.</li>
      <li>כשמגיעה התראה, לחצו עליה כדי לפתוח את הבקשה. את האישור מבצעים בתוך תזרים.</li>
    </ol>
  </details>;
}

export function PushNotificationAccess({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const push = usePushNotifications();
  const [loggingOut, setLoggingOut] = useState(false);
  if (!user || user.is_manager || push.state === "ready" || push.required === false) return <>{children}</>;
  const canEnable = push.canEnable && ["needs_permission", "error"].includes(push.state);
  return <main className="push-activation" dir="rtl">
    <section className="push-activation__card" aria-labelledby="push-activation-title" aria-busy={push.busy}>
      <span className="push-activation__icon" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M6 9a6 6 0 0 1 12 0v5l2 3H4l2-3z"/><path d="M10 20h4"/></svg></span>
      <p className="push-activation__eyebrow">תזרים · כניסה לתיק</p>
      <h1 id="push-activation-title">הפעלת התראות לתזרים</h1>
      <p>כדי להיכנס לתיק, יש להפעיל במכשיר הזה התראות על בקשות אישור קבלת תשלום ועל מסמכים לחתימה.</p>
      {push.state === "checking" ? <p className="push-activation__status" role="status">בודקים את ההתראות במכשיר הזה…</p> : null}
      {push.state === "install_required" ? <p className="push-activation__status">ב־iPhone או iPad: פתחו את תזרים ב־Safari, לחצו על שיתוף ואז הוספה למסך הבית. פתחו את תזרים מהסמל שנוסף והפעילו התראות.</p> : null}
      {push.state === "unsupported" ? <p className="push-activation__status">המכשיר או הדפדפן הזה אינו תומך כרגע בהתראות של תזרים. עדכנו את המכשיר והדפדפן, או פתחו את תזרים בדפדפן שתומך בהתראות. ב־iPhone יש לפתוח מהסמל במסך הבית.</p> : null}
      {push.state === "denied" ? <p className="push-activation__status">ההתראות חסומות. פתחו את הגדרות האתר בדפדפן או את הגדרות ההתראות במכשיר, אפשרו התראות לתזרים וחזרו לכאן ללחוץ על בדוק שוב.</p> : null}
      {push.state === "unavailable" ? <p className="push-activation__status">הפעלת ההתראות עדיין אינה זמינה. אפשר לנסות שוב בהמשך או לפנות למנהל.</p> : null}
      {push.error ? <p className="push-activation__status" role="alert">{push.error}</p> : null}
      <div className="push-activation__actions">
        {canEnable ? <button type="button" className="btn btn--primary" onClick={() => void push.enable()} disabled={push.busy || loggingOut}>{push.busy ? "מפעילים התראות…" : "הפעל התראות"}</button> : null}
        <button type="button" className="btn btn--ghost" onClick={() => void push.refresh()} disabled={push.busy || push.state === "checking" || loggingOut}>בדוק שוב</button>
      </div>
      <ActivationGuide />
      <button type="button" className="push-activation__logout" disabled={loggingOut} onClick={async () => { setLoggingOut(true); await logout(); }}>{loggingOut ? "יוצאים…" : "יציאה מהחשבון"}</button>
    </section>
  </main>;
}

export function PushNotificationSettings() {
  const push = usePushNotifications();
  return <section id="push-notifications" className="push-settings panel">
    <h2>התראות במכשיר הזה</h2>
    <p>{!push.enabled ? "התראות אינן זמינות כרגע במערכת." : push.state === "ready" ? "התראות פעילות לבקשות אישור קבלת תשלום ולמסמכים לחתימה." : push.required === false ? "אפשר להפעיל התראות על בקשות אישור קבלת תשלום ועל מסמכים לחתימה." : "צריך להפעיל התראות כדי להיכנס לתיק מהמכשיר הזה."}</p>
    {push.error ? <p className="push-settings__hint" role="status">{push.error}</p> : null}
    <p className="push-settings__hint">אפשר לשנות את ההרשאה בהגדרות האתר או בהגדרות ההתראות במכשיר.</p>
    <button type="button" className="btn btn--ghost" onClick={() => void push.refresh()} disabled={push.busy || push.state === "checking"}>בדיקת ההתראות</button>
  </section>;
}
