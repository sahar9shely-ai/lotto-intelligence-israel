import { FormEvent, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "../../../components/shared/EmptyState";
import { ErrorPanel } from "../../../components/shared/ErrorPanel";
import { SkeletonBlock } from "../../../components/shared/SkeletonBlock";
import { ApiClientError } from "../../../services/api/client";
import { FrequencyFilters } from "../../frequency/queries/useFrequencyQuery";
import { useStatsSummaryQuery } from "../../frequency/queries/useStatsSummaryQuery";
import { usePairsQuery } from "../queries/usePairsQuery";

export function PairAnalysisPage() {
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
  const pairsQuery = usePairsQuery(appliedFilters);

  const summaryError = (() => {
    if (summaryQuery.error instanceof ApiClientError) {
      return `${summaryQuery.error.message} (${summaryQuery.error.code ?? "UNKNOWN_ERROR"})`;
    }
    if (summaryQuery.error instanceof Error) {
      return summaryQuery.error.message;
    }
    return "שגיאה בטעינת נתוני סיכום.";
  })();

  const pairsError = (() => {
    if (pairsQuery.error instanceof ApiClientError) {
      return `${pairsQuery.error.message} (${pairsQuery.error.code ?? "UNKNOWN_ERROR"})`;
    }
    if (pairsQuery.error instanceof Error) {
      return pairsQuery.error.message;
    }
    return "שגיאה בטעינת נתוני זוגות.";
  })();

  const chartData = useMemo(() => {
    if (!pairsQuery.data) {
      return [];
    }
    return [...pairsQuery.data.items]
      .sort((a, b) => b.cooccurrence_count - a.cooccurrence_count)
      .slice(0, 15)
      .map((item) => ({
        pairLabel: `${item.number_a}-${item.number_b}`,
        cooccurrenceCount: item.cooccurrence_count,
      }));
  }, [pairsQuery.data]);

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
    <div className="pairs-screen">
      <form className="pairs-filters" onSubmit={onApplyFilters}>
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

      <section className="pairs-summary">
        <h3>Summary</h3>
        {summaryQuery.isLoading && <SkeletonBlock height={120} />}
        {summaryQuery.isError && !summaryQuery.isLoading && <ErrorPanel title="שגיאת סיכום" message={summaryError} />}
        {!summaryQuery.isLoading && !summaryQuery.isError && !summaryQuery.data && (
          <EmptyState title="אין נתוני סיכום" description="לא נמצאו נתוני snapshot עבור הסינון הנוכחי." />
        )}
        {!summaryQuery.isLoading && !summaryQuery.isError && summaryQuery.data && (
          <dl className="pairs-summary__grid">
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

      <section className="pairs-note">
        <p>זוגות שהופיעו יחד בעבר</p>
      </section>

      <div className="pairs-content">
        <section className="pairs-table-wrap">
          <h3>Pair table</h3>
          {pairsQuery.isLoading && (
            <div className="pairs-loading">
              <SkeletonBlock height={54} />
              <SkeletonBlock height={280} />
            </div>
          )}
          {pairsQuery.isError && !pairsQuery.isLoading && <ErrorPanel title="שגיאת זוגות" message={pairsError} />}
          {!pairsQuery.isLoading && !pairsQuery.isError && (!pairsQuery.data || pairsQuery.data.items.length === 0) && (
            <EmptyState title="אין נתוני זוגות" description="לא נמצאו נתונים עבור המסננים שנבחרו." />
          )}
          {!pairsQuery.isLoading && !pairsQuery.isError && pairsQuery.data && pairsQuery.data.items.length > 0 && (
            <div className="pairs-table-scroll">
              <table className="pairs-table">
                <thead>
                  <tr>
                    <th>number_a</th>
                    <th>number_b</th>
                    <th>cooccurrence_count</th>
                    <th>support_pct</th>
                  </tr>
                </thead>
                <tbody>
                  {pairsQuery.data.items.map((item) => (
                    <tr key={`${item.number_a}-${item.number_b}`}>
                      <td>{item.number_a}</td>
                      <td>{item.number_b}</td>
                      <td>{item.cooccurrence_count}</td>
                      <td>{item.support_pct}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="pairs-chart-wrap">
          <h3>Pair chart</h3>
          {pairsQuery.isLoading && <SkeletonBlock height={320} />}
          {pairsQuery.isError && !pairsQuery.isLoading && <ErrorPanel title="שגיאת גרף" message={pairsError} />}
          {!pairsQuery.isLoading && !pairsQuery.isError && chartData.length === 0 && (
            <EmptyState title="אין נתוני גרף" description="לא ניתן להציג גרף ללא נתונים." />
          )}
          {!pairsQuery.isLoading && !pairsQuery.isError && chartData.length > 0 && (
            <div className="pairs-chart">
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={chartData} margin={{ top: 12, right: 12, left: 12, bottom: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="pairLabel" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="cooccurrenceCount" fill="#0f766e" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

