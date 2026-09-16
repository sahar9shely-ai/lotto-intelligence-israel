import { useMemo, useState } from "react";
import { Panel } from "../components/Panel";
import { ScrollReveal } from "../components/motion/ScrollReveal";
import { Toast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import type { VaultDocument, VaultDocumentKind } from "../types/investments";
import { contractPdfFile } from "../utils/contractPdf";
import { formatDate } from "../utils/format";
import { monthlyReportPdfFile } from "../utils/monthlyReportPdf";
import { openPdfBlob, savePdfBlob } from "../utils/pdfDocument";
import { yearlyPaymentsPdfFile } from "../utils/paymentsPdf";
import { quotePdfFile } from "../utils/quotePdf";
import { isAdminAccount, isAdminShellInvestor } from "../utils/roles";

const KIND_ORDER: VaultDocumentKind[] = ["contract", "quote", "yearly", "monthly"];

const KIND_SECTION: Record<VaultDocumentKind, string> = {
  contract: "חוזים",
  quote: "הצעות",
  yearly: "דוחות שנתיים",
  monthly: "דוחות חודשיים",
};

function kindGlyph(kind: VaultDocumentKind) {
  if (kind === "contract") return "חתימה";
  if (kind === "quote") return "הצעה";
  if (kind === "yearly") return "שנתי";
  return "חודשי";
}

export function DocumentsPage() {
  const { user } = useAuth();
  const isManager = Boolean(user?.is_manager);
  const isAdmin = isAdminAccount(user);
  const [filterId, setFilterId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const { data: investors } = useAsync(
    () => (isManager ? api.investors() : Promise.resolve([])),
    [isManager],
  );

  const investorOptions = useMemo(
    () => (investors ?? []).filter((inv) => !isAdminShellInvestor(inv)),
    [investors],
  );

  const scopedId = isManager ? filterId : null;
  const canLoad = !isManager || scopedId != null;

  const { data, error, loading, reload } = useAsync(
    () =>
      canLoad
        ? api.documents(isManager ? scopedId ?? undefined : undefined)
        : Promise.resolve(null),
    [isManager, scopedId, canLoad],
  );

  const groups = useMemo(() => {
    const docs = data?.documents ?? [];
    return KIND_ORDER.map((kind) => ({
      kind,
      title: KIND_SECTION[kind],
      items: docs.filter((row) => row.kind === kind),
    })).filter((group) => group.items.length > 0);
  }, [data]);

  const investorName =
    data?.investor_name ||
    investorOptions.find((inv) => inv.id === scopedId)?.name ||
    user?.investor_name ||
    user?.username ||
    "תיק פרטי";

  async function buildPdf(doc: VaultDocument): Promise<File> {
    if (doc.kind === "contract") {
      if (!doc.source_id) throw new Error("החוזה לא נמצא");
      const req = await api.topupRequest(doc.source_id);
      return contractPdfFile(req);
    }
    if (doc.kind === "quote") {
      if (!doc.source_id) throw new Error("ההצעה לא נמצאה");
      const quote = await api.quote(doc.source_id);
      return quotePdfFile(quote);
    }
    if (doc.kind === "yearly") {
      const year = Number(doc.period);
      if (!year) throw new Error("שנת הדוח חסרה");
      const investorId = isManager ? scopedId ?? undefined : undefined;
      const [payments, report] = await Promise.all([
        api.payments({ year, investor_id: investorId }),
        api.paymentReport(year, investorId),
      ]);
      return yearlyPaymentsPdfFile({
        year,
        payments,
        isManager: false,
        investorFilterName: investorName,
        lifetime: report.lifetime,
      });
    }
    const period = doc.period || "";
    const [yearS, monthS] = period.split("-");
    const year = Number(yearS);
    const month = Number(monthS);
    if (!year || !month) throw new Error("חודש הדוח חסר");
    const investorId = isManager ? scopedId ?? undefined : undefined;
    const [dashboard, payments] = await Promise.all([
      api.dashboard(investorId != null ? { investor_id: investorId } : undefined),
      api.payments({ year, investor_id: investorId }),
    ]);
    return monthlyReportPdfFile({
      dashboard,
      payments,
      investorName,
      monthDate: new Date(year, month - 1, 1),
    });
  }

  async function runDoc(doc: VaultDocument, mode: "view" | "download") {
    setBusyId(`${doc.id}:${mode}`);
    setMessage(null);
    try {
      const file = await buildPdf(doc);
      if (mode === "view") openPdfBlob(file, file.name);
      else savePdfBlob(file, file.name);
      setMessage(mode === "view" ? "המסמך נפתח" : "המסמך ירד");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "לא ניתן להפיק את המסמך");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="page">
      <Toast message={message} onClear={() => setMessage(null)} />
      <ScrollReveal>
        <header className={`page-intro${isAdmin ? " page-intro--admin" : ""}`}>
          <div>
            <h1 className="page-intro__title">כספת מסמכים</h1>
          </div>
        </header>
      </ScrollReveal>

      {isManager && investorOptions.length > 0 ? (
        <div className="scope-bar" role="tablist" aria-label="בחירת משקיע">
          {investorOptions.map((inv) => (
            <button
              key={inv.id}
              type="button"
              role="tab"
              aria-selected={filterId === inv.id}
              className={filterId === inv.id ? "scope-bar__btn is-active" : "scope-bar__btn"}
              onClick={() => setFilterId(inv.id)}
            >
              {inv.name}
            </button>
          ))}
        </div>
      ) : null}

      {isManager && filterId == null ? (
        <div className="vault-empty">
          <p>בחרו משקיע כדי לראות את כספת המסמכים שלו.</p>
        </div>
      ) : loading ? (
        <div className="state state--loading">טוען את הכספת...</div>
      ) : error ? (
        <div className="state state--error">
          <p>{error}</p>
          <button type="button" className="btn" onClick={reload}>
            נסה שוב
          </button>
        </div>
      ) : !data || groups.length === 0 ? (
        <div className="vault-empty">
          <p>עדיין אין מסמכים בתיק{data?.investor_name ? ` של ${data.investor_name}` : ""}.</p>
          <span>חוזה חתום, הצעה ודוח חודשי או שנתי יופיעו כאן ברגע שיהיו במערכת.</span>
        </div>
      ) : (
        groups.map((group) => (
          <ScrollReveal key={group.kind}>
            <Panel title={group.title} className="vault-panel">
            <ul className="vault-list">
              {group.items.map((doc) => {
                const viewBusy = busyId === `${doc.id}:view`;
                const downBusy = busyId === `${doc.id}:download`;
                const busy = viewBusy || downBusy;
                return (
                  <li key={doc.id} className="vault-row">
                    <div className="vault-row__copy">
                      <span className="vault-row__kind">{kindGlyph(doc.kind)}</span>
                      <strong className="vault-row__title">{doc.title}</strong>
                      {doc.subtitle ? <span className="vault-row__meta">{doc.subtitle}</span> : null}
                      {doc.issued_at ? (
                        <span className="vault-row__meta">{formatDate(doc.issued_at)}</span>
                      ) : null}
                    </div>
                    <div className="vault-row__actions">
                      <button
                        type="button"
                        className="btn btn--ghost btn--small"
                        disabled={busy}
                        onClick={() => void runDoc(doc, "view")}
                      >
                        {viewBusy ? "פותחים..." : "צפייה"}
                      </button>
                      <button
                        type="button"
                        className="btn btn--gold btn--small"
                        disabled={busy}
                        onClick={() => void runDoc(doc, "download")}
                      >
                        {downBusy ? "מכינים..." : "הורדה"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
          </ScrollReveal>
        ))
      )}
    </div>
  );
}
