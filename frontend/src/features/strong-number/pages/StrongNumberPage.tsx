import { FormEvent, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "../../../components/shared/EmptyState";
import { ErrorPanel } from "../../../components/shared/ErrorPanel";
import { SkeletonBlock } from "../../../components/shared/SkeletonBlock";
import { ApiClientError } from "../../../services/api/client";
import { FrequencyFilters } from "../../frequency/queries/useFrequencyQuery";
import { useStatsSummaryQuery } from "../../frequency/queries/useStatsSummaryQuery";
import { useStrongNumberQuery } from "../queries/useStrongNumberQuery";

export function StrongNumberPage() {
  const [gameCode, setGameCode] = useState("IL_LOTTO");
  const [gameVariant, setGameVariant] = useState("main");
  const [ruleVersion, setRuleVersion] = useState("v1");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [appliedFilters, setAppliedFilters] = useState<FrequencyFilters>({
    gameCode: "IL_LOTTO",
    gameVariant: "main",
    ruleVersion: "v1",
  });

  const summaryQuery = useStatsSummaryQuery(appliedFilters);
  const strongQuery = useStrongNumberQuery(appliedFilters);

  const summaryError = (() => {
    if (summaryQuery.error instanceof ApiClientError) {
      return `${summaryQuery.error.message} (${summaryQuery.error.code ?? "UNKNOWN_ERROR"})`;
    }
    if (summaryQuery.error instanceof Error) {
      return summaryQuery.error.message;
    }
    return "שגיאה בטעינת נתוני סיכום.";
  })();

  const strongError = (() => {
    if (strongQuery.error instanceof ApiClientError) {
      return `${strongQuery.error.message} (${strongQuery.error.code ?? "UNKNOWN_ERROR"})`;
    }
    if (strongQuery.error instanceof Error) {
      return strongQuery.error.message;
    }
    return "שגיאה בטעינת נתוני מספר חזק.";
  })();

  const chartData = useMemo(() => {
    if (!strongQuery.data) {
      return [];
    }
    return [...strongQuery.data.items]
      .sort((a, b) => b.appearance_count - a.appearance_count)
      .map((item) => ({
        strongNumber: item.strong_value,
        appearanceCount: item.appearance_count,
      }));
  }, [strongQuery.data]);

  function onApplyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedFilters({
      gameCode: gameCode || undefined,
      gameVariant: gameVariant || undefined,
      ruleVersion: ruleVersion || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    });
  }

  const generatedAt = summaryQuery.data?.snapshot.published_at_utc ?? "-";

  return (
    <div className="strong-screen">
      <form className="strong-filters" onSubmit={onApplyFilters}>
        <label>
          game_code
          <input value={gameCode} onChange={(event) => setGameCode(event.target.value)} />
        </label>
        <label>
          game_variant
          <input value={gameVariant} onChange={(event) => setGameVariant(event.target.value)} />
        </label>
        <label>
          rule_version
          <input value={ruleVersion} onChange={(event) => setRuleVersion(event.target.value)} />
        </label>
        <label>
          date_from
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label>
          date_to
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
        <button type="submit">החל סינון</button>
      </form>

      <section className="strong-summary">
        <h3>Summary</h3>
        {summaryQuery.isLoading && <SkeletonBlock height={120} />}
        {summaryQuery.isError && !summaryQuery.isLoading && <ErrorPanel title="שגיאת סיכום" message={summaryError} />}
        {!summaryQuery.isLoading && !summaryQuery.isError && !summaryQuery.data && (
          <EmptyState title="אין נתוני סיכום" description="לא נמצאו נתוני snapshot עבור הסינון הנוכחי." />
        )}
        {!summaryQuery.isLoading && !summaryQuery.isError && summaryQuery.data && (
          <dl className="strong-summary__grid">
            <div>
              <dt>snapshot_id</dt>
              <dd>{summaryQuery.data.snapshot.snapshot_id}</dd>
            </div>
            <div>
              <dt>draw_count</dt>
              <dd>{summaryQuery.data.draw_count}</dd>
            </div>
            <div>
              <dt>generated_at</dt>
              <dd>{generatedAt}</dd>
            </div>
          </dl>
        )}
      </section>

      <div className="strong-content">
        <section className="strong-table-wrap">
          <h3>Strong number table</h3>
          {strongQuery.isLoading && (
            <div className="strong-loading">
              <SkeletonBlock height={54} />
              <SkeletonBlock height={280} />
            </div>
          )}
          {strongQuery.isError && !strongQuery.isLoading && <ErrorPanel title="שגיאת מספר חזק" message={strongError} />}
          {!strongQuery.isLoading && !strongQuery.isError && (!strongQuery.data || strongQuery.data.items.length === 0) && (
            <EmptyState title="אין נתוני מספר חזק" description="לא נמצאו נתונים עבור המסננים שנבחרו." />
          )}
          {!strongQuery.isLoading && !strongQuery.isError && strongQuery.data && strongQuery.data.items.length > 0 && (
            <div className="strong-table-scroll">
              <table className="strong-table">
                <thead>
                  <tr>
                    <th>strong_number</th>
                    <th>appearance_count</th>
                    <th>frequency_pct</th>
                  </tr>
                </thead>
                <tbody>
                  {strongQuery.data.items.map((item) => (
                    <tr key={item.strong_value}>
                      <td>{item.strong_value}</td>
                      <td>{item.appearance_count}</td>
                      <td>{item.frequency_pct}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="strong-chart-wrap">
          <h3>Strong number chart</h3>
          {strongQuery.isLoading && <SkeletonBlock height={320} />}
          {strongQuery.isError && !strongQuery.isLoading && <ErrorPanel title="שגיאת גרף" message={strongError} />}
          {!strongQuery.isLoading && !strongQuery.isError && chartData.length === 0 && (
            <EmptyState title="אין נתוני גרף" description="לא ניתן להציג גרף ללא נתונים." />
          )}
          {!strongQuery.isLoading && !strongQuery.isError && chartData.length > 0 && (
            <div className="strong-chart">
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={chartData} margin={{ top: 12, right: 12, left: 12, bottom: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="strongNumber" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="appearanceCount" fill="#7c3aed" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

