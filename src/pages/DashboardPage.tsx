import { useCallback, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
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
  ChevronDown,
  CalendarDays,
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
  getOAuthStartUrl,
  getWhatsAppSession,
} from "@/lib/api";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { he } from "date-fns/locale";
import { getActiveBusinessId } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import DeepScanProgress, { DeepScanExpandedProgress, useDeepScan } from "@/components/DeepScanProgress";

import { statusConfig, sourceIcons, formatAmount, formatDate } from "@/lib/invoice-utils";

const DashboardPage = () => {
  const businessId = getActiveBusinessId();
  const [chatInput, setChatInput] = useState("");
  const [activeTab, setActiveTab] = useState<DocumentFilter>("all");
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<DocumentUpdate>({});
  const [customCategory, setCustomCategory] = useState("");
  const [showMoreActions, setShowMoreActions] = useState(false);
  const [dateRangeMode, setDateRangeMode] = useState<"pdf" | "send" | null>(null);
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const summaryQuery = useQuery({
    queryKey: ["dashboard", "summary", businessId],
    queryFn: () => getDashboardSummary(businessId as string),
    enabled: Boolean(businessId),
  });

  const documentsQuery = useQuery({
    queryKey: ["dashboard", "documents", businessId, activeTab, page],
    queryFn: () => getDashboardDocuments(businessId as string, activeTab, page),
    enabled: Boolean(businessId),
    placeholderData: (prev) => prev,
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

  const dateFromStr = dateFrom ? format(dateFrom, "yyyy-MM-dd") : undefined;
  const dateToStr = dateTo ? format(dateTo, "yyyy-MM-dd") : undefined;

  const dateRangeCountQuery = useQuery({
    queryKey: ["dashboard", "date-range-count", businessId, dateFromStr, dateToStr, dateRangeMode],
    queryFn: () => getDashboardDocuments(
      businessId as string,
      dateRangeMode === "send" ? "pending" : "all",
      1, 1,
      dateFromStr, dateToStr,
    ),
    enabled: Boolean(businessId && dateFrom && dateTo && dateRangeMode),
    staleTime: 10_000,
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
    mutationFn: async (opts?: { fromDate?: string; toDate?: string }) =>
      sendToAccountant(businessId as string, opts?.fromDate, opts?.toDate),
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
      setDateRangeMode(null);
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
    mutationFn: async (opts?: { fromDate?: string; toDate?: string }) => downloadMonthlyPdf(businessId as string, opts),
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
      setDateRangeMode(null);
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

  const deepScan = useDeepScan(businessId as string);
  const navigate = useNavigate();

  const whatsAppQuery = useQuery({
    queryKey: ["whatsapp", "session", businessId],
    queryFn: () => getWhatsAppSession(businessId as string),
    enabled: Boolean(businessId),
    staleTime: 60_000,
  });

  const connectGmailMutation = useMutation({
    mutationFn: async () => getOAuthStartUrl(businessId as string, "gmail"),
    onSuccess: (data) => {
      window.location.href = data.authUrl;
    },
    onError: (error) => {
      toast({
        title: "שגיאה בחיבור Gmail",
        description: error instanceof Error ? error.message : "אירעה שגיאה",
        variant: "destructive",
      });
    },
  });

  // Billing state from summary
  const summary = summaryQuery.data;
  const billing = summary?.billing;
  const isPaid = !billing || (billing.onboardingPaid && billing.subscriptionStatus === "active");

  // Fresh user detection
  const hasInbox = (summary?.totals?.connectedInboxes ?? 0) > 0;
  const hasDocuments = (summary?.month?.documents ?? 0) > 0 || (summary?.totals?.sent ?? 0) > 0;
  const scanData = deepScan.statusQuery.data;
  const hasScanEver = Boolean(scanData?.scanJobId);
  const scanActive = Boolean(scanData?.active);
  const hasWhatsApp = whatsAppQuery.data?.status === "connected";
  const isFreshUser = isPaid && summary && !hasDocuments && !scanActive && !hasScanEver;
  // Show setup hero when any of the 3 key steps is incomplete
  const needsSetup = isPaid && summary && (!hasInbox || (!hasScanEver && !scanActive) || !hasWhatsApp);
  const currentSetupStep = !hasInbox ? "gmail" : (!hasScanEver && !scanActive) ? "scan" : "whatsapp";

  const handleDateRangeConfirm = useCallback(() => {
    if (!dateFrom || !dateTo) return;
    const from = format(dateFrom, "yyyy-MM-dd");
    const to = format(dateTo, "yyyy-MM-dd");
    if (dateRangeMode === "pdf") {
      pdfMutation.mutate({ fromDate: from, toDate: to });
    } else if (dateRangeMode === "send") {
      sendMutation.mutate({ fromDate: from, toDate: to });
    }
  }, [dateFrom, dateTo, dateRangeMode, pdfMutation, sendMutation]);

  const openDateRangeDialog = useCallback((mode: "pdf" | "send") => {
    setDateFrom(undefined);
    setDateTo(undefined);
    setDateRangeMode(mode);
  }, []);

  const filteredDocuments = useMemo(() => {
    const docs = documentsQuery.data?.documents ?? [];
    // Filter out ignored documents by default
    const nonIgnored = docs.filter((doc) => doc.status !== "ignored");
    const term = searchTerm.trim().toLowerCase();
    if (!term) {
      return nonIgnored;
    }
    return nonIgnored.filter((doc) => doc.vendor.toLowerCase().includes(term) || doc.category.toLowerCase().includes(term));
  }, [documentsQuery.data?.documents, searchTerm]);

  if (!businessId) {
    return <Navigate to="/onboarding" replace />;
  }

  // If billing loaded and user hasn't paid, redirect to onboarding to see offer
  if (!summaryQuery.isLoading && billing && !billing.onboardingPaid && billing.subscriptionStatus !== "active") {
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
          totalRef: `סה״כ ${summary.totals.documents.toLocaleString("he-IL")}`,
        },
        {
          label: "סכום החודש",
          value: formatAmount(summary.month.amountCents),
          change: `${summary.month.amountDeltaPercent >= 0 ? "+" : ""}${summary.month.amountDeltaPercent}%`,
          icon: TrendingUp,
          trend: "up",
          totalRef: `סה״כ ${formatAmount(summary.totals.amountCents)}`,
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
              <h1 className="font-display text-2xl md:text-3xl font-bold text-foreground">
                {(() => {
                  const h = new Date().getHours();
                  if (h >= 5 && h < 12) return "בוקר טוב! ☀️";
                  if (h >= 12 && h < 17) return "צהריים טובים! 🌤️";
                  if (h >= 17 && h < 21) return "ערב טוב! 🌅";
                  return "לילה טוב! 🌙";
                })()}
              </h1>
              <p className="text-muted-foreground">
                {summary
                  ? isFreshUser
                    ? "בוא נתחיל לסרוק את החשבוניות שלך."
                    : `${summary.business.accountantName} קיבל/ה ${summary.totals.sent} מסמכים. אתה על אוטופיילוט.`
                  : "טוען נתוני דשבורד..."}
              </p>
            </div>
            {/* Show compact toolbar only when user has documents or active scan */}
            {isPaid && !isFreshUser && (
              <div className="flex gap-2 flex-wrap items-center">
                <DeepScanProgress businessId={businessId as string} />
                <Button variant="outline" size="sm" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
                  <RefreshCw className={`w-4 h-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                  {syncMutation.isPending ? "מסנכרן..." : "סנכרן עכשיו"}
                </Button>
                <Button variant="coral" size="sm" onClick={() => openDateRangeDialog("send")} disabled={sendMutation.isPending}>
                  <Send className="w-4 h-4" /> {sendMutation.isPending ? "שולח..." : "שלח לרואה חשבון"}
                </Button>
                <div className="relative">
                  <Button variant="outline" size="sm" onClick={() => setShowMoreActions(!showMoreActions)}>
                    <ChevronDown className="w-4 h-4" /> עוד
                  </Button>
                  {showMoreActions && (
                    <div className="absolute left-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg z-10 min-w-[160px] py-1">
                      <button className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-secondary/50 transition-colors" onClick={() => { openDateRangeDialog("pdf"); setShowMoreActions(false); }}>
                        <FileText className="w-4 h-4" /> PDF חודשי
                      </button>
                      <button className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-secondary/50 transition-colors" onClick={() => { exportMutation.mutate(); setShowMoreActions(false); }}>
                        <Download className="w-4 h-4" /> ייצוא CSV
                      </button>
                      <Link to="/settings" className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-secondary/50 transition-colors" onClick={() => setShowMoreActions(false)}>
                        ⚙️ הגדרות
                      </Link>
                      {billing && (
                        <button className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-secondary/50 transition-colors" onClick={() => { portalMutation.mutate(); setShowMoreActions(false); }}>
                          <CreditCard className="w-4 h-4" /> ניהול מנוי
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Getting Started Hero - for fresh paid users needing setup */}
          {needsSetup && isFreshUser && !summaryQuery.isLoading && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-8"
            >
              <div className="rounded-xl bg-gradient-to-l from-coral/90 to-coral p-8 text-white shadow-card">
                <div className="max-w-xl mx-auto text-center space-y-6">
                  <h2 className="font-display text-2xl font-bold text-white">
                    {currentSetupStep === "gmail"
                      ? "חבר את תיבת הדואר שלך"
                      : currentSetupStep === "scan"
                        ? "התחל סריקה עמוקה"
                        : "חבר וואטסאפ"}
                  </h2>
                  <p className="text-white/90">
                    {currentSetupStep === "gmail"
                      ? "חבר את Gmail שלך כדי שנוכל לסרוק חשבוניות מ-3 השנים האחרונות ולשלוח אותן אוטומטית לרואה החשבון."
                      : currentSetupStep === "scan"
                        ? "התיבה מחוברת! לחץ כדי לסרוק את כל החשבוניות מ-3 השנים האחרונות. הסריקה פועלת ברקע."
                        : "חבר את הוואטסאפ שלך כדי לקבל חשבוניות בצילום מהיר ישירות מהנייד."}
                  </p>
                  {currentSetupStep === "gmail" ? (
                    <button
                      className="inline-flex items-center justify-center gap-3 rounded-xl px-8 py-4 text-lg font-bold bg-white text-gray-900 hover:bg-gray-100 hover:shadow-lg transition-all disabled:opacity-50 cursor-pointer"
                      onClick={() => connectGmailMutation.mutate()}
                      disabled={connectGmailMutation.isPending}
                    >
                      <Mail className="w-5 h-5" />
                      {connectGmailMutation.isPending ? "מתחבר..." : "חבר Gmail"}
                      <ArrowRight className="w-5 h-5" />
                    </button>
                  ) : currentSetupStep === "scan" ? (
                    <button
                      className="inline-flex items-center justify-center gap-3 rounded-xl px-8 py-4 text-lg font-bold bg-white text-gray-900 hover:bg-gray-100 hover:shadow-lg transition-all disabled:opacity-50 cursor-pointer"
                      onClick={() => deepScan.startMutation.mutate()}
                      disabled={deepScan.startMutation.isPending}
                    >
                      <Search className="w-5 h-5" />
                      {deepScan.startMutation.isPending ? "מתחיל סריקה..." : "התחל סריקה עמוקה"}
                      <ArrowRight className="w-5 h-5" />
                    </button>
                  ) : (
                    <button
                      className="inline-flex items-center justify-center gap-3 rounded-xl px-8 py-4 text-lg font-bold bg-white text-gray-900 hover:bg-gray-100 hover:shadow-lg transition-all cursor-pointer"
                      onClick={() => navigate("/settings?tab=integrations")}
                    >
                      <MessageCircle className="w-5 h-5" />
                      חבר וואטסאפ
                      <ArrowRight className="w-5 h-5" />
                    </button>
                  )}
                  <div className="flex justify-center gap-6 text-sm text-white/70">
                    <span className={`flex items-center gap-1.5 ${hasInbox ? "text-white" : ""}`}>
                      {hasInbox ? <Check className="w-4 h-4" /> : <span className="w-4 h-4 rounded-full border-2 border-white/40 inline-block" />}
                      חיבור Gmail
                    </span>
                    <span className={`flex items-center gap-1.5 ${hasScanEver || scanActive ? "text-white" : ""}`}>
                      {hasScanEver || scanActive ? <Check className="w-4 h-4" /> : <span className="w-4 h-4 rounded-full border-2 border-white/40 inline-block" />}
                      סריקה עמוקה
                    </span>
                    <span className={`flex items-center gap-1.5 ${hasWhatsApp ? "text-white" : ""}`}>
                      {hasWhatsApp ? <Check className="w-4 h-4" /> : <span className="w-4 h-4 rounded-full border-2 border-white/40 inline-block" />}
                      חיבור וואטסאפ
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex justify-center mt-3">
                <Link to="/settings" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  ⚙️ הגדרות
                </Link>
              </div>
            </motion.div>
          )}

          {/* WhatsApp setup banner - for returning users who haven't connected WhatsApp */}
          {isPaid && !isFreshUser && !hasWhatsApp && !summaryQuery.isLoading && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6"
            >
              <div className="rounded-xl bg-gradient-to-l from-green-600 to-green-500 p-5 text-white shadow-card">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <MessageCircle className="w-6 h-6 text-white" />
                    <div>
                      <h3 className="font-display font-bold text-lg text-white">חבר וואטסאפ</h3>
                      <p className="text-sm text-white/90">
                        קבל חשבוניות בצילום מהיר ישירות מהנייד. צלם ושלח - המערכת תזהה הכל אוטומטית.
                      </p>
                    </div>
                  </div>
                  <button
                    className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold shrink-0 bg-white text-gray-900 border border-white hover:bg-gray-200 hover:shadow-md transition-all cursor-pointer"
                    onClick={() => navigate("/settings?tab=integrations")}
                  >
                    <MessageCircle className="w-4 h-4" />
                    חבר עכשיו
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {!isPaid && !summaryQuery.isLoading && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 rounded-xl bg-gradient-to-l from-orange-600 to-red-500 p-6 text-white shadow-card"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Sparkles className="w-6 h-6 text-white" />
                  <div>
                    <h3 className="font-display font-bold text-lg text-white">הפעל את SendToAmram</h3>
                    <p className="text-sm text-white/90">
                      סריקה עמוקה של 3 שנות חשבוניות + סנכרון שוטף אוטומטי.
                      <br />
                      $13 (כ-₪40) הקמה חד-פעמית + $7/חודש (כ-₪22).
                    </p>
                  </div>
                </div>
                <button
                  className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold shrink-0 bg-white text-gray-900 border border-white hover:bg-gray-200 hover:shadow-md transition-all disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
                  onClick={() => checkoutMutation.mutate()}
                  disabled={checkoutMutation.isPending}
                >
                  <CreditCard className="w-4 h-4" />
                  {checkoutMutation.isPending ? "מעבר לתשלום..." : "הפעל עכשיו"}
                </button>
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
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                    {"totalRef" in stat && stat.totalRef && (
                      <p className="text-xs text-muted-foreground/60">{stat.totalRef}</p>
                    )}
                  </div>
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
                          onClick={() => { setActiveTab(tab); setPage(1); }}
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
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (confirm("התעלם ממסמך זה? הוא יסומן כ'לא רלוונטי' ולא יישלח לרואה החשבון.")) {
                                try {
                                  await updateDocument(businessId as string, doc.id, { status: "ignored" });
                                  queryClient.invalidateQueries({ queryKey: ["dashboard"] });
                                  toast({ title: "המסמך סומן כמתעלם" });
                                } catch (error) {
                                  toast({
                                    title: "שגיאה",
                                    description: "לא הצלחנו לעדכן את המסמך",
                                    variant: "destructive",
                                  });
                                }
                              }
                            }}
                            title="התעלם ממסמך זה"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedDocumentId(doc.id)}>
                            <Eye className="w-4 h-4" />
                          </Button>
                        </div>
                      );
                    })}
                </div>

                {/* Pagination */}
                {documentsQuery.data && documentsQuery.data.totalPages > 1 && (
                  <div className="flex items-center justify-between p-3 border-t border-border">
                    <span className="text-xs text-muted-foreground">
                      {documentsQuery.data.total.toLocaleString("he-IL")} מסמכים - עמוד {page} מתוך {documentsQuery.data.totalPages}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                      {Array.from({ length: Math.min(5, documentsQuery.data.totalPages) }, (_, i) => {
                        const totalPages = documentsQuery.data!.totalPages;
                        let pageNum: number;
                        if (totalPages <= 5) {
                          pageNum = i + 1;
                        } else if (page <= 3) {
                          pageNum = i + 1;
                        } else if (page >= totalPages - 2) {
                          pageNum = totalPages - 4 + i;
                        } else {
                          pageNum = page - 2 + i;
                        }
                        return (
                          <Button
                            key={pageNum}
                            variant={pageNum === page ? "default" : "ghost"}
                            size="icon"
                            className={`h-7 w-7 text-xs ${pageNum === page ? "bg-coral text-accent-foreground" : ""}`}
                            onClick={() => setPage(pageNum)}
                          >
                            {pageNum}
                          </Button>
                        );
                      })}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={page >= (documentsQuery.data?.totalPages ?? 1)}
                        onClick={() => setPage((p) => Math.min(documentsQuery.data?.totalPages ?? 1, p + 1))}
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
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
            <div className="space-y-4 text-sm">
              {/* Vendor + Amount header */}
              <div className="flex items-center justify-between pb-3 border-b border-border">
                <span className="font-display font-semibold text-lg text-foreground">{detailQuery.data.vendor}</span>
                <span className="font-display font-bold text-xl text-foreground">{formatAmount(detailQuery.data.amountCents)}</span>
              </div>

              {/* Details grid */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
                <div>
                  <span className="text-xs text-muted-foreground">תאריך</span>
                  <p className="font-medium text-foreground">{formatDate(detailQuery.data.issuedAt)}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">מע״מ</span>
                  <p className="font-medium text-foreground">{detailQuery.data.vatCents ? formatAmount(detailQuery.data.vatCents) : "לא זוהה"}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">סטטוס</span>
                  <p className="font-medium text-foreground">{statusConfig[detailQuery.data.status]?.label ?? detailQuery.data.status}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">קטגוריה</span>
                  <p className="font-medium text-foreground">{detailQuery.data.category}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">מקור</span>
                  <p className="font-medium text-foreground">{detailQuery.data.source}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">סוג</span>
                  <p className="font-medium text-foreground">{detailQuery.data.type}</p>
                </div>
              </div>

              {/* OCR confidence bar */}
              <div className="pt-2 border-t border-border">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground">ביטחון OCR</span>
                  <span className="text-xs font-medium text-foreground">{((detailQuery.data.confidence ?? 0) * 100).toFixed(0)}%</span>
                </div>
                <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${(detailQuery.data.confidence ?? 0) >= 0.8 ? "bg-success" : (detailQuery.data.confidence ?? 0) >= 0.5 ? "bg-warning" : "bg-destructive"}`}
                    style={{ width: `${((detailQuery.data.confidence ?? 0) * 100).toFixed(0)}%` }}
                  />
                </div>
              </div>

              {/* Comments */}
              {detailQuery.data.comments && (
                <div className="pt-2 border-t border-border">
                  <span className="text-xs text-muted-foreground">הערות</span>
                  <p className="text-foreground mt-0.5">{detailQuery.data.comments}</p>
                </div>
              )}

              {/* Raw text collapsible */}
              {detailQuery.data.rawText && (
                <div className="pt-2 border-t border-border">
                  <span className="text-xs text-muted-foreground">טקסט גולמי</span>
                  <div className="mt-1 bg-secondary/50 rounded-lg p-3 max-h-32 overflow-y-auto">
                    <p className="text-muted-foreground whitespace-pre-wrap text-xs leading-relaxed">{detailQuery.data.rawText}</p>
                  </div>
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

      {/* Date Range Dialog for PDF / Send to Accountant */}
      <Dialog open={dateRangeMode !== null} onOpenChange={(open) => { if (!open) setDateRangeMode(null); }}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarDays className="w-5 h-5" />
              {dateRangeMode === "pdf" ? "הורד PDF לטווח תאריכים" : "שלח מסמכים לרואה חשבון"}
            </DialogTitle>
            <DialogDescription>
              {dateRangeMode === "pdf"
                ? "בחר טווח תאריכים ליצירת דוח PDF"
                : "בחר טווח תאריכים לשליחת מסמכים ממתינים לרואה חשבון"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* From Date */}
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium w-16 shrink-0">מתאריך:</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="flex-1 justify-start text-right font-normal">
                    <CalendarDays className="w-4 h-4 ml-2" />
                    {dateFrom ? format(dateFrom, "dd/MM/yyyy") : "בחר תאריך"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateFrom}
                    onSelect={setDateFrom}
                    locale={he}
                    disabled={(date) => dateTo ? date > dateTo : false}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* To Date */}
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium w-16 shrink-0">עד תאריך:</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="flex-1 justify-start text-right font-normal">
                    <CalendarDays className="w-4 h-4 ml-2" />
                    {dateTo ? format(dateTo, "dd/MM/yyyy") : "בחר תאריך"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateTo}
                    onSelect={setDateTo}
                    locale={he}
                    disabled={(date) => dateFrom ? date < dateFrom : false}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Document count preview */}
            {dateFrom && dateTo && (
              <div className="bg-secondary/50 rounded-lg p-3 text-center">
                {dateRangeCountQuery.isLoading ? (
                  <span className="text-sm text-muted-foreground">בודק כמות מסמכים...</span>
                ) : dateRangeCountQuery.data ? (
                  <span className="text-sm font-medium">
                    {dateRangeCountQuery.data.total === 0
                      ? dateRangeMode === "send" ? "אין מסמכים ממתינים בטווח הנבחר" : "אין מסמכים בטווח הנבחר"
                      : `${dateRangeCountQuery.data.total} מסמכים ${dateRangeMode === "send" ? "ממתינים " : ""}בטווח הנבחר`}
                  </span>
                ) : null}
              </div>
            )}
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={() => setDateRangeMode(null)}>
              ביטול
            </Button>
            <Button
              variant="coral"
              disabled={!dateFrom || !dateTo || (dateRangeCountQuery.data?.total === 0) || pdfMutation.isPending || sendMutation.isPending}
              onClick={handleDateRangeConfirm}
            >
              {dateRangeMode === "pdf"
                ? (pdfMutation.isPending ? "מכין PDF..." : "הורד PDF")
                : (sendMutation.isPending ? "שולח..." : "שלח לרואה חשבון")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DashboardPage;
