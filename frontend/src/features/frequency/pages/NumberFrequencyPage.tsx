import { FormEvent, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "../../../components/shared/EmptyState";
import { ErrorPanel } from "../../../components/shared/ErrorPanel";
import { SkeletonBlock } from "../../../components/shared/SkeletonBlock";
import { ApiClientError } from "../../../services/api/client";
import { FrequencyFilters, useFrequencyQuery } from "../queries/useFrequencyQuery";
import { useStatsSummaryQuery } from "../queries/useStatsSummaryQuery";

function parsePercent(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function NumberFrequencyPage() {
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

  const frequencyQuery = useFrequencyQuery(appliedFilters);
  const summaryQuery = useStatsSummaryQuery(appliedFilters);

  const summaryError = (() => {
    if (summaryQuery.error instanceof ApiClientError) {
      return `${summaryQuery.error.message} (${summaryQuery.error.code ?? "UNKNOWN_ERROR"})`;
    }
    if (summaryQuery.error instanceof Error) {
      return summaryQuery.error.message;
    }
    return "שגיאה בטעינת נתוני סיכום.";
  })();

  const frequencyError = (() => {
    if (frequencyQuery.error instanceof ApiClientError) {
      return `${frequencyQuery.error.message} (${frequencyQuery.error.code ?? "UNKNOWN_ERROR"})`;
    }
    if (frequencyQuery.error instanceof Error) {
      return frequencyQuery.error.message;
    }
    return "שגיאה בטעינת טבלת תדירויות.";
  })();

  const chartData = useMemo(() => {
    if (!frequencyQuery.data) {
      return [];
    }
    return [...frequencyQuery.data.items]
      .sort((a, b) => b.appearance_count - a.appearance_count)
      .map((item) => ({
        number: item.number_value,
        appearanceCount: item.appearance_count,
        frequencyPct: parsePercent(item.frequency_pct),
      }));
  }, [frequencyQuery.data]);

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
  const snapshotStatus = summaryQuery.data ? "published" : "-";

  return (
    <div className="frequency-screen">
      <form className="frequency-filters" onSubmit={onApplyFilters}>
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

      <section className="frequency-summary">
        <h3>Summary</h3>
        {summaryQuery.isLoading && <SkeletonBlock height={120} />}
        {summaryQuery.isError && !summaryQuery.isLoading && <ErrorPanel title="שגיאת סיכום" message={summaryError} />}
        {!summaryQuery.isLoading && !summaryQuery.isError && !summaryQuery.data && (
          <EmptyState title="אין נתוני סיכום" description="לא נמצאו נתוני snapshot עבור הסינון הנוכחי." />
        )}
        {!summaryQuery.isLoading && !summaryQuery.isError && summaryQuery.data && (
          <dl className="frequency-summary__grid">
            <div>
              <dt>snapshot_id</dt>
              <dd>{summaryQuery.data.snapshot.snapshot_id}</dd>
            </div>
            <div>
              <dt>draw_count</dt>
              <dd>{summaryQuery.data.draw_count}</dd>
            </div>
            <div>
              <dt>snapshot_status</dt>
              <dd>{snapshotStatus}</dd>
            </div>
            <div>
              <dt>generated_at</dt>
              <dd>{generatedAt}</dd>
            </div>
          </dl>
        )}
      </section>

      <div className="frequency-content">
        <section className="frequency-table-wrap">
          <h3>Frequency table</h3>
          {frequencyQuery.isLoading && (
            <div className="frequency-loading">
              <SkeletonBlock height={54} />
              <SkeletonBlock height={280} />
            </div>
          )}
          {frequencyQuery.isError && !frequencyQuery.isLoading && (
            <ErrorPanel title="שגיאת תדירויות" message={frequencyError} />
          )}
          {!frequencyQuery.isLoading && !frequencyQuery.isError && (!frequencyQuery.data || frequencyQuery.data.items.length === 0) && (
            <EmptyState title="אין נתוני תדירות" description="לא נמצאו נתוני מספרים עבור המסננים שנבחרו." />
          )}
          {!frequencyQuery.isLoading && !frequencyQuery.isError && frequencyQuery.data && frequencyQuery.data.items.length > 0 && (
            <div className="frequency-table-scroll">
              <table className="frequency-table">
                <thead>
                  <tr>
                    <th>number</th>
                    <th>appearance_count</th>
                    <th>frequency_pct</th>
                  </tr>
                </thead>
                <tbody>
                  {frequencyQuery.data.items.map((item) => (
                    <tr key={item.number_value}>
                      <td>{item.number_value}</td>
                      <td>{item.appearance_count}</td>
                      <td>{item.frequency_pct}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="frequency-chart-wrap">
          <h3>Frequency chart</h3>
          {frequencyQuery.isLoading && <SkeletonBlock height={320} />}
          {frequencyQuery.isError && !frequencyQuery.isLoading && (
            <ErrorPanel title="שגיאת גרף" message={frequencyError} />
          )}
          {!frequencyQuery.isLoading && !frequencyQuery.isError && chartData.length === 0 && (
            <EmptyState title="אין נתוני גרף" description="לא ניתן להציג גרף ללא נתוני תדירות." />
          )}
          {!frequencyQuery.isLoading && !frequencyQuery.isError && chartData.length > 0 && (
            <div className="frequency-chart">
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={chartData} margin={{ top: 12, right: 12, left: 12, bottom: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="number" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="appearanceCount" fill="#1d4ed8" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

