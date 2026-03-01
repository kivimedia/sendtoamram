import { useEffect, useState, useRef, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Search, Pause, Play, CheckCircle2, Loader2, AlertCircle, Clock, Mail, FileText, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  DeepScanStatus,
  getDeepScanStatus,
  startDeepScan,
  pauseDeepScan,
  resumeDeepScan,
} from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

// ─── Message Pools ───

const DISCOVERY_MESSAGES = [
  "מחטט בתיבת הדואר שלך...",
  "בודק תיקיות ישנות שאף אחד לא נגע בהן",
  "חושב על זה כמו בלש פרטי לחשבוניות",
  "סורק הודעות מ-3 שנים אחורה",
  "מחפש מחטים בערימת מיילים",
  "פותח מיילים ישנים בזהירות...",
  "מי שולח כל כך הרבה מיילים?!",
  "בודק גם את תיקיית הספאם, סתם ליתר ביטחון",
  "עובר על כל מייל, אחד אחד, כמו רואה חשבון אמיתי",
  "ממיין הודעות לפי תאריך...",
  "נכנס לעומק של Gmail שלך",
  "מחפש כל דבר שנראה כמו חשבונית",
  "בודק קבצים מצורפים בכל מייל",
  "לא מפספס אפילו מייל אחד",
  "סוקר את כל התיבה, בלי לדלג",
];

const PROCESSING_MESSAGES = [
  "בודק אם זו באמת חשבונית או סתם פלייר",
  "מחפש סכומים ותאריכים",
  "מזהה חשבוניות מחברות ידועות",
  "קורא PDF-ים כמו מקצוען",
  "מפריד חשבוניות מקבלות",
  "בודק חשבוניות מס, קבלות, הזמנות...",
  "מוצא חשבוניות שלא ידעת שיש לך",
  "ממיין מסמכים לפי סוג",
  "מחפש מע\"מ, סכומים, תאריכים",
  "מנתח טקסט מתוך קבצים מצורפים",
  "בודק שם ספק ופרטי חשבונית",
  "עובד על זה בלי הפסקת קפה",
  "מסנן פרסומות ומיילים לא רלוונטיים",
  "מזהה חשבוניות גם בפורמטים מוזרים",
  "קורא את האותיות הקטנות בשבילך",
];

const AI_MESSAGES = [
  "Claude מנתח חשבוניות עכשיו",
  "AI קורא את האותיות הקטנות",
  "חכם כמו רואה חשבון, מהיר כמו מחשב",
  "מחלץ סכומים, תאריכים, מע\"מ...",
  "מנתח כל חשבונית בנפרד עם AI",
  "בינה מלאכותית בעבודה מלאה",
  "מבין חשבוניות בכל שפה",
  "מפענח PDF-ים מסובכים",
  "מחשב מע\"מ ואת הסכום הנכון",
  "מזהה את שם הספק האמיתי",
  "מקטלג חשבוניות לקטגוריות",
  "מוודא שהנתונים מדויקים",
  "מעבד חשבוניות כמו מכונה משומנת",
  "קורא חשבוניות גם אם הן מטושטשות",
  "מסיים את העבודה בשבילך...",
];

const PAUSED_MESSAGES = [
  "הסריקה מחכה בצד - תמשיך כשנוח לך",
  "בהפסקה... מחכה לאות ממך",
  "מושהה. לחץ המשך כשתהיה מוכן",
];

// ─── Custom Hooks ───

function useRotatingMessage(messages: string[], intervalMs = 4000) {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * messages.length));

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % messages.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [messages.length, intervalMs]);

  return messages[index];
}

