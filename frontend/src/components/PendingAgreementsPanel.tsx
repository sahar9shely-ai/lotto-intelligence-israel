import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";
import type { PlanAgreement } from "../types/investments";
import { formatDate } from "../utils/format";
import { isAgreementExpired } from "../utils/agreementSigning";
import { Panel } from "./Panel";
import "./agreementWorkflow.css";

export function PendingAgreementsPanel() {
  const { user } = useAuth();
  if (!user || user.is_manager || !user.investor_id) return null;
  return <OwnPendingAgreements key={`${user.id}:${user.investor_id}`} investorId={user.investor_id} />;
}

function OwnPendingAgreements({ investorId }: { investorId: number }) {
  const [rows, setRows] = useState<PlanAgreement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api.agreements(investorId).then(result => {
      if (active) setRows(result.filter(row => row.investor_id === investorId && row.status === "pending"));
    }).catch(reason => {
      if (active) {setRows([]); setError(reason instanceof Error ? reason.message : "טעינת ההסכמים נכשלה");}
    }).finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, [investorId, revision]);
  useEffect(() => {
    const refresh = () => {if (document.visibilityState === "visible") setRevision(value => value + 1);};
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  if (!loading && !error && rows.length === 0) return null;
  return <Panel className="pending-agreements" title="ממתינים לחתימה שלך"
    subtitle="ההסכם המלא והחתימה הדיגיטלית זמינים כאן במערכת">
    {loading ? <p role="status">בודקים מסמכים הממתינים לחתימה...</p> : null}
    {error ? <div role="alert"><p>{error}</p><button className="btn btn--ghost" onClick={() => setRevision(value => value + 1)}>נסה שוב</button></div> : null}
    {!loading && !error ? <ul className="pending-agreements__list">
      {rows.map(row => <li key={row.id}>
        <div><strong>{row.snapshot.title}</strong><span className="muted">הופק {formatDate(row.created_at)}{row.plan_id ? ` · מסלול #${row.plan_id}` : ""}</span>{isAgreementExpired(row) ? <span className="hint">תוקף החתימה פג. יש לפנות למנהל לקבלת הסכם מעודכן.</span> : null}</div>
        <Link className={`btn ${isAgreementExpired(row) ? "btn--ghost" : "btn--primary"}`} to={`/agreements/${row.id}/sign`}>{isAgreementExpired(row) ? "צפייה בהסכם" : "קריאת ההסכם וחתימה"}</Link>
      </li>)}
    </ul> : null}
  </Panel>;
}
