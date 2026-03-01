import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessageCircle,
  Pencil,
  Save,
  Search,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { format, startOfMonth, subMonths, startOfYear, subYears, endOfYear } from "date-fns";
import { he } from "date-fns/locale";

import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

import {
  type DocumentFilter,
  type DocumentUpdate,
  getDashboardAnalytics,
  getDashboardDocuments,
  getDashboardCategories,
  getDashboardDocumentDetail,
  updateDocument,
  runCategoryBackfill,
  getInvoiceChat,
  postInvoiceChat,
} from "@/lib/api";
import { getActiveBusinessId } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import {
  statusConfig,
  sourceIcons,
  formatAmount,
  formatAmountShort,
  formatDate,
  getCategoryColor,
} from "@/lib/invoice-utils";
import { cn } from "@/lib/utils";

// ─── Helpers ───

function formatMonthLabel(monthKey: string): string {
  try {
    const [y, m] = monthKey.split("-");
    const date = new Date(Number(y), Number(m) - 1, 1);
    return format(date, "MMM yy", { locale: he });
  } catch {
    return monthKey;
  }
}

function formatK(cents: number): string {
  const shekel = cents / 100;
  if (shekel >= 1000) return `${(shekel / 1000).toFixed(0)}K`;
  return shekel.toFixed(0);
}

// ─── Page ───

