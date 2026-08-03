import { useState } from "react";
import { AppShell } from "../components/AppShell";
import { GlowButton } from "../components/GlowButton";
import { useAuth } from "../context/AuthContext";

export function InvitePage() {
  const { user, updateUser } = useAuth();
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(user.referralCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  async function invite() {
    await updateUser({
      points: user.points + 200,
      friends: user.friends + 1,
    });
    if (navigator.share) {
      try {
        await navigator.share({
          title: "GOT URS",
          text: `הצטרפו ל-GOT URS עם הקוד ${user.referralCode}`,
          url: window.location.origin,
        });
      } catch {
        /* user cancelled */
      }
    } else {
      await copyCode();
    }
  }

  return (
    <AppShell showBack backTo="/app/profile" hideNav>
      <section className="section invite-screen">
        <div className="gift-box" aria-hidden>
          ❒
        </div>
        <h1>הזמנת חברים</h1>
        <p className="page-sub">
          שתפו את האפליקציה וקבלו נקודות! החבר/ה מקבל/ת 50 ואתם 200
        </p>
        <GlowButton onClick={() => void invite()}>הזמינו חברים</GlowButton>
        <button type="button" className="code-box" onClick={() => void copyCode()}>
          <span>{user.referralCode}</span>
          <small>{copied ? "הועתק!" : "העתק קוד"}</small>
        </button>
      </section>
    </AppShell>
  );
}
