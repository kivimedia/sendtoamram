import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Link, Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpLeft,
  Check,
  Clock,
  Download,
  Eye,
  FileText,
  Filter,
  Mail,
  MessageCircle,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Send,
  TrendingUp,
  AlertTriangle,
  CreditCard,
  Sparkles,
  X,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DocumentFilter,
  DocumentUpdate,
  downloadDashboardExport,
  downloadMonthlyPdf,
  getDashboardChat,
  getDashboardDocumentDetail,
  getDashboardDocuments,
  getDashboardSummary,
  postDashboardChat,
  sendToAccountant,
  syncDashboard,
  updateDocument,
  createCheckoutSession,
  createBillingPortal,
  getDashboardCategories,
  getDashboardAlerts,
  dismissAlert,
} from "@/lib/api";
import { getActiveBusinessId } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import DeepScanProgress, { DeepScanExpandedProgress } from "@/components/DeepScanProgress";

const statusConfig: Record<string, { label: string; className: string; icon: typeof Check }> = {
  sent: { label: "נשלח", className: "bg-success/10 text-success", icon: Check },
  pending: { label: "ממתין", className: "bg-warning/10 text-warning", icon: Clock },
  review: { label: "לבדיקה", className: "bg-coral-light text-coral", icon: AlertTriangle },
};

const sourceIcons: Record<string, string> = {
  gmail: "📧",
  outlook: "📬",
  imap: "✉️",
  whatsapp: "💬",
};

function formatAmount(cents: number): string {
  if (cents === 0) return "ממתין לחילוץ";
  return `₪${(cents / 100).toLocaleString("he-IL", { maximumFractionDigits: 0 })}`;
}

function formatDate(dateIso: string): string {
  return new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "short", year: "numeric" }).format(new Date(dateIso));
}