function useElapsedTimer(startedAt?: string) {
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    if (!startedAt) { setElapsed(""); return; }

    const tick = () => {
      const diff = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      if (h > 0) {
        setElapsed(`${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
      } else {
        setElapsed(`${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
      }
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  return elapsed;
}

function useInvoiceDetector(created: number | undefined) {
  const prevRef = useRef(created ?? 0);
  const [burstKey, setBurstKey] = useState(0);

  useEffect(() => {
    const current = created ?? 0;
    if (current > prevRef.current && prevRef.current > 0) {
      setBurstKey((k) => k + 1);
    }
    prevRef.current = current;
  }, [created]);

  return burstKey;
}

function useConfettiStyles() {
  useEffect(() => {
    const id = "deep-scan-confetti-styles";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      @keyframes confetti-fall {
        0% { transform: translateY(0) rotate(0deg); opacity: 1; }
        100% { transform: translateY(120px) rotate(720deg); opacity: 0; }
      }
      @keyframes confetti-spread {
        0% { transform: translateX(0); }
        100% { transform: translateX(var(--spread)); }
      }
      @keyframes shimmer-move {
        0% { background-position: -200% 0; }
        100% { background-position: 200% 0; }
      }
      .deep-scan-shimmer > div {
        background: linear-gradient(
          90deg,
          hsl(var(--coral)) 0%,
          hsl(var(--coral) / 0.4) 50%,
          hsl(var(--coral)) 100%
        ) !important;
        background-size: 200% 100% !important;
        animation: shimmer-move 1.5s ease-in-out infinite !important;
      }
    `;
    document.head.appendChild(style);
  }, []);
}

// ─── Sub-Components ───

const CONFETTI_COLORS = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A", "#98D8C8", "#F7DC6F", "#BB8FCE", "#85C1E9", "#F1948A", "#82E0AA", "#F8C471", "#AED6F1"];

function ConfettiBurst({ burstKey }: { burstKey: number }) {
  useConfettiStyles();

  if (burstKey === 0) return null;

  return (
    <div key={burstKey} className="absolute inset-0 pointer-events-none overflow-hidden z-10">
      {CONFETTI_COLORS.map((color, i) => (
        <div
          key={i}
          className="absolute w-2 h-2 rounded-sm"
          style={{
            backgroundColor: color,
            top: "40%",
            left: "50%",
            "--spread": `${(i % 2 === 0 ? 1 : -1) * (20 + Math.random() * 80)}px`,
            animation: `confetti-fall ${0.8 + Math.random() * 0.6}s ease-out forwards, confetti-spread ${0.8 + Math.random() * 0.6}s ease-out forwards`,
            animationDelay: `${i * 0.05}s`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

function LiveActivityFeed({ data }: { data: DeepScanStatus }) {
  const pool = useMemo(() => {
    if (data.status === "PAUSED") return PAUSED_MESSAGES;
    if (data.status === "AI_PASS") return AI_MESSAGES;
    if (data.status === "PROCESSING") return PROCESSING_MESSAGES;
    return DISCOVERY_MESSAGES;
  }, [data.status]);

  const message = useRotatingMessage(pool);

  const suffix = useMemo(() => {
    if (data.status === "DISCOVERING" && data.discovery?.totalFound) {
      return ` (${data.discovery.totalFound.toLocaleString("he-IL")} מיילים עד כה)`;
    }
    if (data.status === "PROCESSING" && data.processing) {
      return ` (${data.processing.created} חשבוניות נמצאו)`;
    }
    if (data.status === "AI_PASS" && data.ai) {
      return ` (${data.ai.processed}/${data.ai.total})`;
    }
    return "";
  }, [data.status, data.discovery?.totalFound, data.processing?.created, data.ai?.processed, data.ai?.total]);

  return (
    <div className="h-6 relative overflow-hidden">
      <AnimatePresence mode="wait">
        <motion.p
          key={message}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3 }}
          className="text-xs text-muted-foreground absolute inset-0 flex items-center"
        >
          {message}{suffix}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

function StatsRow({ data }: { data: DeepScanStatus }) {
  const emails = data.discovery?.totalFound ?? 0;
  const invoices = data.processing?.created ?? 0;
  const errors = data.processing?.errors ?? 0;

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <StatPill icon={<Mail className="w-3 h-3" />} value={emails} label="מיילים" />
      {(data.status !== "DISCOVERING" || invoices > 0) && (
        <StatPill icon={<FileText className="w-3 h-3" />} value={invoices} label="חשבוניות" highlight />
      )}
      {errors > 0 && (
        <StatPill icon={<AlertTriangle className="w-3 h-3" />} value={errors} label="שגיאות" variant="error" />
      )}
    </div>
  );
}

function StatPill({ icon, value, label, highlight, variant }: {
  icon: React.ReactNode;
  value: number;
  label: string;
  highlight?: boolean;
  variant?: "error";
}) {
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
      variant === "error"
        ? "bg-destructive/10 text-destructive border-destructive/20"
        : highlight
          ? "bg-coral/10 text-coral border-coral/20"
          : "bg-muted/50 text-muted-foreground border-border"
    }`}>
      {icon}
      <AnimatePresence mode="wait">
        <motion.span
          key={value}
          initial={{ scale: 1.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
        >
          {value.toLocaleString("he-IL")}
        </motion.span>
      </AnimatePresence>
      <span>{label}</span>
    </div>
  );
}

function ElapsedTimerDisplay({ startedAt }: { startedAt?: string }) {
  const elapsed = useElapsedTimer(startedAt);
  if (!elapsed) return null;

  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground" dir="ltr">
      <Clock className="w-3 h-3" />
      <span className="font-mono tabular-nums">{elapsed}</span>
    </div>
  );
}

function BackgroundScanBanner() {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t border-border">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
      </span>
      <span>הסריקה רצה ברקע גם אם תסגור את הדפדפן</span>
    </div>
  );
}

// ─── Main Hook (unchanged) ───

interface DeepScanProgressProps {
  businessId: string;
}

export function useDeepScan(businessId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const statusQuery = useQuery<DeepScanStatus>({
    queryKey: ["deep-scan", "status", businessId],
    queryFn: () => getDeepScanStatus(businessId),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.active) return 3000;
      return false;
    },
  });

  // Invalidate document queries when new documents are created during scanning
  useEffect(() => {
    if (statusQuery.data?.active && statusQuery.data.processing?.created) {
      queryClient.invalidateQueries({ queryKey: ["dashboard", "documents"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "summary"] });
    }
  }, [statusQuery.data?.processing?.created, statusQuery.data?.active, queryClient]);

  const startMutation = useMutation({
    mutationFn: () => startDeepScan(businessId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deep-scan", "status", businessId] });
      toast({ title: "סריקה עמוקה התחילה", description: "מחפש חשבוניות מ-3 השנים האחרונות..." });
    },
    onError: (error) => {
      toast({
        title: "לא ניתן להתחיל סריקה",
        description: error instanceof Error ? error.message : "אירעה שגיאה",
        variant: "destructive",
      });
    },
  });

  const pauseMutation = useMutation({
    mutationFn: () => pauseDeepScan(businessId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deep-scan", "status", businessId] });
      toast({ title: "הסריקה הושהתה" });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: () => resumeDeepScan(businessId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deep-scan", "status", businessId] });
      toast({ title: "הסריקה חודשה" });
    },
  });

  return { statusQuery, startMutation, pauseMutation, resumeMutation };
}

// ─── Compact Inline Button (unchanged) ───

export default function DeepScanProgress({ businessId }: DeepScanProgressProps) {
  const { statusQuery, startMutation, pauseMutation, resumeMutation } = useDeepScan(businessId);
  const data = statusQuery.data;

  // No scan ever started - show start button
  if (!data || !data.scanJobId) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => startMutation.mutate()}
        disabled={startMutation.isPending}
      >
        <Search className={`w-4 h-4 ${startMutation.isPending ? "animate-pulse" : ""}`} />
        {startMutation.isPending ? "מתחיל..." : "סריקה עמוקה"}
      </Button>
    );
  }

  // Completed scan
  if (data.status === "COMPLETED") {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs text-success">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>סריקה הושלמה, {data.processing?.created ?? 0} מסמכים</span>
        </div>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => startMutation.mutate()} disabled={startMutation.isPending}>
          סרוק שוב
        </Button>
      </div>
    );
  }

  // Failed scan
  if (data.status === "FAILED") {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="w-3.5 h-3.5" />
          <span>נכשל</span>
        </div>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => startMutation.mutate()} disabled={startMutation.isPending}>
          נסה שוב
        </Button>
      </div>
    );
  }

  // Paused - compact button to resume
  if (data.status === "PAUSED") {
    return (
      <Button variant="outline" size="sm" onClick={() => resumeMutation.mutate()} disabled={resumeMutation.isPending}>
        <Play className="w-3.5 h-3.5" />
        {resumeMutation.isPending ? "מחדש..." : "המשך סריקה"}
      </Button>
    );
  }

  // Active - compact with spinner + pause button
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 text-xs text-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-coral" />
        <span>
          {data.status === "DISCOVERING" ? "מחפש..." : `${data.processing?.percent ?? 0}%`}
        </span>
      </div>
      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => pauseMutation.mutate()} disabled={pauseMutation.isPending}>
        <Pause className="w-3 h-3" /> השהה
      </Button>
    </div>
  );
}

