import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CreditCard,
  FileText,
  Loader2,
  Mail,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ConnectedInbox,
  DashboardDocument,
  DeepScanStatus,
  InboxProvider,
  OAuthProvider,
  createCheckoutSession,
  getBillingStatus,
  getDashboardDocuments,
  getDeepScanStatus,
  getOnboardingState,
  runInitialScan,
  startOnboarding,
} from "@/lib/api";
import { getActiveBusinessId, setActiveBusinessId } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { ScanProgressBars } from "@/components/DeepScanProgress";
import { getOAuthStartUrl } from "@/lib/api";

const TOTAL_STEPS = 6;

const providers: Array<{
  id: InboxProvider;
  name: string;
  icon: string;
  color: string;
  oauth: boolean;
}> = [
  { id: "gmail", name: "Gmail", icon: "📧", color: "bg-red-50 border-red-100", oauth: true },
  { id: "outlook", name: "Outlook", icon: "📬", color: "bg-blue-50 border-blue-100", oauth: true },
];

const OnboardingPage = () => {
  const [step, setStep] = useState(0);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [accountantName, setAccountantName] = useState("");
  const [accountantEmail, setAccountantEmail] = useState("");
  const [connectedInboxes, setConnectedInboxes] = useState<ConnectedInbox[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [isConnectingProvider, setIsConnectingProvider] = useState<InboxProvider | null>(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [isQuickScanning, setIsQuickScanning] = useState(false);
  const [quickScanResult, setQuickScanResult] = useState<{
    foundInvoices: number;
    totalAmountCents: number;
    previewDocs: DashboardDocument[];
  } | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  const displayName = accountantName || "עמרם";

  const slideVariants = {
    enter: { x: -50, opacity: 0 },
    center: { x: 0, opacity: 1 },
    exit: { x: 50, opacity: 0 },
  };

  // Poll deep scan status when on step 4
  const scanStatusQuery = useQuery<DeepScanStatus>({
    queryKey: ["deep-scan", "status", businessId],
    queryFn: () => getDeepScanStatus(businessId!),
    enabled: step === 4 && Boolean(businessId),
    refetchInterval: (query) => {
      const data = query.state.data;
      // Keep polling while active, or if no scan started yet (webhook may not have fired)
      if (!data || data.active || !data.scanJobId) return 3000;
      return false;
    },
  });

  // Auto-advance from step 4 to step 5 when scan completes
  useEffect(() => {
    const data = scanStatusQuery.data;
    if (step === 4 && data?.status === "COMPLETED") {
      setTimeout(() => setStep(5), 1000);
    }
  }, [scanStatusQuery.data?.status, step]);

  const hydrateState = (state: Awaited<ReturnType<typeof getOnboardingState>>) => {
    setBusinessId(state.business.id);
    setAccountantName(state.business.accountantName);
    setConnectedInboxes(state.connectedInboxes);
  };

  const loadOnboardingState = async (id: string) => {
    const state = await getOnboardingState(id);
    hydrateState(state);
    return state;
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthStatus = params.get("oauth");
    const provider = params.get("provider");
    const callbackBusinessId = params.get("businessId");
    const message = params.get("message");
    const paymentStatus = params.get("payment");
    const savedBusinessId = getActiveBusinessId();
    const nextBusinessId = callbackBusinessId ?? savedBusinessId;

    if (nextBusinessId) {
      setActiveBusinessId(nextBusinessId);
      loadOnboardingState(nextBusinessId)
        .then((state) => {
          // Determine which step to show based on state
          if (paymentStatus === "success") {
            // Just paid — go to deep scan progress
            setStep(4);
          } else if (state.connectedInboxes.length > 0) {
            setStep(1);
          }
        })
        .catch((error) => {
          toast({
            title: "טעינת מצב נכשלה",
            description: error instanceof Error ? error.message : "לא הצלחנו לטעון את מצב ההתחברות.",
            variant: "destructive",
          });
        });
    }

    if (oauthStatus === "success" && provider) {
      toast({
        title: "חיבור הצליח",
        description: `תיבת ${provider} חוברה בהצלחה.`,
      });
      setStep(1);
    } else if (oauthStatus === "error") {
      toast({
        title: "חיבור נכשל",
        description: message ?? "אירעה שגיאה בחיבור תיבת הדואר.",
        variant: "destructive",
      });
      setStep(1);
    }

    if (paymentStatus === "cancelled") {
      toast({
        title: "התשלום בוטל",
        description: "אפשר לנסות שוב בכל עת.",
        variant: "destructive",
      });
      setStep(3);
    }

    if (oauthStatus || callbackBusinessId || provider || message || paymentStatus) {
      window.history.replaceState(null, "", "/onboarding");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const beginOnboarding = async () => {
    setIsStarting(true);
    try {
      const response = await startOnboarding({
        accountantName: accountantName || undefined,
        accountantEmail: accountantEmail || undefined,
      });
      setActiveBusinessId(response.business.id);
      hydrateState(response);
      setStep(1);
    } catch (error) {
      toast({
        title: "שגיאת התחלה",
        description: error instanceof Error ? error.message : "לא הצלחנו להתחיל את תהליך ההגדרה.",
        variant: "destructive",
      });
    } finally {
      setIsStarting(false);
    }
  };

  const connectProvider = async (provider: InboxProvider) => {
    if (!businessId) {
      toast({
        title: "חסר מזהה עסק",
        description: "נא להתחיל מחדש את תהליך ההגדרה.",
        variant: "destructive",
      });
      return;
    }

    setIsConnectingProvider(provider);
    try {
      const response = await getOAuthStartUrl(businessId, provider as OAuthProvider);
      window.location.href = response.authUrl;
    } catch (error) {
      toast({
        title: "חיבור תיבה נכשל",
        description: error instanceof Error ? error.message : "לא הצלחנו לחבר את התיבה המבוקשת.",
        variant: "destructive",
      });
      setIsConnectingProvider(null);
    }
  };

  const handleCheckout = async () => {
    if (!businessId) return;
    setIsCheckingOut(true);
    try {
      const response = await createCheckoutSession(businessId);
      if (response.alreadyPaid) {
        // Already paid — skip to deep scan progress
        setStep(4);
        return;
      }
      if (response.checkoutUrl) {
        window.location.href = response.checkoutUrl;
      }
    } catch (error) {
      toast({
        title: "שגיאת תשלום",
        description: error instanceof Error ? error.message : "לא הצלחנו ליצור עמוד תשלום.",
        variant: "destructive",
      });
    } finally {
      setIsCheckingOut(false);
    }
  };

  const handleQuickScan = async () => {
    if (!businessId) return;
    setIsQuickScanning(true);
    try {
      const result = await runInitialScan({ businessId });
      // Fetch actual document previews
      let previewDocs: DashboardDocument[] = [];
      try {
        const docsResponse = await getDashboardDocuments(businessId, "all");
        previewDocs = docsResponse.documents.slice(0, 5);
      } catch {
        // Preview docs are nice-to-have, don't block
      }
      setQuickScanResult({
        foundInvoices: result.foundInvoices,
        totalAmountCents: result.totalAmountCents,
        previewDocs,
      });
      setStep(2);
    } catch (error) {
      toast({
        title: "הסריקה נכשלה",
        description: error instanceof Error ? error.message : "לא הצלחנו לסרוק את התיבה.",
        variant: "destructive",
      });
    } finally {
      setIsQuickScanning(false);
    }
  };

  const handleFinish = () => {
    navigate("/dashboard");
  };

  const scanData = scanStatusQuery.data;
  const scanCreated = scanData?.processing?.created ?? 0;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-xl">
        {/* Progress bar */}
        <div className="flex items-center gap-2 mb-8">
          {Array.from({ length: TOTAL_STEPS }, (_, s) => (
            <div key={s} className="flex-1 h-1.5 rounded-full overflow-hidden bg-secondary">
              <motion.div
                className="h-full gradient-coral rounded-full"
                initial={{ width: "0%" }}
                animate={{ width: step >= s ? "100%" : "0%" }}
                transition={{ duration: 0.4 }}
              />
            </div>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* ── Step 0: Accountant Name ── */}
          {step === 0 && (
            <motion.div
              key="step0"
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3 }}
              className="bg-card rounded-2xl p-8 md:p-10 shadow-elevated border border-border"
            >
              <div className="w-16 h-16 rounded-2xl gradient-coral flex items-center justify-center mb-6 shadow-coral">
                <Sparkles className="w-8 h-8 text-accent-foreground" />
              </div>
              <h1 className="font-display text-3xl font-bold text-foreground mb-3">
                איך קוראים לרואה החשבון שלך?
              </h1>
              <p className="text-muted-foreground mb-8">
                נתאים את כל החוויה סביבו כדי שהמסמכים יגיעו בזמן.
              </p>
              <Input
                placeholder="לדוגמה: סיגל, משה, דבורה..."
                value={accountantName}
                onChange={(e) => setAccountantName(e.target.value)}
                className="h-14 text-lg rounded-xl mb-3 border-border focus:border-coral focus:ring-coral"
              />
              <Input
                type="email"
                placeholder="כתובת מייל של רואה החשבון"
                value={accountantEmail}
                onChange={(e) => setAccountantEmail(e.target.value)}
                className="h-14 text-lg rounded-xl mb-4 border-border focus:border-coral focus:ring-coral"
                dir="ltr"
              />
              <Button variant="coral" className="w-full h-12" onClick={beginOnboarding} disabled={isStarting}>
                {isStarting
                  ? "מגדירים את החשבון..."
                  : accountantName
                    ? "יאללה, קדימה!"
                    : "בלי שם, קדימה"}{" "}
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </motion.div>
          )}

          {/* ── Step 1: Connect Email ── */}
          {step === 1 && (
            <motion.div
              key="step1"
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3 }}
              className="bg-card rounded-2xl p-8 md:p-10 shadow-elevated border border-border"
            >
              <div className="w-16 h-16 rounded-2xl bg-coral-light flex items-center justify-center mb-6">
                <Mail className="w-8 h-8 text-coral" />
              </div>
              <h1 className="font-display text-3xl font-bold text-foreground mb-3">
                חבר את תיבות הדואר שלך
              </h1>
              <p className="text-muted-foreground mb-8">
                נחבר את המייל שלך כדי לסרוק חשבוניות וקבלות אוטומטית.
              </p>

              {/* Connected inboxes */}
              {connectedInboxes.length > 0 && (
                <div className="space-y-2 mb-4">
                  {connectedInboxes.map((inbox) => (
                    <div
                      key={inbox.id}
                      className="flex items-center gap-3 p-3 rounded-xl border border-success bg-success/5"
                    >
                      <Check className="w-4 h-4 text-success flex-shrink-0" />
                      <span className="text-sm font-medium text-foreground flex-1 text-right">
                        {inbox.email}
                      </span>
                      <span className="text-xs text-success">
                        {inbox.provider === "gmail" ? "Gmail" : "Outlook"}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Provider buttons */}
              <div className="space-y-3 mb-6">
                {providers.map((provider) => {
                  const isLoading = isConnectingProvider === provider.id;
                  return (
                    <button
                      key={provider.id}
                      onClick={() => connectProvider(provider.id)}
                      disabled={isLoading}
                      className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all ${provider.color} hover:shadow-card`}
                    >
                      <span className="text-2xl">{provider.icon}</span>
                      <span className="font-medium text-foreground flex-1 text-right">
                        {connectedInboxes.some((i) => i.provider === provider.id)
                          ? `הוסף עוד חשבון ${provider.name}`
                          : `חבר ${provider.name}`}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {isLoading ? (
                          "מחבר..."
                        ) : (
                          <>
                            <Plus className="w-4 h-4 inline" /> חבר
                          </>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep(0)} className="h-12">
                  <ArrowRight className="w-4 h-4" />
                </Button>
                <Button
                  variant="coral"
                  className="flex-1 h-12"
                  onClick={handleQuickScan}
                  disabled={connectedInboxes.length === 0 || isQuickScanning}
                >
                  {isQuickScanning ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> סורק את התיבה...
                    </>
                  ) : (
                    <>
                      סרוק והמשך <ArrowLeft className="w-4 h-4" />
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          )}

          {/* ── Step 2: Quick Scan Preview ── */}
          {step === 2 && (
            <motion.div
              key="step2"
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3 }}
              className="bg-card rounded-2xl p-8 md:p-10 shadow-elevated border border-border"
            >
              <div className="w-16 h-16 rounded-2xl bg-coral-light flex items-center justify-center mb-6">
                <FileText className="w-8 h-8 text-coral" />
              </div>

              <h1 className="font-display text-3xl font-bold text-foreground mb-3">
                {quickScanResult && quickScanResult.foundInvoices > 0
                  ? `מצאנו ${quickScanResult.foundInvoices} חשבוניות!`
                  : "סריקה ראשונית"}
              </h1>
              <p className="text-muted-foreground mb-6">
                {quickScanResult && quickScanResult.foundInvoices > 0
                  ? "הנה דוגמאות ממה שמצאנו בתיבה שלך מהחודש האחרון:"
                  : "לא מצאנו חשבוניות בחודש האחרון — אבל סריקה עמוקה בודקת 3 שנים אחורה."}
              </p>

              {/* Preview document list */}
              {quickScanResult && quickScanResult.previewDocs.length > 0 && (
                <div className="space-y-2 mb-6">
                  {quickScanResult.previewDocs.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between p-3 rounded-xl border border-border bg-secondary/50"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-coral-light flex items-center justify-center flex-shrink-0">
                          <FileText className="w-4 h-4 text-coral" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{doc.vendor}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(doc.issuedAt).toLocaleDateString("he-IL")}
                            {doc.category ? ` · ${doc.category}` : ""}
                          </p>
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-foreground whitespace-nowrap mr-2" dir="ltr">
                        {doc.currency === "ILS" ? "₪" : "$"}
                        {(doc.amountCents / 100).toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Teaser for deep scan */}
              <div className="bg-secondary rounded-xl p-4 mb-6 border border-border">
                <p className="text-sm text-foreground font-medium mb-1">
                  🔍 רוצה את התמונה המלאה?
                </p>
                <p className="text-sm text-muted-foreground">
                  סריקה עמוקה בודקת <span className="font-semibold text-foreground">3 שנים</span> של מיילים ומוצאת הכל — חשבוניות, קבלות ואישורי תשלום.
                </p>
              </div>

              <Button
                variant="hero"
                className="w-full h-12 mb-3"
                onClick={() => setStep(3)}
              >
                הפעל סריקה עמוקה <ArrowLeft className="w-5 h-5" />
              </Button>

              <Button variant="outline" className="w-full h-10" onClick={() => setStep(1)}>
                <ArrowRight className="w-4 h-4" /> חזור
              </Button>
            </motion.div>
          )}

          {/* ── Step 3: Deep Scan Pitch + Payment ── */}
          {step === 3 && (
            <motion.div
              key="step3"
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3 }}
              className="bg-card rounded-2xl p-8 md:p-10 shadow-elevated border border-border"
            >
              <div className="w-16 h-16 rounded-2xl gradient-coral flex items-center justify-center mb-6 shadow-coral">
                <Search className="w-8 h-8 text-accent-foreground" />
              </div>

              <h1 className="font-display text-3xl font-bold text-foreground mb-3">
                סריקה עמוקה של התיבה שלך
              </h1>
              <p className="text-muted-foreground mb-6">
                נסרוק את <span className="font-semibold text-foreground">3 השנים האחרונות</span> של
                מיילים ונמצא את כל החשבוניות, הקבלות ואישורי התשלום — אוטומטית.
              </p>

              {/* Feature list */}
              <div className="space-y-3 mb-6">
                {[
                  { icon: Mail, text: "סריקת אלפי מיילים בדקות" },
                  { icon: Sparkles, text: "זיהוי חכם עם AI — ספקים, סכומים, קטגוריות" },
                  {
                    icon: ArrowLeft,
                    text: `שליחה אוטומטית ל-${displayName} כל חודש`,
                  },
                ].map(({ icon: Icon, text }) => (
                  <div key={text} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-coral-light flex items-center justify-center flex-shrink-0">
                      <Icon className="w-4 h-4 text-coral" />
                    </div>
                    <span className="text-sm text-foreground">{text}</span>
                  </div>
                ))}
              </div>

              {/* Pricing card */}
              <div className="bg-secondary rounded-xl p-5 mb-4 border border-border">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-display font-bold text-lg text-foreground">$13</span>
                  <span className="text-sm text-muted-foreground">דמי הקמה חד-פעמיים</span>
                </div>
                <div className="flex items-center justify-between mb-3">
                  <span className="font-display font-bold text-lg text-foreground">$7/חודש</span>
                  <span className="text-sm text-muted-foreground">מנוי חודשי</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-success">
                  <ShieldCheck className="w-4 h-4" />
                  <span className="font-medium">30 יום אחריות — לא מרוצה? כסף בחזרה.</span>
                </div>
              </div>

              <Button
                variant="hero"
                className="w-full h-12 mb-3"
                onClick={handleCheckout}
                disabled={isCheckingOut}
              >
                {isCheckingOut ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> מעבד...
                  </>
                ) : (
                  <>
                    <CreditCard className="w-5 h-5" /> הפעל סריקה עמוקה
                  </>
                )}
              </Button>

              <Button variant="outline" className="w-full h-10" onClick={() => setStep(2)}>
                <ArrowRight className="w-4 h-4" /> חזור
              </Button>
            </motion.div>
          )}

          {/* ── Step 4: Deep Scan Progress ── */}
          {step === 4 && (
            <motion.div
              key="step4"
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3 }}
              className="bg-card rounded-2xl p-8 md:p-10 shadow-elevated border border-border text-center"
            >
              <div className="w-16 h-16 rounded-2xl gradient-coral flex items-center justify-center mx-auto mb-6 shadow-coral">
                <Loader2 className="w-8 h-8 text-accent-foreground animate-spin" />
              </div>

              <h1 className="font-display text-3xl font-bold text-foreground mb-3">
                {!scanData || !scanData.scanJobId
                  ? "מכינים את הסריקה..."
                  : scanData.status === "DISCOVERING"
                    ? "מחפשים מיילים..."
                    : scanData.status === "PROCESSING"
                      ? "מעבדים חשבוניות..."
                      : scanData.status === "AI_PASS"
                        ? "חילוץ חכם עם AI..."
                        : scanData.status === "COMPLETED"
                          ? "הסריקה הושלמה!"
                          : scanData.status === "FAILED"
                            ? "הסריקה נכשלה"
                            : "סורקים..."}
              </h1>
              <p className="text-muted-foreground mb-8">
                {!scanData || !scanData.scanJobId
                  ? "תהליך הסריקה יתחיל עוד רגע..."
                  : scanData.status === "FAILED"
                    ? scanData.lastError ?? "אירעה שגיאה. ניתן לנסות שוב מהדשבורד."
                    : `סורקים את המייל שלך ומחפשים חשבוניות עבור ${displayName}.`}
              </p>

              {/* Progress bars — reuse from DeepScanProgress */}
              {scanData && scanData.scanJobId && scanData.status !== "FAILED" && (
                <div className="text-right mb-8">
                  <ScanProgressBars data={scanData} />
                </div>
              )}

              {/* Live counter */}
              {scanData && scanCreated > 0 && (
                <div className="bg-secondary rounded-xl p-4 mb-6">
                  <p className="font-display font-bold text-3xl text-foreground">
                    {scanCreated.toLocaleString("he-IL")}
                  </p>
                  <p className="text-sm text-muted-foreground">חשבוניות נמצאו עד כה</p>
                </div>
              )}

              {scanData?.status === "FAILED" && (
                <Button variant="coral" className="w-full h-12" onClick={handleFinish}>
                  עבור לדשבורד <ArrowLeft className="w-5 h-5" />
                </Button>
              )}
            </motion.div>
          )}

          {/* ── Step 5: Results ── */}
          {step === 5 && (
            <motion.div
              key="step5"
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3 }}
              className="bg-card rounded-2xl p-8 md:p-10 shadow-elevated border border-border text-center"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", duration: 0.6 }}
                className="w-20 h-20 rounded-full gradient-coral flex items-center justify-center mx-auto mb-6 shadow-coral"
              >
                <Check className="w-10 h-10 text-accent-foreground" />
              </motion.div>
              <h1 className="font-display text-3xl font-bold text-foreground mb-3">
                נמצאו {scanCreated.toLocaleString("he-IL")} חשבוניות!
              </h1>
              <p className="text-muted-foreground mb-2">
                מוכנות לשליחה ל-
                <span className="font-semibold text-foreground">{displayName}</span>.
              </p>
              <p className="text-sm text-muted-foreground mb-8">
                סיימנו את הסריקה העמוקה. עכשיו אפשר לראות הכל מסודר בדשבורד.
              </p>

              {/* Stats grid */}
              {scanData?.processing && (
                <div className="grid grid-cols-3 gap-4 mb-8">
                  <div className="bg-secondary rounded-xl p-4">
                    <p className="font-display font-bold text-2xl text-foreground">
                      {scanData.processing.created}
                    </p>
                    <p className="text-xs text-muted-foreground">נמצאו</p>
                  </div>
                  <div className="bg-secondary rounded-xl p-4">
                    <p className="font-display font-bold text-2xl text-foreground">
                      {scanData.processing.total.toLocaleString("he-IL")}
                    </p>
                    <p className="text-xs text-muted-foreground">מיילים נסרקו</p>
                  </div>
                  <div className="bg-secondary rounded-xl p-4">
                    <p className="font-display font-bold text-2xl text-foreground">
                      {scanData.ai?.processed ?? 0}
                    </p>
                    <p className="text-xs text-muted-foreground">עובדו ב-AI</p>
                  </div>
                </div>
              )}

              <Button variant="hero" className="w-full" onClick={handleFinish}>
                עבור לדשבורד <ArrowLeft className="w-5 h-5" />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default OnboardingPage;
