import { NavLink } from "react-router-dom";
import { navigationItems } from "../../app/routes/navigation";

export function SideNav() {
  return (
    <aside className="side-nav">
      <nav className="side-nav__menu" aria-label="main navigation">
        {navigationItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => (isActive ? "side-nav__link side-nav__link--active" : "side-nav__link")}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