const DashboardPage = () => {
  const businessId = getActiveBusinessId();
  const [chatInput, setChatInput] = useState("");
  const [activeTab, setActiveTab] = useState<DocumentFilter>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<DocumentUpdate>({});
  const [customCategory, setCustomCategory] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const summaryQuery = useQuery({
    queryKey: ["dashboard", "summary", businessId],
    queryFn: () => getDashboardSummary(businessId as string),
    enabled: Boolean(businessId),
  });

  const documentsQuery = useQuery({
    queryKey: ["dashboard", "documents", businessId, activeTab],
    queryFn: () => getDashboardDocuments(businessId as string, activeTab),
    enabled: Boolean(businessId),
  });

  const chatQuery = useQuery({
    queryKey: ["dashboard", "chat", businessId],
    queryFn: () => getDashboardChat(businessId as string),
    enabled: Boolean(businessId),
  });

  const detailQuery = useQuery({
    queryKey: ["dashboard", "document-detail", businessId, selectedDocumentId],
    queryFn: () => getDashboardDocumentDetail(businessId as string, selectedDocumentId as string),
    enabled: Boolean(businessId && selectedDocumentId),
  });

  const categoriesQuery = useQuery({
    queryKey: ["dashboard", "categories", businessId],
    queryFn: () => getDashboardCategories(businessId as string),
    enabled: Boolean(businessId),
  });

  const alertsQuery = useQuery({
    queryKey: ["dashboard", "alerts", businessId],
    queryFn: () => getDashboardAlerts(businessId as string),
    enabled: Boolean(businessId),
  });

  const dismissAlertMutation = useMutation({
    mutationFn: async (alertId: string) => dismissAlert(businessId as string, alertId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard", "alerts", businessId] });
    },
  });

  const sendChatMutation = useMutation({
    mutationFn: async (text: string) => postDashboardChat(businessId as string, text),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard", "chat", businessId] });
      setChatInput("");
    },
    onError: (error) => {
      toast({
        title: "שליחת הודעה נכשלה",
        description: error instanceof Error ? error.message : "אירעה שגיאה בשליחת ההודעה.",
        variant: "destructive",
      });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => syncDashboard(businessId as string),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast({
        title: "סנכרון הושלם",
        description: data.newDocuments > 0
          ? `נמצאו ${data.newDocuments} מסמכים חדשים.`
          : "אין מסמכים חדשים.",
      });
    },
    onError: (error) => {
      toast({
        title: "סנכרון נכשל",
        description: error instanceof Error ? error.message : "אירעה שגיאה בסנכרון.",
        variant: "destructive",
      });
    },
  });

  const sendMutation = useMutation({
    mutationFn: async () => sendToAccountant(businessId as string),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      if (data.sent) {
        toast({
          title: "נשלח לרואה החשבון",
          description: `${data.documentCount} מסמכים נשלחו ל-${data.accountantEmail}`,
        });
      } else {
        toast({
          title: "אין מסמכים לשליחה",
          description: data.message ?? "אין מסמכים ממתינים.",
        });
      }
    },
    onError: (error) => {
      toast({
        title: "השליחה נכשלה",
        description: error instanceof Error ? error.message : "אירעה שגיאה בשליחת המסמכים.",
        variant: "destructive",
      });
    },
  });

  const exportMutation = useMutation({
    mutationFn: async () => downloadDashboardExport(businessId as string, activeTab),
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
      toast({
        title: "ייצוא נכשל",
        description: error instanceof Error ? error.message : "לא הצלחנו לייצא קובץ.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: DocumentUpdate) =>
      updateDocument(businessId as string, selectedDocumentId as string, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setIsEditing(false);
      toast({ title: "המסמך עודכן בהצלחה" });
    },
    onError: (error) => {
      toast({
        title: "עדכון נכשל",
        description: error instanceof Error ? error.message : "אירעה שגיאה.",
        variant: "destructive",
      });
    },
  });

  const pdfMutation = useMutation({
    mutationFn: async () => downloadMonthlyPdf(businessId as string),
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
      toast({
        title: "הורדת PDF נכשלה",
        description: error instanceof Error ? error.message : "לא הצלחנו להוריד את הקובץ.",
        variant: "destructive",
      });
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: async () => createCheckoutSession(businessId as string),
    onSuccess: (data) => {
      if (data.alreadyPaid) {
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        toast({ title: "החשבון כבר מופעל!" });
        return;
      }
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    },
    onError: (error) => {
      toast({
        title: "שגיאה בפתיחת תשלום",
        description: error instanceof Error ? error.message : "אירעה שגיאה.",
        variant: "destructive",
      });
    },
  });

  const portalMutation = useMutation({
    mutationFn: async () => createBillingPortal(businessId as string),
    onSuccess: (data) => {
      if (data.portalUrl) {
        window.location.href = data.portalUrl;
      }
    },
  });

  // Billing state from summary
  const summary = summaryQuery.data;
  const billing = summary?.billing;
  const isPaid = !billing || (billing.onboardingPaid && billing.subscriptionStatus === "active");

  const filteredDocuments = useMemo(() => {
    const docs = documentsQuery.data?.documents ?? [];
    const term = searchTerm.trim().toLowerCase();
    if (!term) {
      return docs;
    }
    return docs.filter((doc) => doc.vendor.toLowerCase().includes(term) || doc.category.toLowerCase().includes(term));
  }, [documentsQuery.data?.documents, searchTerm]);

  if (!businessId) {
    return <Navigate to="/onboarding" replace />;
  }

  const stats = summary
    ? [
        {
          label: "מסמכים החודש",
          value: summary.month.documents.toString(),
          change: `${summary.month.documentsDelta >= 0 ? "+" : ""}${summary.month.documentsDelta}`,
          icon: FileText,
          trend: "up",
        },
        {
          label: "סכום החודש",
          value: formatAmount(summary.month.amountCents),
          change: `${summary.month.amountDeltaPercent >= 0 ? "+" : ""}${summary.month.amountDeltaPercent}%`,
          icon: TrendingUp,
          trend: "up",
        },
        {
          label: `נשלח ל${summary.business.accountantName}`,
          value: summary.totals.sent.toString(),
          change: `${summary.totals.pending + summary.totals.review} ממתינות`,
          icon: Send,
          trend: "neutral",
        },
        {
          label: "תיבות מחוברות",
          value: summary.totals.connectedInboxes.toString(),
          change: "סנכרון פעיל",
          icon: Mail,
          trend: "up",
        },
      ]
    : [];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-20 pb-8">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
            <div>
              <h1 className="font-display text-2xl md:text-3xl font-bold text-foreground">בוקר טוב! ☀️</h1>
              <p className="text-muted-foreground">
                {summary
                  ? `${summary.business.accountantName} קיבל/ה ${summary.totals.sent} מסמכים. אתה על אוטופיילוט.`
                  : "טוען נתוני דשבורד..."}
              </p>
            </div>
            <div className="flex gap-3 flex-wrap">
              <Link to="/settings">
                <Button variant="outline" size="sm">⚙️ הגדרות</Button>
              </Link>
              {isPaid && <DeepScanProgress businessId={businessId as string} />}
              {isPaid && (
                <Button variant="outline" size="sm" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
                  <RefreshCw className={`w-4 h-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                  {syncMutation.isPending ? "מסנכרן..." : "סנכרן עכשיו"}
                </Button>
              )}
              {isPaid && (
                <Button variant="coral" size="sm" onClick={() => sendMutation.mutate()} disabled={sendMutation.isPending}>
                  <Send className="w-4 h-4" /> {sendMutation.isPending ? "שולח..." : "שלח לרואה חשבון"}
                </Button>
              )}
              {isPaid && (
                <Button variant="outline" size="sm" onClick={() => pdfMutation.mutate()} disabled={pdfMutation.isPending}>
                  <FileText className="w-4 h-4" /> {pdfMutation.isPending ? "מוריד..." : "PDF חודשי"}
                </Button>
              )}
              {isPaid && (
                <Button variant="outline" size="sm" onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
                  <Download className="w-4 h-4" /> {exportMutation.isPending ? "מייצא..." : "ייצוא CSV"}
                </Button>
              )}
              {isPaid && billing && (
                <Button variant="ghost" size="sm" onClick={() => portalMutation.mutate()} disabled={portalMutation.isPending}>
                  <CreditCard className="w-4 h-4" /> ניהול מנוי
                </Button>
              )}
            </div>
          </div>

          {!isPaid && !summaryQuery.isLoading && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 rounded-xl gradient-coral p-6 text-accent-foreground shadow-card"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Sparkles className="w-6 h-6" />
                  <div>
                    <h3 className="font-display font-bold text-lg">הפעל את SendToAmram</h3>
                    <p className="text-sm opacity-90">
                      סריקה עמוקה של 3 שנות חשבוניות + סנכרון שוטף אוטומטי.
                      <br />
                      $13 (כ-₪40) הקמה חד-פעמית + $7/חודש (כ-₪22).
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="bg-white text-foreground hover:bg-white/90 border-white/30 shrink-0"
                  onClick={() => checkoutMutation.mutate()}
                  disabled={checkoutMutation.isPending}
                >
                  <CreditCard className="w-4 h-4" />
                  {checkoutMutation.isPending ? "מעבר לתשלום..." : "הפעל עכשיו"}
                </Button>
              </div>
            </motion.div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {summaryQuery.isLoading &&
              Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="bg-card rounded-xl p-5 shadow-card border border-border animate-pulse h-[120px]" />
              ))}
            {!summaryQuery.isLoading &&
              stats.map((stat, index) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.06 }}
                  className="bg-card rounded-xl p-5 shadow-card border border-border"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 rounded-lg bg-coral-light flex items-center justify-center">
                      <stat.icon className="w-5 h-5 text-coral" />
                    </div>
                    {stat.trend === "up" ? (
                      <span className="flex items-center text-xs text-success font-medium">
                        <ArrowUpLeft className="w-3 h-3" /> {stat.change}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">{stat.change}</span>
                    )}
                  </div>
                  <p className="font-display font-bold text-2xl text-foreground">{stat.value}</p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </motion.div>
              ))}
          </div>

          <DeepScanExpandedProgress businessId={businessId as string} />

          {(alertsQuery.data?.alerts ?? []).length > 0 && (
            <div className="mb-6 bg-warning/5 border border-warning/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-5 h-5 text-warning" />
                <h3 className="font-display font-semibold text-foreground">חשבוניות חסרות</h3>
              </div>
              <div className="space-y-2">
                {(alertsQuery.data?.alerts ?? []).map((alert) => (
                  <div key={alert.id} className="flex items-center justify-between bg-card rounded-lg px-4 py-2 border border-border">
                    <div>
                      <span className="font-medium text-foreground">{alert.vendorName}</span>
                      <span className="text-muted-foreground text-sm mr-2">
                        · {alert.expectedMonth} · ~{alert.avgAmountCents > 0 ? `₪${(alert.avgAmountCents / 100).toLocaleString("he-IL")}` : ""}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => dismissAlertMutation.mutate(alert.id)}
                      disabled={dismissAlertMutation.isPending}
                    >
                      <X className="w-4 h-4" /> התעלם
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <div className="bg-card rounded-xl shadow-card border border-border">
                <div className="p-4 border-b border-border">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex gap-1">
                      {(["all", "pending", "review"] as const).map((tab) => (
                        <button
                          key={tab}
                          onClick={() => setActiveTab(tab)}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                            activeTab === tab ? "bg-coral text-accent-foreground" : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {tab === "all" ? "הכל" : tab === "pending" ? "ממתינות" : "לבדיקה"}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <div className="relative flex-1 sm:w-48">
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          placeholder="חפש חשבוניות..."
                          className="pr-9 h-9"
                          value={searchTerm}
                          onChange={(event) => setSearchTerm(event.target.value)}
                        />
                      </div>
                      <Button variant="outline" size="sm" disabled><Filter className="w-4 h-4" /></Button>
                    </div>
                  </div>
                </div>

                <div className="divide-y divide-border min-h-[380px]">
                  {documentsQuery.isLoading && (
                    <div className="p-8 text-sm text-muted-foreground text-center">טוען מסמכים...</div>
                  )}
                  {!documentsQuery.isLoading && filteredDocuments.length === 0 && (
                    <div className="p-8 text-center space-y-2">
                      <p className="text-sm text-muted-foreground">לא נמצאו מסמכים לתצוגה.</p>
                      <p className="text-xs text-muted-foreground">חבר/י תיבת דואר ולחץ/י "סנכרן עכשיו" כדי לייבא חשבוניות.</p>
                    </div>
                  )}
                  {!documentsQuery.isLoading &&
                    filteredDocuments.map((doc) => {
                      const status = statusConfig[doc.status];
                      const sourceIcon = doc.source === "whatsapp" ? sourceIcons.whatsapp : sourceIcons[doc.provider] ?? "📄";
                      return (
                        <div key={doc.id} className="flex items-center gap-4 p-4 hover:bg-secondary/30 transition-colors">
                          <span className="text-lg">{sourceIcon}</span>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-foreground truncate">{doc.vendor}</p>
                            <p className="text-xs text-muted-foreground">{formatDate(doc.issuedAt)} · {doc.category}</p>
                          </div>
                          <span className="font-display font-semibold text-foreground">{formatAmount(doc.amountCents)}</span>
                          <span className={`px-2 py-1 rounded-md text-xs font-medium ${status.className}`}>
                            {status.label}
                          </span>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedDocumentId(doc.id)}>
                            <Eye className="w-4 h-4" />
                          </Button>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>

            <div className="lg:col-span-1">
              <div className="bg-card rounded-xl shadow-card border border-border flex flex-col h-[500px]">
                <div className="p-4 border-b border-border flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg gradient-coral flex items-center justify-center">
                    <MessageCircle className="w-4 h-4 text-accent-foreground" />
                  </div>
                  <div>
                    <p className="font-display font-semibold text-sm text-foreground">Amram AI</p>
                    <p className="text-xs text-success">מחובר</p>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {(chatQuery.data?.messages ?? []).map((message) => (
                    <div key={message.id} className={`flex ${message.from === "user" ? "justify-start" : "justify-end"}`}>
                      <div className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm ${
                        message.from === "user"
                          ? "gradient-coral text-accent-foreground rounded-bl-sm"
                          : "bg-secondary text-foreground rounded-br-sm"
                      }`}
                      >
                        {message.text}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="p-3 border-t border-border">
                  <form
                    className="flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!chatInput.trim()) {
                        return;
                      }
                      sendChatMutation.mutate(chatInput.trim());
                    }}
                  >
                    <Input
                      value={chatInput}
                      onChange={(event) => setChatInput(event.target.value)}
                      placeholder="שאל על ההוצאות שלך..."
                      className="h-9"
                    />
                    <Button type="submit" variant="coral" size="sm" className="h-9 px-3" disabled={sendChatMutation.isPending}>
                      <Send className="w-4 h-4" />
                    </Button>
                  </form>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Dialog
        open={Boolean(selectedDocumentId)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedDocumentId(null);
            setIsEditing(false);
            setEditForm({});
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>פרטי מסמך</DialogTitle>
              {detailQuery.data && !isEditing && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setIsEditing(true);
                    setEditForm({
                      vendorName: detailQuery.data!.vendor,
                      amountCents: detailQuery.data!.amountCents,
                      category: detailQuery.data!.category,
                      status: detailQuery.data!.status,
                      comments: detailQuery.data!.comments ?? "",
                    });
                  }}
                >
                  <Pencil className="w-4 h-4" /> עריכה
                </Button>
              )}
            </div>
            <DialogDescription>
              {isEditing ? "ערוך את פרטי המסמך ולחץ שמור." : "מידע מלא על המסמך שנבחר."}
            </DialogDescription>
          </DialogHeader>
          {detailQuery.isLoading && <p className="text-sm text-muted-foreground">טוען פרטים...</p>}
          {detailQuery.data && !isEditing && (
            <div className="space-y-2 text-sm">
              <p><span className="font-medium">ספק:</span> {detailQuery.data.vendor}</p>
              <p><span className="font-medium">סכום:</span> {formatAmount(detailQuery.data.amountCents)}</p>
              <p><span className="font-medium">מע״מ:</span> {detailQuery.data.vatCents ? formatAmount(detailQuery.data.vatCents) : "לא זוהה"}</p>
              <p><span className="font-medium">תאריך:</span> {formatDate(detailQuery.data.issuedAt)}</p>
              <p><span className="font-medium">סטטוס:</span> {statusConfig[detailQuery.data.status]?.label ?? detailQuery.data.status}</p>
              <p><span className="font-medium">מקור:</span> {detailQuery.data.source}</p>
              <p><span className="font-medium">סוג:</span> {detailQuery.data.type}</p>
              <p><span className="font-medium">קטגוריה:</span> {detailQuery.data.category}</p>
              <p><span className="font-medium">ביטחון OCR:</span> {((detailQuery.data.confidence ?? 0) * 100).toFixed(1)}%</p>
              {detailQuery.data.comments && (
                <p><span className="font-medium">הערות:</span> {detailQuery.data.comments}</p>
              )}
              {detailQuery.data.rawText && (
                <div>
                  <p className="font-medium">טקסט גולמי:</p>
                  <p className="text-muted-foreground whitespace-pre-wrap max-h-32 overflow-y-auto text-xs">{detailQuery.data.rawText}</p>
                </div>
              )}
            </div>
          )}
          {detailQuery.data && isEditing && (
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">ספק</label>
                <Input
                  value={editForm.vendorName ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, vendorName: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm font-medium">סכום (₪)</label>
                <Input
                  type="number"
                  step="0.01"
                  value={editForm.amountCents ? (editForm.amountCents / 100).toFixed(2) : ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, amountCents: Math.round(parseFloat(e.target.value || "0") * 100) }))}
                />
              </div>
              <div>
                <label className="text-sm font-medium">קטגוריה</label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                  value={editForm.category === "__custom__" ? "__custom__" : editForm.category ?? ""}
                  onChange={(e) => {
                    if (e.target.value === "__custom__") {
                      setEditForm((f) => ({ ...f, category: "__custom__" }));
                    } else {
                      setCustomCategory("");
                      setEditForm((f) => ({ ...f, category: e.target.value }));
                    }
                  }}
                >
                  {(categoriesQuery.data?.categories ?? ['כללי', 'תוכנה', 'חשבונות', 'משרד', 'ציוד', 'נסיעות', 'שיווק', 'מקצועי']).map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                  <option value="__custom__">+ קטגוריה מותאמת אישית</option>
                </select>
                {editForm.category === "__custom__" && (
                  <Input
                    className="mt-2"
                    placeholder="הזן שם קטגוריה..."
                    value={customCategory}
                    onChange={(e) => {
                      setCustomCategory(e.target.value);
                      setEditForm((f) => ({ ...f, category: e.target.value || "__custom__" }));
                    }}
                  />
                )}
              </div>
              <div>
                <label className="text-sm font-medium">סטטוס</label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                  value={editForm.status ?? "pending"}
                  onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value as "sent" | "pending" | "review" }))}
                >
                  <option value="pending">ממתין</option>
                  <option value="review">לבדיקה</option>
                  <option value="sent">נשלח</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">הערות</label>
                <textarea
                  className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={editForm.comments ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, comments: e.target.value || null }))}
                  placeholder="הוסף הערה..."
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  variant="coral"
                  size="sm"
                  onClick={() => updateMutation.mutate(editForm)}
                  disabled={updateMutation.isPending}
                >
                  <Save className="w-4 h-4" /> {updateMutation.isPending ? "שומר..." : "שמור"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsEditing(false);
                    setEditForm({});
                  }}
                >
                  <X className="w-4 h-4" /> ביטול
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DashboardPage;
