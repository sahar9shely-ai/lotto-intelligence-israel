import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import type { Investor, PlanAgreement, TopupRequest } from "../types/investments";
import { isAgreementExpired } from "../utils/agreementSigning";
import { investorOperationsHref, isActionQueueAdmin, loadPendingAgreementQueue, pendingInvestorRequests, requestOperationsHint } from "../utils/adminActionQueue";
import { isAdminShellInvestor } from "../utils/roles";
import { AgreementReminderAction } from "./AgreementReminderAction";
import "./adminActionQueue.css";
import { formatCalendarMonth, formatMoney, todayISO } from "../utils/format";
import {
  buildUrgentPaymentOps,
  overdueMonthsLabel,
  paymentsFocusHref,
  primaryUrgentRow,
  type UrgentInvestorRow,
} from "../utils/paymentOps";

type Props = {
  investorId?: number | null;
  investors?: Investor[] | null;
  investorsError?: string | null;
  onReloadInvestors?: () => void;
};

function currentYearFromToday(today: string): number {
  return Number(today.slice(0, 4));
}

function currentMonthNumber(today: string): number {
  return Number(today.slice(5, 7));
}

function statusHint(status: string): string {
  if (status === "awaiting_confirmation") return "נשלח · ממתין לאישור";
  if (status === "scheduled") return "טרם הועבר";
  return "חסר תשלום";
}

function VisibleRows({
  rows,
  monthHint,
}: {
  rows: UrgentInvestorRow[];
  monthHint?: string;
}) {
  const visible = rows.slice(0, 4);
  const extra = rows.length - visible.length;
  return (
    <ul className="urgent-card__list">
      {visible.map((row) => (
        <li key={`${row.investorId}-${row.dueDate}`}>
          <Link
            className="urgent-card__row"
            to={paymentsFocusHref(row)}
            aria-label={`לטפל בהעברה של ${row.investorName}`}
          >
            <div>
              <strong>{row.investorName}</strong>
              <span className="muted">
                {`${monthHint || formatCalendarMonth(row.dueDate)} · `}
                {statusHint(row.status)}
              </span>
            </div>
            <span className="urgent-card__amount">{formatMoney(row.amount)}</span>
          </Link>
        </li>
      ))}
      {extra > 0 ? (
        <li className="urgent-card__more muted">ועוד {extra}</li>
      ) : null}
    </ul>
  );
}

export function DashboardUrgentOps({ investorId = null, investors = null, investorsError, onReloadInvestors }: Props) {
  const { user } = useAuth();
  return <>
    <PaymentUrgentOps investorId={investorId} />
    {isActionQueueAdmin(user) ? <AdminActionQueue key={`${user!.id}:${investorId ?? "all"}`} investorId={investorId} investors={investors} investorsError={investorsError} onReloadInvestors={onReloadInvestors} /> : null}
  </>;
}