const InvoicesPage = () => {
  const businessId = getActiveBusinessId();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Filters
  const [activeCategories, setActiveCategories] = useState<string[]>([]);
  const [activeStatus, setActiveStatus] = useState<DocumentFilter>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [activePreset, setActivePreset] = useState<string | null>(null);

  // Detail sheet
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<DocumentUpdate>({});

  // Chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  const dateFromStr = dateFrom ? format(dateFrom, "yyyy-MM-dd") : undefined;
  const dateToStr = dateTo ? format(dateTo, "yyyy-MM-dd") : undefined;

  // ─── Queries ───

  const analyticsQuery = useQuery({
    queryKey: ["invoices", "analytics", businessId, dateFromStr, dateToStr],
    queryFn: () => getDashboardAnalytics(businessId!, dateFromStr, dateToStr),
    enabled: Boolean(businessId),
  });

  const documentsQuery = useQuery({
    queryKey: ["invoices", "documents", businessId, activeStatus, page, dateFromStr, dateToStr],
    queryFn: () => getDashboardDocuments(businessId!, activeStatus, page, 24, dateFromStr, dateToStr),
    enabled: Boolean(businessId),
    placeholderData: (prev) => prev,
  });

  const categoriesQuery = useQuery({
    queryKey: ["dashboard", "categories", businessId],
    queryFn: () => getDashboardCategories(businessId!),
    enabled: Boolean(businessId),
  });

  const detailQuery = useQuery({
    queryKey: ["dashboard", "document-detail", businessId, selectedDocId],
    queryFn: () => getDashboardDocumentDetail(businessId!, selectedDocId!),
    enabled: Boolean(businessId && selectedDocId),
  });

  const updateMutation = useMutation({
    mutationFn: async (updates: DocumentUpdate) =>
      updateDocument(businessId!, selectedDocId!, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
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

  const backfillMutation = useMutation({
    mutationFn: async () => runCategoryBackfill(businessId!),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      if (data.categorized > 0) {
        toast({ title: `סווגו ${data.categorized} מסמכים (${data.vendors} ספקים)` });
      } else {
        toast({ title: data.message ?? "לא נמצאו מסמכים לסיווג" });
      }
    },
    onError: (error) => {
      toast({
        title: "סיווג נכשל",
        description: error instanceof Error ? error.message : "אירעה שגיאה.",
        variant: "destructive",
      });
    },
  });

  // ─── Chat queries ───

  const chatQuery = useQuery({
    queryKey: ["invoices", "chat", businessId],
    queryFn: () => getInvoiceChat(businessId!),
    enabled: Boolean(businessId && chatOpen),
  });

  const sendChatMutation = useMutation({
    mutationFn: async (text: string) => postInvoiceChat(businessId!, text),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices", "chat", businessId] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      setChatInput("");
    },
    onError: (error) => {
      toast({
        title: "שליחת הודעה נכשלה",
        description: error instanceof Error ? error.message : "אירעה שגיאה.",
        variant: "destructive",
      });
    },
  });

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatOpen) chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatQuery.data?.messages?.length, chatOpen]);

  // ─── Derived State ───

  const toggleCategory = useCallback((cat: string) => {
    setActiveCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
    setPage(1);
  }, []);

  const filteredDocuments = useMemo(() => {
    let docs = documentsQuery.data?.documents ?? [];
    docs = docs.filter((d) => d.status !== "ignored");

    if (activeCategories.length > 0) {
      docs = docs.filter((d) => activeCategories.includes(d.category));
    }

    const term = searchTerm.trim().toLowerCase();
    if (term) {
      docs = docs.filter(
        (d) =>
          d.vendor.toLowerCase().includes(term) ||
          d.category.toLowerCase().includes(term),
      );
    }

    return docs;
  }, [documentsQuery.data?.documents, activeCategories, searchTerm]);

  const totalDocs = documentsQuery.data?.total ?? 0;
  const totalPages = documentsQuery.data?.totalPages ?? 1;
  const analytics = analyticsQuery.data;
  const grandTotal = analytics?.byCategory.reduce((s, c) => s + c.totalCents, 0) ?? 0;
  const totalCount = analytics?.byCategory.reduce((s, c) => s + c.count, 0) ?? 0;

  if (!businessId) {
    return <Navigate to="/onboarding" replace />;
  }

  // ─── Chart Data ───

  const pieData = (analytics?.byCategory ?? []).map((c) => ({
    name: c.category,
    value: c.totalCents,
    count: c.count,
    fill: getCategoryColor(c.category),
  }));

  const barData = (analytics?.byMonth ?? []).map((m) => ({
    month: formatMonthLabel(m.monthKey),
    amount: m.totalCents / 100,
    count: m.count,
  }));

  // ─── Pagination helpers ───

  const pageNumbers = useMemo(() => {
    const pages: number[] = [];
    const start = Math.max(1, page - 2);
    const end = Math.min(totalPages, start + 4);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }, [page, totalPages]);

  // ─── Detail sheet data ───

  const detail = detailQuery.data;
  const allCategories = categoriesQuery.data?.categories ?? [];

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <Navbar />
      <div className="pt-20 pb-8">
        <div className="container mx-auto px-4">

          {/* ─── Header ─── */}
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-6 gap-4">
            <div>
              <h1 className="font-display text-2xl md:text-3xl font-bold text-foreground">
                חשבוניות
              </h1>
              {analytics && (
                <p className="text-muted-foreground mt-1">
                  {totalCount.toLocaleString("he-IL")} חשבוניות{" "}
                  <span className="mx-1">|</span>{" "}
                  סה״כ {formatAmountShort(grandTotal)}
                </p>
              )}
            </div>

            {/* Actions + Date range */}
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => backfillMutation.mutate()}
                disabled={backfillMutation.isPending}
              >
                {backfillMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {backfillMutation.isPending ? "מסווג..." : "סווג אוטומטית"}
              </Button>
              <span className="text-border">|</span>

              {/* Quick presets */}
              <Button
                variant={activePreset === "last-month" ? "secondary" : "ghost"}
                size="sm"
                className={activePreset === "last-month" ? "bg-coral/15 text-coral hover:bg-coral/20" : ""}
                onClick={() => {
                  const now = new Date();
                  setDateFrom(startOfMonth(subMonths(now, 1)));
                  setDateTo(startOfMonth(now));
                  setActivePreset("last-month");
                  setPage(1);
                }}
              >חודש שעבר</Button>
              <Button
                variant={activePreset === "this-year" ? "secondary" : "ghost"}
                size="sm"
                className={activePreset === "this-year" ? "bg-coral/15 text-coral hover:bg-coral/20" : ""}
                onClick={() => {
                  setDateFrom(startOfYear(new Date()));
                  setDateTo(new Date());
                  setActivePreset("this-year");
                  setPage(1);
                }}
              >השנה</Button>
              <Button
                variant={activePreset === "last-year" ? "secondary" : "ghost"}
                size="sm"
                className={activePreset === "last-year" ? "bg-coral/15 text-coral hover:bg-coral/20" : ""}
                onClick={() => {
                  const lastYear = subYears(new Date(), 1);
                  setDateFrom(startOfYear(lastYear));
                  setDateTo(endOfYear(lastYear));
                  setActivePreset("last-year");
                  setPage(1);
                }}
              >שנה שעברה</Button>

              <span className="text-border">|</span>

              {/* Custom date pickers */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <CalendarDays className="w-4 h-4" />
                    {dateFrom ? format(dateFrom, "dd/MM/yy") : "מתאריך"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateFrom}
                    onSelect={(d) => { setDateFrom(d); setActivePreset(null); setPage(1); }}
                    locale={he}
                    disabled={(date) => (dateTo ? date > dateTo : false)}
                  />
                </PopoverContent>
              </Popover>
              <span className="text-muted-foreground text-sm">-</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <CalendarDays className="w-4 h-4" />
                    {dateTo ? format(dateTo, "dd/MM/yy") : "עד תאריך"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateTo}
                    onSelect={(d) => { setDateTo(d); setActivePreset(null); setPage(1); }}
                    locale={he}
                    disabled={(date) => (dateFrom ? date < dateFrom : false)}
                  />
                </PopoverContent>
              </Popover>
              {(dateFrom || dateTo) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setDateFrom(undefined); setDateTo(undefined); setActivePreset(null); setPage(1); }}
                >
                  <X className="w-4 h-4" /> נקה
                </Button>
              )}
            </div>
          </div>

          {/* ─── Charts Row ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Pie chart */}
            <Card>
              <CardContent className="p-6">
                <h3 className="font-display font-semibold text-foreground mb-4">התפלגות הוצאות</h3>
                {analyticsQuery.isLoading ? (
                  <Skeleton className="h-[250px] w-full rounded-xl" />
                ) : pieData.length === 0 ? (
                  <div className="h-[250px] flex items-center justify-center text-muted-foreground">אין נתונים</div>
                ) : (
                  <div className="relative h-[250px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          paddingAngle={2}
                          dataKey="value"
                          stroke="none"
                        >
                          {pieData.map((entry, i) => (
                            <Cell
                              key={i}
                              fill={entry.fill}
                              className="cursor-pointer hover:opacity-80 transition-opacity"
                              onClick={() => toggleCategory(entry.name)}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.[0]) return null;
                            const d = payload[0].payload;
                            return (
                              <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-sm" dir="rtl">
                                <p className="font-medium">{d.name}</p>
                                <p>{formatAmountShort(d.value)} ({d.count} חשבוניות)</p>
                              </div>
                            );
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    {/* Center total */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-xs text-muted-foreground">סה״כ</span>
                      <span className="font-display font-bold text-lg">{formatAmountShort(grandTotal)}</span>
                    </div>
                  </div>
                )}
                {/* Legend */}
                {pieData.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-4 justify-center">
                    {pieData.slice(0, 8).map((d) => (
                      <button
                        key={d.name}
                        onClick={() => toggleCategory(d.name)}
                        className={cn(
                          "flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-all",
                          activeCategories.includes(d.name)
                            ? "ring-2 ring-offset-1 ring-coral/50"
                            : "hover:bg-secondary/50",
                        )}
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: d.fill }}
                        />
                        {d.name}
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Bar chart */}
            <Card>
              <CardContent className="p-6">
                <h3 className="font-display font-semibold text-foreground mb-4">הוצאות חודשיות</h3>
                {analyticsQuery.isLoading ? (
                  <Skeleton className="h-[250px] w-full rounded-xl" />
                ) : barData.length === 0 ? (
                  <div className="h-[250px] flex items-center justify-center text-muted-foreground">אין נתונים</div>
                ) : (
                  <div className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={barData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                        <XAxis
                          dataKey="month"
                          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(v) => formatK(v * 100)}
                          width={45}
                        />
                        <Tooltip
                          content={({ active, payload, label }) => {
                            if (!active || !payload?.[0]) return null;
                            return (
                              <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-sm" dir="rtl">
                                <p className="font-medium">{label}</p>
                                <p>{formatAmountShort(Number(payload[0].value) * 100)}</p>
                                <p className="text-muted-foreground">{payload[0].payload.count} חשבוניות</p>
                              </div>
                            );
                          }}
                        />
                        <Bar
                          dataKey="amount"
                          radius={[6, 6, 0, 0]}
                          fill="hsl(var(--coral))"
                          maxBarSize={40}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ─── Category Chips ─── */}
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => { setActiveCategories([]); setPage(1); }}
              className={cn(
                "px-3 py-1.5 rounded-full text-sm font-medium transition-all border",
                activeCategories.length === 0
                  ? "bg-coral text-white border-coral"
                  : "bg-card text-muted-foreground border-border hover:border-coral/50",
              )}
            >
              הכל ({totalCount})
            </button>
            {(analytics?.byCategory ?? []).map(({ category, count }) => (
              <button
                key={category}
                onClick={() => toggleCategory(category)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-sm font-medium transition-all border flex items-center gap-1.5",
                  activeCategories.includes(category)
                    ? "border-transparent text-white"
                    : "bg-card text-foreground border-border hover:shadow-sm",
                )}
                style={
                  activeCategories.includes(category)
                    ? { backgroundColor: getCategoryColor(category) }
                    : {}
                }
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: getCategoryColor(category) }}
                />
                {category}
                <span className="text-xs opacity-70">({count})</span>
              </button>
            ))}
          </div>

          {/* ─── Status Filter + Search ─── */}
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <div className="flex gap-1 bg-secondary/50 rounded-lg p-1">
              {(["all", "pending", "review", "sent"] as const).map((tab) => {
                const labels: Record<string, string> = {
                  all: "הכל",
                  pending: "ממתין",
                  review: "לבדיקה",
                  sent: "נשלח",
                };
                return (
                  <button
                    key={tab}
                    onClick={() => { setActiveStatus(tab); setPage(1); }}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-sm font-medium transition-all",
                      activeStatus === tab
                        ? "bg-card shadow-sm text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {labels[tab]}
                  </button>
                );
              })}
            </div>
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="חפש לפי ספק או קטגוריה..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pr-9"
              />
            </div>
          </div>

          {/* ─── Card Grid ─── */}
          {documentsQuery.isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-[160px] rounded-xl" />
              ))}
            </div>
          ) : filteredDocuments.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <p className="text-lg font-medium">לא נמצאו חשבוניות</p>
              <p className="text-sm mt-1">נסה לשנות את הסינון או טווח התאריכים</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredDocuments.map((doc, index) => (
                <motion.div
                  key={doc.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.02 }}
                >
                  <Card
                    className="cursor-pointer hover:shadow-md hover:border-coral/30 transition-all group"
                    onClick={() => {
                      setSelectedDocId(doc.id);
                      setIsEditing(false);
                    }}
                  >
                    <CardContent className="p-4">
                      {/* Top: status + source */}
                      <div className="flex items-center justify-between mb-3">
                        <span
                          className={cn(
                            "px-2 py-0.5 rounded-md text-xs font-medium",
                            statusConfig[doc.status]?.className ?? "bg-muted text-muted-foreground",
                          )}
                        >
                          {statusConfig[doc.status]?.label ?? doc.status}
                        </span>
                        <span className="text-sm" title={doc.provider}>
                          {sourceIcons[doc.provider] ?? "📄"}
                        </span>
                      </div>

                      {/* Vendor */}
                      <h3 className="font-display font-semibold text-foreground truncate mb-1 group-hover:text-coral transition-colors">
                        {doc.vendor}
                      </h3>

                      {/* Amount */}
                      <p className="font-display text-xl font-bold text-foreground mb-2">
                        {formatAmount(doc.amountCents)}
                      </p>

                      {/* Date + category */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          {formatDate(doc.issuedAt)}
                        </span>
                        <Badge
                          variant="secondary"
                          className="text-xs gap-1"
                          style={{ borderColor: getCategoryColor(doc.category), borderWidth: "1px" }}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: getCategoryColor(doc.category) }}
                          />
                          {doc.category}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          )}

          {/* ─── Pagination ─── */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-8">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
              {pageNumbers.map((p) => (
                <Button
                  key={p}
                  variant={p === page ? "default" : "outline"}
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setPage(p)}
                >
                  {p}
                </Button>
              ))}
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm text-muted-foreground mr-2">
                {totalDocs.toLocaleString("he-IL")} חשבוניות
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ─── Floating Chat ─── */}
      <div className="fixed bottom-6 left-6 z-50" dir="rtl">
        <AnimatePresence>
          {chatOpen && (
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="mb-3 w-[360px] max-h-[480px] bg-card rounded-xl shadow-lg border border-border flex flex-col overflow-hidden"
            >
              {/* Header */}
              <div className="p-3 border-b border-border flex items-center gap-2 shrink-0">
                <div className="w-8 h-8 rounded-lg gradient-coral flex items-center justify-center">
                  <MessageCircle className="w-4 h-4 text-accent-foreground" />
                </div>
                <div className="flex-1">
                  <p className="font-display font-semibold text-sm text-foreground">Amram AI</p>
                  <p className="text-xs text-success">חשבוניות</p>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setChatOpen(false)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[200px] max-h-[320px]">
                {!chatQuery.data?.messages?.length && !chatQuery.isLoading && (
                  <div className="text-center text-muted-foreground text-xs py-8">
                    <p className="mb-2">שאל אותי על החשבוניות שלך</p>
                    <div className="space-y-1 text-[11px]">
                      <p className="bg-secondary/50 rounded-lg px-2 py-1 inline-block">הראה לי חשבוניות מ-PayPal</p>
                      <br />
                      <p className="bg-secondary/50 rounded-lg px-2 py-1 inline-block">שנה קטגוריה של חשבוניות ורסל</p>
                      <br />
                      <p className="bg-secondary/50 rounded-lg px-2 py-1 inline-block">כמה הוצאתי על תוכנה?</p>
                    </div>
                  </div>
                )}
                {(chatQuery.data?.messages ?? []).map((message) => (
                  <div key={message.id} className={`flex ${message.from === "user" ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
                      message.from === "user"
                        ? "gradient-coral text-accent-foreground rounded-bl-sm"
                        : "bg-secondary text-foreground rounded-br-sm"
                    }`}>
                      {message.text}
                    </div>
                  </div>
                ))}
                {sendChatMutation.isPending && (
                  <div className="flex justify-end">
                    <div className="bg-secondary rounded-xl px-3 py-2 rounded-br-sm">
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Input */}
              <div className="p-2 border-t border-border shrink-0">
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!chatInput.trim() || sendChatMutation.isPending) return;
                    sendChatMutation.mutate(chatInput.trim());
                  }}
                >
                  <Input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="שאל על החשבוניות..."
                    className="h-9 text-sm"
                    disabled={sendChatMutation.isPending}
                  />
                  <Button
                    type="submit"
                    variant="coral"
                    size="sm"
                    className="h-9 px-3"
                    disabled={sendChatMutation.isPending || !chatInput.trim()}
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </form>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* FAB */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setChatOpen((o) => !o)}
          className={cn(
            "w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-colors",
            chatOpen
              ? "bg-muted text-muted-foreground"
              : "gradient-coral text-accent-foreground",
          )}
        >
          {chatOpen ? <X className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
        </motion.button>
      </div>

      {/* ─── Detail Sheet ─── */}
      <Sheet
        open={Boolean(selectedDocId)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedDocId(null);
            setIsEditing(false);
          }
        }}
      >
        <SheetContent side="left" className="w-full sm:max-w-md overflow-y-auto" dir="rtl">
          <SheetHeader>
            <SheetTitle className="font-display">פרטי חשבונית</SheetTitle>
          </SheetHeader>

          {detailQuery.isLoading ? (
            <div className="space-y-4 mt-6">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-10 w-1/2" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : detail ? (
            <div className="mt-6 space-y-6">
              {/* Vendor & Amount */}
              <div>
                {isEditing ? (
                  <Input
                    value={editForm.vendorName ?? detail.vendor}
                    onChange={(e) => setEditForm({ ...editForm, vendorName: e.target.value })}
                    className="font-display font-semibold text-lg mb-2"
                  />
                ) : (
                  <h2 className="font-display font-semibold text-lg text-foreground">
                    {detail.vendor}
                  </h2>
                )}
                {isEditing ? (
                  <Input
                    type="number"
                    value={((editForm.amountCents ?? detail.amountCents) / 100).toString()}
                    onChange={(e) =>
                      setEditForm({ ...editForm, amountCents: Math.round(Number(e.target.value) * 100) })
                    }
                    className="font-display text-2xl font-bold"
                  />
                ) : (
                  <p className="font-display text-2xl font-bold text-foreground mt-1">
                    {formatAmount(detail.amountCents)}
                  </p>
                )}
              </div>

              {/* Info grid */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground block mb-1">תאריך</span>
                  <span className="font-medium">{formatDate(detail.issuedAt)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block mb-1">מקור</span>
                  <span className="font-medium">
                    {sourceIcons[detail.provider] ?? "📄"} {detail.provider}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block mb-1">סטטוס</span>
                  {isEditing ? (
                    <Select
                      value={editForm.status ?? detail.status}
                      onValueChange={(v) => setEditForm({ ...editForm, status: v as any })}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">ממתין</SelectItem>
                        <SelectItem value="review">לבדיקה</SelectItem>
                        <SelectItem value="sent">נשלח</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge className={statusConfig[detail.status]?.className ?? ""}>
                      {statusConfig[detail.status]?.label ?? detail.status}
                    </Badge>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground block mb-1">קטגוריה</span>
                  {isEditing ? (
                    <Select
                      value={editForm.category ?? detail.category}
                      onValueChange={(v) => setEditForm({ ...editForm, category: v })}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {allCategories.map((cat) => (
                          <SelectItem key={cat} value={cat}>
                            {cat}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge
                      variant="secondary"
                      className="gap-1"
                      style={{ borderColor: getCategoryColor(detail.category), borderWidth: "1px" }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: getCategoryColor(detail.category) }}
                      />
                      {detail.category}
                    </Badge>
                  )}
                </div>
                {detail.confidence !== undefined && (
                  <div>
                    <span className="text-muted-foreground block mb-1">ביטחון AI</span>
                    <span className="font-medium">{Math.round(detail.confidence * 100)}%</span>
                  </div>
                )}
                {detail.type && (
                  <div>
                    <span className="text-muted-foreground block mb-1">סוג</span>
                    <span className="font-medium">{detail.type}</span>
                  </div>
                )}
              </div>

              {/* Comments */}
              {isEditing ? (
                <div>
                  <span className="text-muted-foreground text-sm block mb-1">הערות</span>
                  <Input
                    value={editForm.comments ?? detail.comments ?? ""}
                    onChange={(e) => setEditForm({ ...editForm, comments: e.target.value || null })}
                    placeholder="הוסף הערה..."
                  />
                </div>
              ) : detail.comments ? (
                <div>
                  <span className="text-muted-foreground text-sm block mb-1">הערות</span>
                  <p className="text-sm">{detail.comments}</p>
                </div>
              ) : null}

              {/* Actions */}
              <div className="flex gap-2 pt-4 border-t">
                {isEditing ? (
                  <>
                    <Button
                      variant="coral"
                      className="flex-1 gap-1.5"
                      onClick={() => updateMutation.mutate(editForm)}
                      disabled={updateMutation.isPending}
                    >
                      <Save className="w-4 h-4" />
                      {updateMutation.isPending ? "שומר..." : "שמור"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsEditing(false);
                        setEditForm({});
                      }}
                    >
                      <X className="w-4 h-4" /> ביטול
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    className="flex-1 gap-1.5"
                    onClick={() => {
                      setIsEditing(true);
                      setEditForm({
                        vendorName: detail.vendor,
                        amountCents: detail.amountCents,
                        category: detail.category,
                        status: detail.status as any,
                        comments: detail.comments,
                      });
                    }}
                  >
                    <Pencil className="w-4 h-4" /> ערוך
                  </Button>
                )}
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default InvoicesPage;
