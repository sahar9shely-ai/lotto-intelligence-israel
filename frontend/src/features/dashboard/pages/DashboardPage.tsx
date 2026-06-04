import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { appPaths } from "../../../app/routes/paths";
import { EmptyState } from "../../../components/shared/EmptyState";
import { ErrorPanel } from "../../../components/shared/ErrorPanel";
import { SkeletonBlock } from "../../../components/shared/SkeletonBlock";
import { ApiClientError } from "../../../services/api/client";
import { useFrequencyQuery } from "../../frequency/queries/useFrequencyQuery";
import { useStatsSummaryQuery } from "../../frequency/queries/useStatsSummaryQuery";
import { useHealthQuery } from "../../health/queries/useHealthQuery";
import { usePairsQuery } from "../../pairs/queries/usePairsQuery";
import { useStrongNumberQuery } from "../../strong-number/queries/useStrongNumberQuery";

const DASHBOARD_FILTERS = {
  gameCode: "IL_LOTTO",
  gameVariant: "main",
  ruleVersion: "v1",
};

const QUICK_LINKS = [
  { to: appPaths.draws, label: "היסטוריית הגרלות" },
  { to: appPaths.frequency, label: "תדירות מספרים" },
  { to: appPaths.strongNumber, label: "סטטיסטיקת מספר חזק" },
  { to: appPaths.pairs, label: "ניתוח זוגות" },
  { to: appPaths.snapshots, label: "ניהול Snapshot" },
  { to: appPaths.health, label: "בריאות מערכת" },
];

function buildErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiClientError) {
    return `${error.message} (${error.code ?? "UNKNOWN_ERROR"})`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

export function DashboardPage() {
  const healthQuery = useHealthQuery();
  const summaryQuery = useStatsSummaryQuery(DASHBOARD_FILTERS);
  const frequencyQuery = useFrequencyQuery(DASHBOARD_FILTERS);
  const strongQuery = useStrongNumberQuery(DASHBOARD_FILTERS);
  const pairsQuery = usePairsQuery(DASHBOARD_FILTERS);

  const topRegularNumbers = useMemo(() => {
    if (!frequencyQuery.data) {
      return [];
    }
    return [...frequencyQuery.data.items]
      .sort((a, b) => b.appearance_count - a.appearance_count)
      .slice(0, 10)
      .map((item) => ({
        label: String(item.number_value),
        appearanceCount: item.appearance_count,
      }));
  }, [frequencyQuery.data]);

  const strongOverview = useMemo(() => {
    if (!strongQuery.data) {
      return [];
    }
    return [...strongQuery.data.items]
      .sort((a, b) => b.appearance_count - a.appearance_count)
      .map((item) => ({
        label: String(item.strong_value),
        appearanceCount: item.appearance_count,
      }));
  }, [strongQuery.data]);

  const topPairs = useMemo(() => {
    if (!pairsQuery.data) {
      return [];
    }
    return [...pairsQuery.data.items]
      .sort((a, b) => b.cooccurrence_count - a.cooccurrence_count)
      .slice(0, 10)
      .map((item) => ({
        label: `${item.number_a}-${item.number_b}`,
        cooccurrenceCount: item.cooccurrence_count,
      }));
  }, [pairsQuery.data]);

  const summaryStatus = summaryQuery.data ? "published" : "-";
  const summaryGeneratedAt = summaryQuery.data?.snapshot.published_at_utc ?? "-";
  const healthStatus = healthQuery.data?.status ?? "-";

  return (
    <div className="dashboard-screen">
      <section className="dashboard-kpis">
        <h3>KPI Cards</h3>
        {(summaryQuery.isLoading || healthQuery.isLoading) && <SkeletonBlock height={110} />}
        {(summaryQuery.isError || healthQuery.isError) && (
          <ErrorPanel
            title="שגיאת KPI"
            message={
              summaryQuery.isError
                ? buildErrorMessage(summaryQuery.error, "שגיאה בטעינת סיכום.")
                : buildErrorMessage(healthQuery.error, "שגיאה בטעינת בריאות מערכת.")
            }
          />
        )}
        {!summaryQuery.isLoading && !healthQuery.isLoading && !summaryQuery.isError && !healthQuery.isError && (
          <div className="dashboard-kpis__grid">
            <article>
              <h4>snapshot_id</h4>
              <p>{summaryQuery.data?.snapshot.snapshot_id ?? "-"}</p>
            </article>
            <article>
              <h4>draw_count</h4>
              <p>{summaryQuery.data?.draw_count ?? "-"}</p>
            </article>
            <article>
              <h4>snapshot_status</h4>
              <p>{summaryStatus}</p>
            </article>
            <article>
              <h4>generated_at</h4>
              <p>{summaryGeneratedAt}</p>
            </article>
            <article>
              <h4>health_status</h4>
              <p>{healthStatus}</p>
            </article>
          </div>
        )}
      </section>

      <div className="dashboard-content">
        <section className="dashboard-panel">
          <h3>Top Regular Numbers</h3>
          {frequencyQuery.isLoading && <SkeletonBlock height={300} />}
          {frequencyQuery.isError && (
            <ErrorPanel title="שגיאת מספרים רגילים" message={buildErrorMessage(frequencyQuery.error, "שגיאה בטעינת נתונים.")} />
          )}
          {!frequencyQuery.isLoading && !frequencyQuery.isError && topRegularNumbers.length === 0 && (
            <EmptyState title="אין נתוני מספרים רגילים" description="לא נמצאו נתוני תדירות להצגה." />
          )}
          {!frequencyQuery.isLoading && !frequencyQuery.isError && topRegularNumbers.length > 0 && (
            <div className="dashboard-chart">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={topRegularNumbers}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="appearanceCount" fill="#1d4ed8" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="dashboard-panel">
          <h3>Strong Numbers Overview</h3>
          {strongQuery.isLoading && <SkeletonBlock height={300} />}
          {strongQuery.isError && (
            <ErrorPanel title="שגיאת מספרים חזקים" message={buildErrorMessage(strongQuery.error, "שגיאה בטעינת נתונים.")} />
          )}
          {!strongQuery.isLoading && !strongQuery.isError && strongOverview.length === 0 && (
            <EmptyState title="אין נתוני מספרים חזקים" description="לא נמצאו נתונים להצגה." />
          )}
          {!strongQuery.isLoading && !strongQuery.isError && strongOverview.length > 0 && (
            <div className="dashboard-chart">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={strongOverview}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="appearanceCount" fill="#7c3aed" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="dashboard-panel">
          <h3>Pair Overview</h3>
          {pairsQuery.isLoading && <SkeletonBlock height={300} />}
          {pairsQuery.isError && (
            <ErrorPanel title="שגיאת זוגות" message={buildErrorMessage(pairsQuery.error, "שגיאה בטעינת נתונים.")} />
          )}
          {!pairsQuery.isLoading && !pairsQuery.isError && topPairs.length === 0 && (
            <EmptyState title="אין נתוני זוגות" description="לא נמצאו זוגות שהופיעו יחד בעבר עבור המסננים הפעילים." />
          )}
          {!pairsQuery.isLoading && !pairsQuery.isError && topPairs.length > 0 && (
            <div className="dashboard-chart">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={topPairs}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="cooccurrenceCount" fill="#0f766e" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>

      <section className="dashboard-nav">
        <h3>Quick Navigation</h3>
        <div className="dashboard-nav__grid">
          {QUICK_LINKS.map((item) => (
            <Link key={item.to} to={item.to}>
              {item.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