function PaymentUrgentOps({ investorId = null }: Pick<Props, "investorId">) {
  const today = todayISO();
  const year = currentYearFromToday(today);
  const includePrevYear = currentMonthNumber(today) === 1;

  const { data: yearPayments, loading, error, reload } = useAsync(
    () =>
      api.payments({
        year,
        investor_id: investorId ?? undefined,
      }),
    [year, investorId],
  );

  const { data: prevYearPayments } = useAsync(
    () =>
      includePrevYear
        ? api.payments({
            year: year - 1,
            investor_id: investorId ?? undefined,
          })
        : Promise.resolve([]),
    [includePrevYear, year, investorId],
  );

  if (loading && !yearPayments) {
    return (
      <section className="urgent-ops" aria-label="דחוף עכשיו">
        <p className="urgent-ops__loading muted">בודק תשלומים לחודש הנוכחי...</p>
      </section>
    );
  }

  if (error && !yearPayments) {
    return (
      <section className="urgent-ops" aria-label="דחוף עכשיו">
        <article className="urgent-card urgent-card--missing">
          <p className="urgent-card__eyebrow">תשלומים</p>
          <h2 className="urgent-card__title">לא ניתן לבדוק תשלומים דחופים</h2>
          <p className="urgent-card__detail">{error}</p>
          <button type="button" className="btn btn--small btn--admin" onClick={reload}>
            נסה שוב
          </button>
        </article>
      </section>
    );
  }

  const ops = buildUrgentPaymentOps(
    [...(yearPayments ?? []), ...(prevYearPayments ?? [])],
    today,
    investorId,
  );
  const missing = ops.missingThisMonth;
  const overdue = ops.overdueTransfers;
  const missingTotal = missing.reduce((sum, row) => sum + row.amount, 0);
  const overdueTotal = overdue.reduce((sum, row) => sum + row.amount, 0);
  const overdueLabel = overdueMonthsLabel(ops.overdueMonthKeys);
  const overdueFocus = primaryUrgentRow(overdue);
  const missingFocus = primaryUrgentRow(missing);

  return (
    <section className="urgent-ops" aria-label="דחוף עכשיו">
      <header className="urgent-ops__head">
        <h2 className="urgent-ops__title">דחוף עכשיו</h2>
      </header>

      {overdue.length > 0 ? (
        <article className="urgent-card urgent-card--overdue" aria-label="העברה חודשית שעבר מועדה">
          <p className="urgent-card__eyebrow">עבר מועד · {overdueLabel || "חודש קודם"}</p>
          <p className="urgent-card__hero">{formatMoney(overdueTotal)}</p>
          <h3 className="urgent-card__title">
            {overdue.length === 1
              ? `${overdue[0].investorName} ממתין להעברה`
              : `${overdue.length} ממתינים להעברה`}
          </h3>
          <VisibleRows rows={overdue} />
          <Link
            className="btn btn--small btn--gold"
            to={overdueFocus ? paymentsFocusHref(overdueFocus) : "/payments"}
          >
            לטפל בהעברה
          </Link>
        </article>
      ) : null}

      {missing.length > 0 ? (
        <article className="urgent-card urgent-card--missing" aria-label="חסר תשלום החודש">
          <p className="urgent-card__eyebrow">{ops.currentMonthLabel}</p>
          <p className="urgent-card__hero">{formatMoney(missingTotal)}</p>
          <h3 className="urgent-card__title">
            {missing.length === 1
              ? `${missing[0].investorName} טרם קיבל החודש`
              : `${missing.length} טרם קיבלו ב${ops.currentMonthLabel}`}
          </h3>
          <VisibleRows rows={missing} monthHint={ops.currentMonthLabel} />
          <Link
            className="btn btn--small btn--admin"
            to={missingFocus ? paymentsFocusHref(missingFocus) : "/payments"}
          >
            לתשלומים
          </Link>
        </article>
      ) : null}

      {overdue.length === 0 && missing.length === 0 ? (
        <article className="urgent-card urgent-card--ok" aria-label="אין תשלומים דחופים">
          <p className="urgent-card__eyebrow">{ops.currentMonthLabel}</p>
          <h3 className="urgent-card__title">התשלומים מעודכנים</h3>
          <p className="urgent-card__detail">אין תשלום חסר החודש.</p>
          <Link className="btn btn--small btn--ghost hide-on-phone" to="/payments">
            לתשלומים
          </Link>
        </article>
      ) : null}
    </section>
  );
}

function QueueRows<T extends { id: number }>({ rows, render, noun }: { rows: T[]; render: (row: T) => ReactNode; noun: string }) {
  return <>
    <ul className="admin-action-queue__list">{rows.slice(0, 4).map(row => <li className="admin-action-queue__row" key={row.id}>{render(row)}</li>)}</ul>
    {rows.length > 4 ? <details><summary>עוד {rows.length - 4} {noun}</summary><ul className="admin-action-queue__list">{rows.slice(4).map(row => <li className="admin-action-queue__row" key={row.id}>{render(row)}</li>)}</ul></details> : null}
  </>;
}

