import { EmptyState } from "../../../components/shared/EmptyState";
import { ErrorPanel } from "../../../components/shared/ErrorPanel";
import { SkeletonBlock } from "../../../components/shared/SkeletonBlock";
import { ApiClientError } from "../../../services/api/client";
import { useHealthQuery } from "../queries/useHealthQuery";

export function SystemHealthPage() {
  const { data, isLoading, isError, error, isFetching, refetch } = useHealthQuery();

  const errorMessage = (() => {
    if (error instanceof ApiClientError) {
      return `${error.message} (${error.code ?? "UNKNOWN_ERROR"})`;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return "אירעה שגיאה בעת טעינת מצב המערכת.";
  })();

  return (
    <div className="health-screen">
      <div className="health-screen__actions">
        <button
          type="button"
          className="health-screen__refresh"
          onClick={() => {
            void refetch();
          }}
          disabled={isFetching}
        >
          {isFetching ? "מרענן..." : "רענון ידני"}
        </button>
      </div>

      {isLoading && (
        <div className="health-screen__loading">
          <SkeletonBlock height={72} />
          <SkeletonBlock height={200} />
        </div>
      )}

      {isError && !isLoading && <ErrorPanel title="שגיאת מערכת" message={errorMessage} />}

      {!isLoading && !isError && !data && (
        <EmptyState title="אין נתוני מערכת" description="לא התקבלו נתוני בריאות מערכת מהשרת." />
      )}

      {!isLoading && !isError && data && (
        <section className="health-card">
          <header className="health-card__header">
            <h3>מצב שירות</h3>
            <span className={`health-card__status health-card__status--${data.status}`}>{data.status}</span>
          </header>

          <dl className="health-card__grid">
            <div>
              <dt>Service</dt>
              <dd>{data.service}</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>{data.version}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{data.status}</dd>
            </div>
            <div>
              <dt>time_utc</dt>
              <dd>{data.time_utc}</dd>
            </div>
          </dl>

          <section className="health-dependencies">
            <h4>Dependencies</h4>
            <div className="health-dependencies__grid">
              <article>
                <h5>postgres</h5>
                <p>{data.dependencies.postgres}</p>
              </article>
              <article>
                <h5>redis</h5>
                <p>{data.dependencies.redis}</p>
              </article>
              <article>
                <h5>queue</h5>
                <p>{data.dependencies.queue}</p>
              </article>
            </div>
          </section>
        </section>
      )}
    </div>
  );
}

