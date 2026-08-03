import { Link } from "react-router-dom";
import { BottomNav } from "./BottomNav";
import { Logo } from "./Logo";

interface AppShellProps {
  children: React.ReactNode;
  title?: string;
  showBack?: boolean;
  backTo?: string;
  showBell?: boolean;
  showMenu?: boolean;
  hideNav?: boolean;
  onBack?: () => void;
}

export function AppShell({
  children,
  title,
  showBack = false,
  backTo = "/app/home",
  showBell = true,
  showMenu = false,
  hideNav = false,
  onBack,
}: AppShellProps) {
  return (
    <div className={`app-phone${hideNav ? " app-phone--no-nav" : ""}`}>
      <header className="app-header">
        <div className="app-header__side">
          {showBack ? (
            onBack ? (
              <button type="button" className="icon-btn" onClick={onBack} aria-label="חזרה">
                →
              </button>
            ) : (
              <Link to={backTo} className="icon-btn" aria-label="חזרה">
                →
              </Link>
            )
          ) : showMenu ? (
            <Link to="/app/settings" className="icon-btn" aria-label="תפריט">
              ☰
            </Link>
          ) : (
            <span className="icon-btn icon-btn--spacer" />
          )}
        </div>
        <div className="app-header__center">
          <Logo size="sm" />
          {title ? <p className="app-header__title">{title}</p> : null}
        </div>
        <div className="app-header__side app-header__side--end">
          {showBell ? (
            <Link to="/app/invite" className="icon-btn icon-btn--bell" aria-label="התראות">
              ⌐
              <span className="icon-btn__dot" />
            </Link>
          ) : (
            <span className="icon-btn icon-btn--spacer" />
          )}
        </div>
      </header>
      <main className="app-main">{children}</main>
      {!hideNav ? <BottomNav /> : null}
    </div>
  );
}
