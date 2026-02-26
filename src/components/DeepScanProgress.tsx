import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Pause, Play, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
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
      toast({ title: "סריקה עמוקה התחילה", description: "מחפש חשבוניות ב-10 שנים האחרונות..." });
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

// Compact inline button — always renders as a button-sized element
export default function DeepScanProgress({ businessId }: DeepScanProgressProps) {
  const { statusQuery, startMutation, pauseMutation, resumeMutation } = useDeepScan(businessId);
  const data = statusQuery.data;

  // No scan ever started — show start button
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

  // Paused — compact button to resume
  if (data.status === "PAUSED") {
    return (
      <Button variant="outline" size="sm" onClick={() => resumeMutation.mutate()} disabled={resumeMutation.isPending}>
        <Play className="w-3.5 h-3.5" />
        {resumeMutation.isPending ? "מחדש..." : "המשך סריקה"}
      </Button>
    );
  }

  // Active — compact with spinner + pause button
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

// Expanded progress card — renders below the header when scan is active/paused
export function DeepScanExpandedProgress({ businessId }: DeepScanProgressProps) {
  const { statusQuery, pauseMutation, resumeMutation } = useDeepScan(businessId);
  const data = statusQuery.data;

  if (!data || !data.active && data.status !== "PAUSED") return null;

  return (
    <div className="bg-card rounded-xl p-4 shadow-card border border-border space-y-3 mb-6">
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
              <span className="text-sm font-medium">
                {data.status === "DISCOVERING"
                  ? "מחפש מיילים..."
                  : data.status === "PROCESSING"
                    ? "מעבד חשבוניות..."
                    : "חילוץ AI..."}
              </span>
            </>
          )}
        </div>
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
      <ScanProgressBars data={data} />
    </div>
  );
}

export function ScanProgressBars({ data }: { data: DeepScanStatus }) {
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
      label: "סריקה מהירה",
      done: data.status === "AI_PASS" || data.status === "COMPLETED",
      active: data.status === "PROCESSING",
      detail: data.processing
        ? `${data.processing.created} מסמכים מתוך ${data.processing.total.toLocaleString("he-IL")}`
        : "—",
      percent: data.processing?.percent ?? 0,
    },
    {
      label: "חילוץ AI",
      done: data.status === "COMPLETED",
      active: data.status === "AI_PASS",
      detail: data.ai
        ? `${data.ai.processed}/${data.ai.total}`
        : "—",
      percent: data.ai?.percent ?? 0,
    },
  ];

  return (
    <div className="space-y-2">
      {steps.map((step) => (
        <div key={step.label} className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className={step.active ? "text-foreground font-medium" : step.done ? "text-success" : "text-muted-foreground"}>
              {step.done ? "✓" : step.active ? "●" : "○"} {step.label}
            </span>
            <span className="text-muted-foreground">{step.detail}</span>
          </div>
          {(step.active || step.done) && step.percent !== undefined && (
            <Progress
              value={step.percent}
              className={`h-1.5 ${step.done ? "[&>div]:bg-success" : "[&>div]:bg-coral"}`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
