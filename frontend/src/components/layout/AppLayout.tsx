import { Outlet } from "react-router-dom";
import { PageHeader } from "./PageHeader";
import { SideNav } from "./SideNav";
import { TopNav } from "./TopNav";

export function AppLayout() {
  return (
    <div className="app-shell">
      <TopNav />
      <div className="app-body">
        <SideNav />
        <main className="app-main">
          <PageHeader />
          <section className="page-content">
            <Outlet />
          </section>
        </main>
      </div>
    </div>
  );
}

