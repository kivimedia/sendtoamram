import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CreditCard,
  FileText,
  Loader2,
  Mail,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ConnectedInbox,
  DashboardDocument,
  DeepScanStatus,
  InboxProvider,
  OAuthProvider,
  checkEmailExists,
  createCheckoutSession,
  getBillingStatus,
  getDashboardDocuments,
  getDeepScanStatus,
  getOnboardingState,
  requestPasswordReset,
  resetPassword,
  runInitialScan,
  loginBusinessOwner,
  signupBusinessOwner,
  startOnboarding,
} from "@/lib/api";
import { clearActiveBusinessId, getActiveBusinessId, getAuthToken, setActiveBusinessId, setAuthToken } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { ScanProgressBars } from "@/components/DeepScanProgress";
import { getOAuthStartUrl } from "@/lib/api";

const TOTAL_STEPS = 5;

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
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupFullName, setSignupFullName] = useState("");
  const [isSigningUp, setIsSigningUp] = useState(false);
  const [selectedLoginEmail, setSelectedLoginEmail] = useState<string>("");
  const [isReturningUser, setIsReturningUser] = useState(false);
  const [needsPasswordOnly, setNeedsPasswordOnly] = useState(false);
  const [resetMode, setResetMode] = useState<"none" | "sent" | "verify">("none");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const navigate = useNavigate();
  const { toast } = useToast();

  const displayName = accountantName || "עמרם";

  // If already logged in with a token, check billing before deciding where to go
  useEffect(() => {
    const token = getAuthToken();
    const bid = getActiveBusinessId();
    if (token && bid && step === 0) {
      getBillingStatus(bid)
        .then((billing) => {
          if (billing.billingEnabled && !billing.onboardingPaid) {
            // Not paid - show deep scan pitch + payment page directly
            setBusinessId(bid);
            loadOnboardingState(bid).then(() => {
              setStep(4);
            }).catch(() => {
              setStep(4);
            });
          } else {
            navigate("/dashboard");
          }
        })
        .catch(() => {
          // billing check failed - go to dashboard as fallback
          navigate("/dashboard");
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const slideVariants = {
    enter: { x: -50, opacity: 0 },
    center: { x: 0, opacity: 1 },
    exit: { x: 50, opacity: 0 },
  };

  // Poll deep scan status when on step 5
  const scanStatusQuery = useQuery<DeepScanStatus>({
    queryKey: ["deep-scan", "status", businessId],
    queryFn: () => getDeepScanStatus(businessId!),
    enabled: step === 5 && Boolean(businessId),
    refetchInterval: (query) => {
      const data = query.state.data;
      // Keep polling while active, or if no scan started yet (webhook may not have fired)
      if (!data || data.active || !data.scanJobId) return 3000;
      return false;
    },
  });

  // Auto-advance from step 5 to step 6 when scan completes
  useEffect(() => {
    const data = scanStatusQuery.data;
    if (step === 5 && data?.status === "COMPLETED") {
      setTimeout(() => setStep(6), 1000);
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
    const oauthDisplayName = params.get("displayName");
    const savedBusinessId = getActiveBusinessId();
    const nextBusinessId = callbackBusinessId ?? savedBusinessId;

    if (nextBusinessId) {
      setActiveBusinessId(nextBusinessId);
      loadOnboardingState(nextBusinessId)
        .then((state) => {
          // Determine which step to show based on state
          if (paymentStatus === "success") {
            // Just paid — go to deep scan progress
            setStep(5);
          } else if (state.connectedInboxes.length > 0) {
            setStep(1);
          }
        })
        .catch((error) => {
          // Stale business ID (deleted or DB reset) - clear it and restart fresh
          clearActiveBusinessId();
          setBusinessId(null);
          setStep(0);
          toast({
            title: "טעינת מצב נכשלה",
            description: "מתחילים מחדש. אנא הזינו את פרטי רואה החשבון.",
            variant: "destructive",
          });
        });
    }

    if (oauthStatus === "success" && provider) {
      // Pre-fill user's name from their Google/Outlook profile
      if (oauthDisplayName && !signupFullName) {
        setSignupFullName(oauthDisplayName);
      }
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
      setStep(4);
    }

    if (oauthStatus || callbackBusinessId || provider || message || paymentStatus || oauthDisplayName) {
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
      const errorMessage = error instanceof Error ? error.message : "לא הצלחנו להתחיל את תהליך ההגדרה.";
      const isEmailExists = errorMessage.toLowerCase().includes("already in use") || errorMessage.includes("כבר בשימוש");
      
      toast({
        title: isEmailExists ? "המייל כבר רשום" : "שגיאת התחלה",
        description: isEmailExists ? (
          <div className="space-y-2">
            <p>{errorMessage}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/dashboard")}
              className="mt-2 w-full"
            >
              התחבר במקום
            </Button>
          </div>
        ) : errorMessage,
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
    if (!businessId) {
      toast({
        title: "שגיאה",
        description: "חסר מזהה עסק. נסה להתחבר מחדש.",
        variant: "destructive",
      });
      return;
    }
    setIsCheckingOut(true);
    try {
      const response = await createCheckoutSession(businessId);
      if (response.alreadyPaid) {
        // Already paid — skip to deep scan progress
        setStep(5);
        return;
      }
      if (response.checkoutUrl) {
        window.location.href = response.checkoutUrl;
      }
    } catch (error) {
      console.error("[checkout] Error:", error);
      toast({
        title: "שגיאת תשלום",
        description: error instanceof Error ? error.message : "לא הצלחנו ליצור עמוד תשלום. נסה שוב.",
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
      setStep(3);
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
                onKeyDown={(e) => { if (e.key === "Enter" && !isStarting) beginOnboarding(); }}
              />
              <Input
                type="email"
                placeholder="כתובת מייל של רואה החשבון"
                value={accountantEmail}
                onChange={(e) => setAccountantEmail(e.target.value)}
                className="h-14 text-lg rounded-xl mb-4 border-border focus:border-coral focus:ring-coral"
                dir={accountantEmail ? "ltr" : "rtl"}
                onKeyDown={(e) => { if (e.key === "Enter" && !isStarting) beginOnboarding(); }}
              />
              <Button variant="coral" className="w-full h-12" onClick={beginOnboarding} disabled={isStarting}>
                {isStarting
                  ? "מגדירים את החשבון..."
                  : accountantName
                    ? "יאללה, קדימה!"
                    : "בלי שם, קדימה"}{" "}
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <button
                className="w-full mt-3 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                onClick={() => {
                  setIsReturningUser(true);
                  setNeedsPasswordOnly(false);
                  setStep(2);
                }}
              >
                יש לי כבר חשבון - התחבר
              </button>
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
                  {connectedInboxes.map((inbox) => {
                    const isSelected = connectedInboxes.length > 1
                      ? (selectedLoginEmail || connectedInboxes[0]?.email) === inbox.email
                      : true;
                    return (
                      <div
                        key={inbox.id}
                        className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                          connectedInboxes.length > 1
                            ? isSelected
                              ? "border-coral bg-coral-light/30 cursor-pointer"
                              : "border-success/30 bg-success/5 cursor-pointer hover:border-coral/50"
                            : "border-success bg-success/5"
                        }`}
                        onClick={() => {
                          if (connectedInboxes.length > 1) {
                            setSelectedLoginEmail(inbox.email);
                          }
                        }}
                      >
                        {connectedInboxes.length > 1 ? (
                          <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                            isSelected ? "border-coral" : "border-muted-foreground/30"
                          }`}>
                            {isSelected && <div className="w-2 h-2 rounded-full bg-coral" />}
                          </div>
                        ) : (
                          <Check className="w-4 h-4 text-success flex-shrink-0" />
                        )}
                        <span className="text-sm font-medium text-foreground flex-1 text-right">
                          {inbox.email}
                        </span>
                        <span className={`text-xs ${isSelected && connectedInboxes.length > 1 ? "text-coral" : "text-success"}`}>
                          {inbox.provider === "gmail" ? "Gmail" : "Outlook"}
                        </span>
                      </div>
                    );
                  })}
                  {connectedInboxes.length > 1 && (
                    <p className="text-xs text-muted-foreground text-center mt-1">
                      בחר את המייל שישמש להתחברות
                    </p>
                  )}
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
                  onClick={async () => {
                    const inboxEmail = selectedLoginEmail || (connectedInboxes[0]?.email ?? "");
                    if (inboxEmail) {
                      setSignupEmail(inboxEmail);
                      try {
                        const check = await checkEmailExists(inboxEmail);
                        if (check.hasPassword) {
                          setIsReturningUser(true);
                          setNeedsPasswordOnly(false);
                          setStep(2);
                          return;
                        }
                        if (check.exists) {
                          // User exists via OAuth but no password yet
                          setIsReturningUser(false);
                          setNeedsPasswordOnly(true);
                          setStep(2);
                          return;
                        }
                      } catch {
                        // ignore - default to signup
                      }
                    }
                    setIsReturningUser(false);
                    setNeedsPasswordOnly(false);
                    setStep(2);
                  }}
                  disabled={connectedInboxes.length === 0}
                >
                  המשך <ArrowLeft className="w-4 h-4" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* ── Step 2: Login (returning) or Create Account (new) ── */}
          {step === 2 && (
            <motion.div
              key="step2-auth"
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3 }}
              className="bg-card rounded-2xl p-8 md:p-10 shadow-elevated border border-border"
            >
              <div className="w-16 h-16 rounded-2xl bg-coral-light flex items-center justify-center mb-6">
                {isReturningUser ? <ShieldCheck className="w-8 h-8 text-coral" /> : <UserPlus className="w-8 h-8 text-coral" />}
              </div>

              {/* ── Reset password: enter code ── */}
              {resetMode === "verify" ? (
                <>
                  <h1 className="font-display text-3xl font-bold text-foreground mb-3">הזן קוד איפוס</h1>
                  <p className="text-muted-foreground mb-2">שלחנו קוד בן 6 ספרות ל:</p>
                  <p className="text-sm text-muted-foreground mb-6 font-mono" dir="ltr">{signupEmail}</p>
                  <Input
                    placeholder="קוד בן 6 ספרות"
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="h-14 text-lg rounded-xl mb-3 border-border focus:border-coral focus:ring-coral text-center tracking-widest"
                    dir="ltr"
                    inputMode="numeric"
                    onKeyDown={(e) => { if (e.key === "Enter" && resetCode.length === 6 && newPassword.length >= 8) document.getElementById("reset-btn")?.click(); }}
                  />
                  <Input
                    type="password"
                    placeholder="סיסמה חדשה (לפחות 8 תווים)"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="h-14 text-lg rounded-xl mb-6 border-border focus:border-coral focus:ring-coral"
                    dir={newPassword ? "ltr" : "rtl"}
                    onKeyDown={(e) => { if (e.key === "Enter" && resetCode.length === 6 && newPassword.length >= 8) document.getElementById("reset-btn")?.click(); }}
                  />
                  <div className="flex gap-3">
                    <Button variant="outline" onClick={() => { setResetMode("none"); setResetCode(""); setNewPassword(""); }} className="h-12">
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                    <Button
                      id="reset-btn"
                      variant="coral"
                      className="flex-1 h-12"
                      disabled={isSigningUp || resetCode.length !== 6 || newPassword.length < 8}
                      onClick={async () => {
                        setIsSigningUp(true);
                        try {
                          const result = await resetPassword({ email: signupEmail, code: resetCode, newPassword });
                          if (result.token) {
                            setAuthToken(result.token);
                            setActiveBusinessId(result.businessId);
                            setBusinessId(result.businessId);
                            toast({ title: "הסיסמה אופסה בהצלחה!" });
                            handleQuickScan();
                          } else {
                            toast({ title: "הסיסמה אופסה. התחבר עם הסיסמה החדשה." });
                            setResetMode("none");
                            setSignupPassword("");
                          }
                        } catch (error) {
                          toast({
                            title: "איפוס נכשל",
                            description: error instanceof Error ? error.message : "קוד שגוי או שפג תוקפו.",
                            variant: "destructive",
                          });
                        } finally {
                          setIsSigningUp(false);
                        }
                      }}
                    >
                      {isSigningUp ? <><Loader2 className="w-4 h-4 animate-spin" /> מאפס...</> : <>אפס סיסמה והתחבר <ArrowLeft className="w-4 h-4" /></>}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <h1 className="font-display text-3xl font-bold text-foreground mb-3">
                    {isReturningUser ? "ברוך הבא חזרה!" : needsPasswordOnly ? "הגדר סיסמה" : "צור חשבון"}
                  </h1>
                  <p className="text-muted-foreground mb-2">
                    {isReturningUser
                      ? "זיהינו את המייל שלך. הזן סיסמה כדי להתחבר."
                      : needsPasswordOnly
                        ? "הגדר סיסמה כדי להתחבר בפעם הבאה בלי Gmail."
                        : "כדי לשמור את הנתונים שלך ולגשת מכל מכשיר."}
                  </p>
                  {!isReturningUser && !needsPasswordOnly && (
                    <Input
                      placeholder="שם מלא (לא חובה)"
                      value={signupFullName}
                      onChange={(e) => setSignupFullName(e.target.value)}
                      className="h-14 text-lg rounded-xl mb-3 border-border focus:border-coral focus:ring-coral"
                    />
                  )}
                  <Input
                    type="email"
                    placeholder="כתובת מייל"
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    className="h-14 text-lg rounded-xl mb-3 border-border focus:border-coral focus:ring-coral"
                    dir={signupEmail ? "ltr" : "rtl"}
                    readOnly={needsPasswordOnly}
                  />
                  <Input
                    type="password"
                    placeholder={isReturningUser ? "סיסמה" : "סיסמה (לפחות 8 תווים)"}
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    className="h-14 text-lg rounded-xl mb-2 border-border focus:border-coral focus:ring-coral"
                    dir={signupPassword ? "ltr" : "rtl"}
                    onKeyDown={(e) => { if (e.key === "Enter" && signupEmail && signupPassword.length >= (isReturningUser ? 1 : 8)) document.getElementById("auth-btn")?.click(); }}
                  />

                  {/* Forgot password link */}
                  {isReturningUser && (
                    <button
                      className="block text-sm text-coral hover:underline mb-4 cursor-pointer"
                      onClick={async () => {
                        if (!signupEmail) return;
                        toast({ title: "שולח קוד איפוס..." });
                        try {
                          await requestPasswordReset(signupEmail);
                          setResetMode("verify");
                          toast({ title: "קוד נשלח!", description: "בדוק את תיבת המייל שלך." });
                        } catch {
                          toast({ title: "שליחה נכשלה", variant: "destructive" });
                        }
                      }}
                    >
                      שכחתי סיסמה
                    </button>
                  )}
                  {!isReturningUser && <div className="mb-4" />}

                  <div className="flex gap-3">
                    <Button variant="outline" onClick={() => setStep(1)} className="h-12">
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                    <Button
                      id="auth-btn"
                      variant="coral"
                      className="flex-1 h-12"
                      onClick={async () => {
                        setIsSigningUp(true);

                        if (isReturningUser) {
                          // Login flow - doesn't need businessId, the API returns it
                          try {
                            const result = await loginBusinessOwner({
                              email: signupEmail,
                              password: signupPassword,
                            });
                            setAuthToken(result.token);
                            setActiveBusinessId(result.businessId);
                            setBusinessId(result.businessId);
                            // Check billing - if not paid, show offer instead of dashboard
                            try {
                              const billing = await getBillingStatus(result.businessId);
                              if (billing.billingEnabled && !billing.onboardingPaid) {
                                // Not paid yet - show deep scan pitch + payment page
                                await loadOnboardingState(result.businessId);
                                setIsSigningUp(false);
                                setStep(4);
                                return;
                              }
                            } catch {
                              // billing check failed - still go to dashboard
                            }
                            navigate("/dashboard");
                          } catch (error) {
                            toast({
                              title: "סיסמה שגויה",
                              description: "בדוק את הסיסמה ונסה שוב.",
                              variant: "destructive",
                            });
                            setIsSigningUp(false);
                          }
                        } else {
                          // Signup flow
                          try {
                            const result = await signupBusinessOwner({
                              businessId,
                              email: signupEmail,
                              password: signupPassword,
                              fullName: signupFullName || undefined,
                            });
                            setAuthToken(result.token);
                            handleQuickScan();
                          } catch (error) {
                            const msg = error instanceof Error ? error.message : "";
                            const isAlreadyExists = msg.toLowerCase().includes("already") || msg.includes("כבר");
                            if (isAlreadyExists) {
                              // Switch to login mode
                              setIsReturningUser(true);
                              setSignupPassword("");
                              toast({
                                title: "המייל כבר רשום",
                                description: "הזן את הסיסמה שלך כדי להתחבר.",
                              });
                              setIsSigningUp(false);
                              return;
                            }
                            toast({
                              title: "יצירת חשבון נכשלה",
                              description: msg || "שגיאה ביצירת החשבון.",
                              variant: "destructive",
                            });
                            setIsSigningUp(false);
                          }
                        }
                      }}
                      disabled={isSigningUp || !signupEmail || signupPassword.length < (isReturningUser ? 1 : 8) || (!isReturningUser && !businessId)}
                    >
                      {isSigningUp || isQuickScanning ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" /> {isQuickScanning ? "סורק..." : isReturningUser ? "מתחבר..." : needsPasswordOnly ? "שומר..." : "יוצר חשבון..."}
                        </>
                      ) : isReturningUser ? (
                        <>
                          התחבר וסרוק <ArrowLeft className="w-4 h-4" />
                        </>
                      ) : needsPasswordOnly ? (
                        <>
                          שמור סיסמה וסרוק <ArrowLeft className="w-4 h-4" />
                        </>
                      ) : (
                        <>
                          צור חשבון וסרוק <ArrowLeft className="w-4 h-4" />
                        </>
                      )}
                    </Button>
                  </div>

                  {/* Toggle between login and signup */}
                  {!needsPasswordOnly && (
                    <button
                      className="w-full mt-4 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      onClick={() => {
                        setIsReturningUser(!isReturningUser);
                        setSignupPassword("");
                        setResetMode("none");
                      }}
                    >
                      {isReturningUser ? "אין לי חשבון - צור חשבון חדש" : "יש לי כבר חשבון - התחבר"}
                    </button>
                  )}
                </>
              )}
            </motion.div>
          )}

          {/* ── Step 3: Quick Scan Preview ── */}
          {step === 3 && (
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
                  ? "הנה דוגמאות ממה שמצאנו בתיבה שלך מ-3 החודשים האחרונים:"
                  : "לא מצאנו חשבוניות ב-3 החודשים האחרונים, אבל סריקה עמוקה בודקת 3 שנים אחורה."}
              </p>

              {/* Preview document list */}
              {quickScanResult && quickScanResult.previewDocs.length > 0 && (
                <div className="space-y-2 mb-6">
                  {quickScanResult.previewDocs.map((doc) => {
                    const isExpanded = expandedDocId === doc.id;
                    const currencySymbol = doc.currency === "ILS" ? "₪" : doc.currency === "EUR" ? "€" : "$";
                    const typeLabels: Record<string, string> = {
                      INVOICE: "חשבונית",
                      RECEIPT: "קבלה",
                      SUBSCRIPTION: "מנוי",
                      PAYMENT_CONFIRMATION: "אישור תשלום",
                    };
                    return (
                      <div
                        key={doc.id}
                        className="rounded-xl border border-border bg-secondary/50 cursor-pointer transition-all hover:bg-secondary/80"
                        onClick={() => setExpandedDocId(isExpanded ? null : doc.id)}
                      >
                        <div className="flex items-center justify-between p-3">
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
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-foreground whitespace-nowrap" dir="ltr">
                              {currencySymbol}
                              {(doc.amountCents / 100).toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                            </span>
                            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="px-3 pb-3 border-t border-border/50">
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-xs">
                              <div className="text-muted-foreground">
                                סוג: <span className="text-foreground font-medium">{typeLabels[doc.type ?? ""] ?? doc.type ?? "חשבונית"}</span>
                              </div>
                              <div className="text-muted-foreground">
                                ביטחון: <span className="text-foreground font-medium">{Math.round((doc.confidence ?? 0) * 100)}%</span>
                              </div>
                              <div className="text-muted-foreground">
                                מקור: <span className="text-foreground font-medium">{doc.source === "email" ? "מייל" : "וואטסאפ"}</span>
                              </div>
                              <div className="text-muted-foreground">
                                ספק: <span className="text-foreground font-medium">{doc.provider}</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Teaser for deep scan */}
              <div className="bg-secondary rounded-xl p-4 mb-6 border border-border">
                <p className="text-sm text-foreground font-medium mb-1">
                  🔍 רוצה את התמונה המלאה?
                </p>
                <p className="text-sm text-muted-foreground">
                  סריקה עמוקה בודקת <span className="font-semibold text-foreground">3 שנים</span> של מיילים ומוצאת הכל: חשבוניות, קבלות ואישורי תשלום.
                </p>
              </div>

              <Button
                variant="hero"
                className="w-full h-12 mb-3"
                onClick={() => setStep(4)}
              >
                הפעל סריקה עמוקה <ArrowLeft className="w-5 h-5" />
              </Button>

              <Button variant="outline" className="w-full h-10" onClick={() => setStep(2)}>
                <ArrowRight className="w-4 h-4" /> חזור
              </Button>
            </motion.div>
          )}

          {/* ── Step 4: Deep Scan Pitch + Payment ── */}
          {step === 4 && (
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
                הצטרפו ל-SendToAmram
              </h1>
              <p className="text-muted-foreground mb-6">
                השירות שמנהל את כל החשבוניות שלכם - סריקה אוטומטית של <span className="font-semibold text-foreground">3 שנים</span> של
                מיילים, זיהוי חכם ושליחה ישירה לרואה החשבון.
              </p>

              {/* Feature list */}
              <div className="space-y-3 mb-6">
                {[
                  { icon: Mail, text: "סריקת אלפי מיילים ומציאת כל החשבוניות" },
                  { icon: Sparkles, text: "זיהוי חכם עם AI: ספקים, סכומים, קטגוריות" },
                  {
                    icon: ArrowLeft,
                    text: `שליחה אוטומטית ל${displayName} כל חודש`,
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
                  <span className="text-sm text-muted-foreground">דמי הקמה חד-פעמיים</span>
                  <span className="font-display font-bold text-lg text-foreground" dir="ltr">$13 <span className="text-sm font-normal text-muted-foreground">(כ-₪40)</span></span>
                </div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-muted-foreground">מנוי חודשי</span>
                  <span className="font-display font-bold text-lg text-foreground" dir="ltr">$7/חודש <span className="text-sm font-normal text-muted-foreground">(כ-₪22)</span></span>
                </div>
                <div className="flex items-center gap-2 text-sm text-success">
                  <ShieldCheck className="w-4 h-4" />
                  <span className="font-medium">30 יום אחריות. לא מרוצים? תקבלו החזר כספי מלא.</span>
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
                    <CreditCard className="w-5 h-5" /> הצטרף עכשיו
                  </>
                )}
              </Button>

              <Button variant="outline" className="w-full h-10" onClick={() => setStep(3)}>
                <ArrowRight className="w-4 h-4" /> חזור
              </Button>
            </motion.div>
          )}

          {/* ── Step 5: Deep Scan Progress ── */}
          {step === 5 && (
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

          {/* ── Step 6: Results ── */}
          {step === 6 && (
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
