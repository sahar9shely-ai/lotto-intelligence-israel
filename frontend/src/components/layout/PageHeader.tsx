import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { navigationItems } from "../../app/routes/navigation";

export function PageHeader() {
  const location = useLocation();
  const title = useMemo(() => {
    const current = navigationItems.find((item) => item.to === location.pathname);
    return current?.label ?? "Lotto Intelligence Israel";
  }, [location.pathname]);

  return (
    <header className="page-header">
      <h2>{title}</h2>
    </header>
  );
}