// ─── Expanded Progress Card (overhauled) ───

export function DeepScanExpandedProgress({ businessId }: DeepScanProgressProps) {
  const { statusQuery, pauseMutation, resumeMutation } = useDeepScan(businessId);
  const data = statusQuery.data;
  const burstKey = useInvoiceDetector(data?.processing?.created);

  if (!data || (!data.active && data.status !== "PAUSED")) return null;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      className="bg-card rounded-xl p-4 shadow-card border border-border space-y-3 mb-3 relative overflow-hidden"
    >
      <ConfettiBurst burstKey={burstKey} />

      {/* Header: title + timer + pause/resume */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {data.status === "PAUSED" ? (
            <>
              <Pause className="w-4 h-4 text-warning" />
              <span className="text-sm font-medium">סריקה עמוקה (מושהית)</span>
            </>
          ) : (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-coral" />
              <span className="text-sm font-medium">סריקה עמוקה פעילה</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ElapsedTimerDisplay startedAt={data.startedAt} />
          {data.status === "PAUSED" ? (
            <Button variant="outline" size="sm" className="h-7" onClick={() => resumeMutation.mutate()} disabled={resumeMutation.isPending}>
              <Play className="w-3 h-3" /> {resumeMutation.isPending ? "מחדש..." : "המשך"}
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="h-7" onClick={() => pauseMutation.mutate()} disabled={pauseMutation.isPending}>
              <Pause className="w-3 h-3" /> {pauseMutation.isPending ? "משהה..." : "השהה"}
            </Button>
          )}
        </div>
      </div>

      {/* Rotating activity message */}
      <LiveActivityFeed data={data} />

      {/* Stats pills */}
      <StatsRow data={data} />

      {/* Progress bars with shimmer */}
      <ScanProgressBars data={data} />

      {/* Background scan reassurance */}
      {data.active && <BackgroundScanBanner />}
    </motion.div>
  );
}

// ─── Progress Bars (with shimmer on active step) ───

export function ScanProgressBars({ data }: { data: DeepScanStatus }) {
  useConfettiStyles(); // also injects shimmer styles

  const steps = [
    {
      label: "חיפוש",
      done: data.discovery?.isComplete ?? false,
      active: data.status === "DISCOVERING",
      detail: data.discovery?.totalFound
        ? `${data.discovery.totalFound.toLocaleString("he-IL")} מיילים`
        : "...",
      percent: data.discovery?.isComplete ? 100 : undefined,
    },
    {
      label: "סינון חשבוניות",
      done: data.status === "AI_PASS" || data.status === "COMPLETED",
      active: data.status === "PROCESSING",
      detail: data.processing
        ? `${data.processing.created} מתוך ${data.processing.total.toLocaleString("he-IL")} (${data.processing.percent}%)`
        : "—",
      percent: data.processing?.percent ?? 0,
    },
    {
      label: "חילוץ AI",
      done: data.status === "COMPLETED",
      active: data.status === "AI_PASS",
      detail: data.ai && data.ai.total > 0
        ? `${data.ai.processed}/${data.ai.total} (${data.ai.percent}%)`
        : "—",
      percent: data.ai?.percent ?? 0,
    },
  ];

  return (
    <div className="space-y-2">
      {steps.map((step) => (
        <div key={step.label} className="space-y-1">
          <div className="text-xs">
            <span className={step.active ? "text-foreground font-medium" : step.done ? "text-success" : "text-muted-foreground"}>
              {step.done ? "✓" : step.active ? "●" : "○"} {step.label}
            </span>
            {step.detail && <span className="text-muted-foreground mr-2">{step.detail}</span>}
          </div>
          {(step.active || step.done) && step.percent !== undefined && (
            <Progress
              value={step.percent}
              className={`h-1.5 ${step.done ? "[&>div]:bg-success" : "[&>div]:bg-coral"} ${step.active ? "deep-scan-shimmer" : ""}`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
