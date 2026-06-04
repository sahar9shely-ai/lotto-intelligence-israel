import { FormEvent, useMemo, useState } from "react";
import { EmptyState } from "../../../components/shared/EmptyState";
import { ErrorPanel } from "../../../components/shared/ErrorPanel";
import { SkeletonBlock } from "../../../components/shared/SkeletonBlock";
import { ApiClientError } from "../../../services/api/client";
import { useDrawDetailQuery } from "../queries/useDrawDetailQuery";
import { DrawSort, useDrawsQuery } from "../queries/useDrawsQuery";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

function formatNumbers(values: number[]) {
  return values.join(", ");
}

export function DrawHistoryPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sort, setSort] = useState<DrawSort>("draw_date_desc");
  const [selectedDrawId, setSelectedDrawId] = useState<string | null>(null);

  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [appliedDateFrom, setAppliedDateFrom] = useState<string | undefined>(undefined);
  const [appliedDateTo, setAppliedDateTo] = useState<string | undefined>(undefined);

  const drawsQuery = useDrawsQuery({
    page,
    pageSize,
    dateFrom: appliedDateFrom,
    dateTo: appliedDateTo,
    sort,
  });
  const detailQuery = useDrawDetailQuery(selectedDrawId);

  const totalPages = useMemo(() => {
    if (!drawsQuery.data) {
      return 1;
    }
    return Math.max(1, Math.ceil(drawsQuery.data.total_count / pageSize));
  }, [drawsQuery.data, pageSize]);

  const listErrorMessage = (() => {
    if (drawsQuery.error instanceof ApiClientError) {
      return `${drawsQuery.error.message} (${drawsQuery.error.code ?? "UNKNOWN_ERROR"})`;
    }
    if (drawsQuery.error instanceof Error) {
      return drawsQuery.error.message;
    }
    return "אירעה שגיאה בעת טעינת היסטוריית ההגרלות.";
  })();

  const detailErrorMessage = (() => {
    if (detailQuery.error instanceof ApiClientError) {
      return `${detailQuery.error.message} (${detailQuery.error.code ?? "UNKNOWN_ERROR"})`;
    }
    if (detailQuery.error instanceof Error) {
      return detailQuery.error.message;
    }
    return "אירעה שגיאה בעת טעינת פרטי ההגרלה.";
  })();

  function onApplyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setSelectedDrawId(null);
    setAppliedDateFrom(filterDateFrom || undefined);
    setAppliedDateTo(filterDateTo || undefined);
  }

  return (
    <div className="draws-screen">
      <form className="draws-filters" onSubmit={onApplyFilters}>
        <label>
          מתאריך
          <input type="date" value={filterDateFrom} onChange={(event) => setFilterDateFrom(event.target.value)} />
        </label>
        <label>
          עד תאריך
          <input type="date" value={filterDateTo} onChange={(event) => setFilterDateTo(event.target.value)} />
        </label>
        <label>
          מיון
          <select
            value={sort}
            onChange={(event) => {
              setPage(1);
              setSort(event.target.value as DrawSort);
            }}
          >
            <option value="draw_date_desc">תאריך הגרלה (חדש לישן)</option>
            <option value="draw_date_asc">תאריך הגרלה (ישן לחדש)</option>
            <option value="draw_number_desc">מספר הגרלה (גבוה לנמוך)</option>
            <option value="draw_number_asc">מספר הגרלה (נמוך לגבוה)</option>
          </select>
        </label>
        <button type="submit">החל סינון</button>
      </form>

      <div className="draws-content">
        <section className="draws-table-wrap">
          {drawsQuery.isLoading && (
            <div className="draws-loading">
              <SkeletonBlock height={54} />
              <SkeletonBlock height={240} />
            </div>
          )}

          {drawsQuery.isError && !drawsQuery.isLoading && (
            <ErrorPanel title="שגיאת טעינה" message={listErrorMessage} />
          )}

          {!drawsQuery.isLoading && !drawsQuery.isError && (!drawsQuery.data || drawsQuery.data.items.length === 0) && (
            <EmptyState title="לא נמצאו הגרלות" description="נסה לשנות מסננים או טווח תאריכים." />
          )}

          {!drawsQuery.isLoading && !drawsQuery.isError && drawsQuery.data && drawsQuery.data.items.length > 0 && (
            <>
              <div className="draws-meta">
                <span>סה״כ רשומות: {drawsQuery.data.total_count}</span>
                <label>
                  גודל עמוד
                  <select
                    value={pageSize}
                    onChange={(event) => {
                      setPage(1);
                      setPageSize(Number(event.target.value));
                    }}
                  >
                    {PAGE_SIZE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="draws-table-scroll">
                <table className="draws-table">
                  <thead>
                    <tr>
                      <th>מספר הגרלה</th>
                      <th>תאריך</th>
                      <th>מספרים רגילים</th>
                      <th>מספר חזק</th>
                      <th>Jackpot</th>
                      <th>Rule</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drawsQuery.data.items.map((draw) => (
                      <tr key={draw.draw_uid} onClick={() => setSelectedDrawId(draw.draw_uid)}>
                        <td>{draw.draw_number}</td>
                        <td>{draw.draw_date}</td>
                        <td>{formatNumbers(draw.regular_numbers)}</td>
                        <td>{formatNumbers(draw.strong_numbers)}</td>
                        <td>{draw.jackpot_amount ?? "-"}</td>
                        <td>{draw.rule_version}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="draws-pagination">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page === 1}
                >
                  הקודם
                </button>
                <span>
                  עמוד {page} מתוך {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={page >= totalPages}
                >
                  הבא
                </button>
              </div>
            </>
          )}
        </section>

        <aside className="draw-detail-panel">
          <div className="draw-detail-panel__header">
            <h3>פרטי הגרלה</h3>
            {selectedDrawId && (
              <button
                type="button"
                onClick={() => {
                  setSelectedDrawId(null);
                }}
              >
                סגור
              </button>
            )}
          </div>

          {!selectedDrawId && (
            <EmptyState title="לא נבחרה הגרלה" description="בחר שורה בטבלה כדי להציג פרטים מלאים." />
          )}

          {selectedDrawId && detailQuery.isLoading && <SkeletonBlock height={180} />}

          {selectedDrawId && detailQuery.isError && !detailQuery.isLoading && (
            <ErrorPanel title="שגיאת פרטי הגרלה" message={detailErrorMessage} />
          )}

          {selectedDrawId && !detailQuery.isLoading && !detailQuery.isError && detailQuery.data && (
            <dl className="draw-detail-grid">
              <div>
                <dt>draw_number</dt>
                <dd>{detailQuery.data.draw_number}</dd>
              </div>
              <div>
                <dt>draw_date</dt>
                <dd>{detailQuery.data.draw_date}</dd>
              </div>
              <div>
                <dt>regular_numbers</dt>
                <dd>{formatNumbers(detailQuery.data.regular_numbers)}</dd>
              </div>
              <div>
                <dt>strong_numbers</dt>
                <dd>{formatNumbers(detailQuery.data.strong_numbers)}</dd>
              </div>
              <div>
                <dt>jackpot_amount</dt>
                <dd>{detailQuery.data.jackpot_amount ?? "-"}</dd>
              </div>
              <div>
                <dt>rule_version</dt>
                <dd>{detailQuery.data.rule_version}</dd>
              </div>
            </dl>
          )}
        </aside>
      </div>
    </div>
  );
}

