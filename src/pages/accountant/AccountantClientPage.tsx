import { useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowRight,
  Download,
  FileText,
  Check,
  Clock,
  AlertTriangle,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getClientSummary,
  getClientDocuments,
  downloadClientMonthlyPdf,
  downloadClientExport,
} from "@/lib/accountant-api";
import { isAccountantLoggedIn } from "@/lib/accountant-session";
import { useToast } from "@/hooks/use-toast";
import type { DocumentFilter } from "@/lib/api";

const statusConfig: Record<string, { label: string; className: string }> = {
  sent: { label: "נשלח", className: "bg-success/10 text-success" },
  pending: { label: "ממתין", className: "bg-warning/10 text-warning" },
  review: { label: "לבדיקה", className: "bg-coral-light text-coral" },
};

function formatAmount(cents: number): string {
  if (cents === 0) return "ממתין לחילוץ";
  return `₪${(cents / 100).toLocaleString("he-IL", { maximumFractionDigits: 0 })}`;
}

function formatDate(dateIso: string): string {
  return new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "short", year: "numeric" }).format(new Date(dateIso));
}

const AccountantClientPage = () => {
  const { businessId } = useParams<{ businessId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<DocumentFilter>("all");
  const [searchTerm, setSearchTerm] = useState("");

  if (!isAccountantLoggedIn()) {
    navigate("/accountant", { replace: true });
    return null;
  }

  const summaryQuery = useQuery({
    queryKey: ["accountant", "client-summary", businessId],
    queryFn: () => getClientSummary(businessId!),
    enabled: Boolean(businessId),
  });

  const documentsQuery = useQuery({
    queryKey: ["accountant", "client-documents", businessId, activeTab],
    queryFn: () => getClientDocuments(businessId!, activeTab),
    enabled: Boolean(businessId),
  });

  const pdfMutation = useMutation({
    mutationFn: () => downloadClientMonthlyPdf(businessId!),
    onSuccess: (blob) => {
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const now = new Date();
      link.download = `sendtoamram-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    },
    onError: (error) => {
      toast({ title: "הורדת PDF נכשלה", description: error instanceof Error ? error.message : "", variant: "destructive" });
    },
  });

  const exportMutation = useMutation({
    mutationFn: () => downloadClientExport(businessId!, activeTab),
    onSuccess: (blob) => {
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `sendtoamram-${businessId}-${activeTab}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    },
    onError: (error) => {
      toast({ title: "ייצוא נכשל", description: error instanceof Error ? error.message : "", variant: "destructive" });
    },
  });

  const filteredDocuments = useMemo(() => {
    const docs = documentsQuery.data?.documents ?? [];
    const term = searchTerm.trim().toLowerCase();
    if (!term) return docs;
    return docs.filter((doc) => doc.vendor.toLowerCase().includes(term) || doc.category.toLowerCase().includes(term));
  }, [documentsQuery.data?.documents, searchTerm]);

  const summary = summaryQuery.data;

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/accountant/dashboard">
              <Button variant="ghost" size="icon"><ArrowRight className="w-5 h-5" /></Button>
            </Link>
            <div>
              <h1 className="font-display font-bold text-lg text-foreground">
                {summary?.business.name ?? "טוען..."}
              </h1>
              <p className="text-xs text-muted-foreground">
                {summary ? `${summary.totals.documents} מסמכים · ${summary.totals.pending} ממתינים` : ""}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => pdfMutation.mutate()} disabled={pdfMutation.isPending}>
              <FileText className="w-4 h-4" /> PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
              <Download className="w-4 h-4" /> CSV
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-card rounded-xl p-4 shadow-card border border-border text-center">
              <p className="text-2xl font-bold text-foreground">{summary.totals.documents}</p>
              <p className="text-xs text-muted-foreground">סה״כ מסמכים</p>
            </div>
            <div className="bg-card rounded-xl p-4 shadow-card border border-border text-center">
              <p className="text-2xl font-bold text-foreground">{formatAmount(summary.totals.amountCents)}</p>
              <p className="text-xs text-muted-foreground">סכום כולל</p>
            </div>
            <div className="bg-card rounded-xl p-4 shadow-card border border-border text-center">
              <p className="text-2xl font-bold text-warning">{summary.totals.pending}</p>
              <p className="text-xs text-muted-foreground">ממתינים</p>
            </div>
            <div className="bg-card rounded-xl p-4 shadow-card border border-border text-center">
              <p className="text-2xl font-bold text-success">{summary.totals.sent}</p>
              <p className="text-xs text-muted-foreground">נשלחו</p>
            </div>
          </div>
        )}

        <div className="bg-card rounded-xl shadow-card border border-border">
          <div className="p-4 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex gap-1">
              {(["all", "pending", "review", "sent"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === tab ? "bg-coral text-accent-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab === "all" ? "הכל" : tab === "pending" ? "ממתינות" : tab === "review" ? "לבדיקה" : "נשלחו"}
                </button>
              ))}
            </div>
            <div className="relative flex-1 sm:w-48 sm:max-w-xs">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="חפש..."
                className="pr-9 h-9"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <div className="divide-y divide-border min-h-[300px]">
            {documentsQuery.isLoading && (
              <div className="p-8 text-sm text-muted-foreground text-center">טוען מסמכים...</div>
            )}
            {!documentsQuery.isLoading && filteredDocuments.length === 0 && (
              <div className="p-8 text-center text-sm text-muted-foreground">אין מסמכים להצגה.</div>
            )}
            {filteredDocuments.map((doc) => {
              const status = statusConfig[doc.status] ?? statusConfig.pending;
              return (
                <div key={doc.id} className="flex items-center gap-4 p-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">{doc.vendor}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(doc.issuedAt)} · {doc.category}</p>
                  </div>
                  <span className="font-display font-semibold text-foreground">{formatAmount(doc.amountCents)}</span>
                  <span className={`px-2 py-1 rounded-md text-xs font-medium ${status.className}`}>
                    {status.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AccountantClientPage;