function AdminActionQueue({ investorId, investors, investorsError, onReloadInvestors }: Required<Pick<Props, "investorId" | "investors">> & Pick<Props, "investorsError" | "onReloadInvestors">) {
  const book = (investors ?? []).filter(row => !isAdminShellInvestor(row) && (investorId == null || row.id === investorId));
  const ids = book.map(row => row.id);
  const scopeKey = `${investorId ?? "all"}:${ids.join(",")}`;
  const investorListReady = investors != null;
  const scopeMissing = investorListReady && investorId != null && book.length === 0;
  const { data: agreementData, error: agreementError, refreshing: agreementsRefreshing, reload: reloadAgreements } = useAsync(
    async () => ({ scopeKey, ...(await loadPendingAgreementQueue(investorListReady ? book : [], api.agreements)), ready: investorListReady }),
    [scopeKey, investorListReady],
  );
  const { data: requestData, error: requestsError, loading: requestsLoading, refreshing: requestsRefreshing, reload: reloadRequests } = useAsync(
    () => api.topupRequests(investorId == null ? undefined : { investor_id: investorId }),
    [investorId],
  );
  const agreementsReady = !investorsError && !agreementError && !scopeMissing && agreementData?.scopeKey === scopeKey && agreementData.ready;
  const agreements = agreementsReady ? agreementData.rows : [];
  const failedInvestors = agreementsReady ? agreementData.failedInvestors : [];
  const requestsReady = investorListReady && !investorsError && !scopeMissing && requestData != null;
  const requests = requestsReady ? pendingInvestorRequests(requestData, ids) : [];
  const expiredCount = agreements.filter(row => isAgreementExpired(row)).length;
  const refreshing = agreementsRefreshing || requestsRefreshing;
  function reloadQueue() {
    reloadAgreements();
    reloadRequests();
    if (investorsError || scopeMissing) onReloadInvestors?.();
  }
  function agreementRow(row: PlanAgreement) {
    const expired = isAgreementExpired(row);
    return <>
      <strong>{book.find(inv => inv.id === row.investor_id)?.name || row.snapshot.investor_name}</strong>
      <span>{row.snapshot.title} · הסכם #{row.id}</span>
      <span className={expired ? "admin-action-queue__expired" : undefined}>{expired ? "פג תוקף לחתימה · נדרש טיפול במסמך" : "ממתין לחתימת המשקיע"}</span>
      <div className="admin-action-queue__links">
        <Link className="text-link" to={`/agreements/${row.id}/sign`}>צפייה בהסכם</Link>
        <Link className="text-link" to={investorOperationsHref(row.investor_id, "documents")}>להסכמים בתיק</Link>
      </div>
      <AgreementReminderAction agreement={row} recipientName={book.find(inv => inv.id === row.investor_id)?.name} />
    </>;
  }
  function requestRow(row: TopupRequest) {
    return <>
      <strong>{row.investor_name} · {formatMoney(row.amount)}</strong>
      <span>בקשה #{row.id} · {requestOperationsHint(row)}</span>
      <div className="admin-action-queue__links"><Link className="text-link" to={investorOperationsHref(row.investor_id, "requests")}>לטיפול בבקשה בתיק</Link></div>
    </>;
  }
  const scopeError = investorsError || (scopeMissing ? "תיק המשקיע שבסינון אינו זמין." : null);
  return <section className="admin-action-queue" aria-label="הסכמים ובקשות לטיפול">
    <header className="admin-action-queue__head">
      <div><h2>הסכמים ובקשות לטיפול</h2><p>{investorId == null ? "כל תיקי המשקיעים" : book[0]?.name || "תיק המשקיע שנבחר"}</p></div>
      <button type="button" className="btn btn--small btn--ghost" disabled={refreshing} onClick={reloadQueue}>{refreshing ? "מרענן..." : "רענון התור"}</button>
    </header>
    {scopeError ? <p className="admin-action-queue__state admin-action-queue__error" role="alert">לא ניתן לבדוק את התור: {scopeError}</p> : <div className="admin-action-queue__grid">
      <article className="admin-action-queue__group" aria-label="הסכמים ממתינים">
        <h3>הסכמים ממתינים {agreementsReady ? <span className="admin-action-queue__count">{agreements.length}{failedInvestors.length ? " שנמצאו" : ""}</span> : null}</h3>
        {agreementError ? <p className="admin-action-queue__state admin-action-queue__error" role="alert">לא ניתן לבדוק הסכמים: {agreementError}</p> : !agreementsReady ? <p className="admin-action-queue__state" role="status">בודק הסכמים ממתינים...</p> : <>
          {failedInvestors.length ? <p className="admin-action-queue__state admin-action-queue__error" role="alert">הבדיקה חלקית: לא ניתן לטעון את ההסכמים של {failedInvestors.map(row => row.name).join(", ")}. אפשר לנסות שוב ברענון התור.</p> : null}
          {expiredCount > 0 ? <p className="admin-action-queue__state">{expiredCount} מהמסמכים פגו תוקף לחתימה.</p> : null}
          {agreements.length ? <QueueRows rows={agreements} render={agreementRow} noun="הסכמים" /> : !failedInvestors.length ? <p className="admin-action-queue__state">אין הסכמים הממתינים לחתימה.</p> : null}
        </>}
      </article>
      <article className="admin-action-queue__group" aria-label="בקשות מסלול פתוחות">
        <h3>בקשות מסלול {requestsReady && !requestsError ? <span className="admin-action-queue__count">{requests.length}</span> : null}</h3>
        {requestsError ? <p className="admin-action-queue__state admin-action-queue__error" role="alert">לא ניתן לבדוק בקשות: {requestsError}</p> : requestsLoading || !requestsReady ? <p className="admin-action-queue__state" role="status">בודק בקשות מסלול...</p> : requests.length ? <QueueRows rows={requests} render={requestRow} noun="בקשות" /> : <p className="admin-action-queue__state">אין בקשות מסלול פתוחות.</p>}
      </article>
    </div>}
  </section>;
}
