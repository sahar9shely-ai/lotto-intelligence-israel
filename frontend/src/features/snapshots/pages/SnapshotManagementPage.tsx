import { FormEvent, useState } from "react";
import { EmptyState } from "../../../components/shared/EmptyState";
import { ErrorPanel } from "../../../components/shared/ErrorPanel";
import { SkeletonBlock } from "../../../components/shared/SkeletonBlock";
import { ApiClientError } from "../../../services/api/client";
import type { SnapshotGenerateResponse } from "../../../services/api/types";
import { FrequencyFilters } from "../../frequency/queries/useFrequencyQuery";
import { useStatsSummaryQuery } from "../../frequency/queries/useStatsSummaryQuery";
import { useGenerateSnapshotMutation } from "../mutations/useGenerateSnapshotMutation";

export function SnapshotManagementPage() {
  const [gameCode, setGameCode] = useState("IL_LOTTO");
  const [gameVariant, setGameVariant] = useState("main");
  const [ruleVersion, setRuleVersion] = useState("v1");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dryRun, setDryRun] = useState(false);
  const [result, setResult] = useState<SnapshotGenerateResponse | null>(null);

  const [summaryFilters, setSummaryFilters] = useState<FrequencyFilters>({
    gameCode: "IL_LOTTO",
    gameVariant: "main",
    ruleVersion: "v1",
  });

  const summaryQuery = useStatsSummaryQuery(summaryFilters);
  const generateMutation = useGenerateSnapshotMutation();

  const summaryError = (() => {
    if (summaryQuery.error instanceof ApiClientError) {
      return `${summaryQuery.error.message} (${summaryQuery.error.code ?? "UNKNOWN_ERROR"})`;
    }
    if (summaryQuery.error instanceof Error) {
      return summaryQuery.error.message;
    }
    return "שגיאה בטעינת סיכום snapshot נוכחי.";
  })();

  const mutationError = (() => {
    if (generateMutation.error instanceof ApiClientError) {
      return `${generateMutation.error.message} (${generateMutation.error.code ?? "UNKNOWN_ERROR"})`;
    }
    if (generateMutation.error instanceof Error) {
      return generateMutation.error.message;
    }
    return "שגיאה בתהליך יצירת snapshot.";
  })();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      game_code: gameCode,
      game_variant: gameVariant,
      rule_version: ruleVersion,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      dry_run: dryRun,
      triggered_by: "frontend-ops",
    };
    const nextSummaryFilters: FrequencyFilters = {
      gameCode: gameCode || undefined,
      gameVariant: gameVariant || undefined,
      ruleVersion: ruleVersion || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    };

    try {
      const response = await generateMutation.mutateAsync(payload);
      setResult(response);
      setSummaryFilters(nextSummaryFilters);
      await summaryQuery.refetch();
    } catch {
      // Error displayed via mutation state.
    }
  }

  const generatedAt = summaryQuery.data?.snapshot.published_at_utc ?? "-";
  const snapshotStatus = summaryQuery.data ? "published" : "-";

  return (
    <div className="snapshots-screen">
      <section className="snapshots-summary">
        <h3>Current snapshot summary</h3>
        {summaryQuery.isLoading && <SkeletonBlock height={120} />}
        {summaryQuery.isError && !summaryQuery.isLoading && (
          <ErrorPanel title="שגיאת סיכום snapshot" message={summaryError} />
        )}
        {!summaryQuery.isLoading && !summaryQuery.isError && !summaryQuery.data && (
          <EmptyState title="אין Snapshot נוכחי" description="לא נמצא Snapshot תואם למסננים הפעילים." />
        )}
        {!summaryQuery.isLoading && !summaryQuery.isError && summaryQuery.data && (
          <dl className="snapshots-summary__grid">
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
            <div>
              <dt>status</dt>
              <dd>{snapshotStatus}</dd>
            </div>
          </dl>
        )}
      </section>

      <section className="snapshots-form-wrap">
        <h3>Snapshot generation form</h3>
        <form className="snapshots-form" onSubmit={onSubmit}>
          <label>
            game_code
            <input value={gameCode} onChange={(event) => setGameCode(event.target.value)} required />
          </label>
          <label>
            game_variant
            <input value={gameVariant} onChange={(event) => setGameVariant(event.target.value)} required />
          </label>
          <label>
            rule_version
            <input value={ruleVersion} onChange={(event) => setRuleVersion(event.target.value)} required />
          </label>
          <label>
            date_from (optional)
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </label>
          <label>
            date_to (optional)
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </label>
          <label className="snapshots-form__toggle">
            <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} />
            dry_run
          </label>
          <button type="submit" disabled={generateMutation.isPending}>
            {generateMutation.isPending ? "מריץ..." : "הפעלת Snapshot"}
          </button>
        </form>
        {generateMutation.isError && <ErrorPanel title="שגיאת פעולה" message={mutationError} />}
      </section>

      <section className="snapshots-result">
        <h3>Generation result</h3>
        {generateMutation.isPending && <SkeletonBlock height={100} />}
        {!generateMutation.isPending && !result && (
          <EmptyState title="אין תוצאה להצגה" description="הפעל פעולה כדי לקבל תוצאת Snapshot." />
        )}
        {!generateMutation.isPending && result && (
          <dl className="snapshots-result__grid">
            <div>
              <dt>snapshot_id</dt>
              <dd>{result.snapshot_id}</dd>
            </div>
            <div>
              <dt>reused_existing</dt>
              <dd>{String(result.reused_existing)}</dd>
            </div>
            <div>
              <dt>draw_count</dt>
              <dd>{result.draw_count}</dd>
            </div>
            <div>
              <dt>dataset_hash_sha256</dt>
              <dd>{result.dataset_hash_sha256}</dd>
            </div>
            <div>
              <dt>status</dt>
              <dd>{result.status}</dd>
            </div>
          </dl>
        )}
      </section>
    </div>
  );
}

