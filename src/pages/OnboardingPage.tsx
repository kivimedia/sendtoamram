import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Mail, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ConnectedInbox,
  DashboardSummaryResponse,
  InboxProvider,
  OAuthProvider,
  connectInbox,
  getOAuthStartUrl,
  getOnboardingState,
  runInitialScan,
  startOnboarding,
} from "@/lib/api";
import { getActiveBusinessId, setActiveBusinessId } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";

const providers: Array<{ id: InboxProvider; name: string; icon: string; color: string }> = [
  { id: "gmail", name: "Gmail", icon: "📧", color: "bg-red-50 border-red-100" },
  { id: "outlook", name: "Outlook", icon: "📬", color: "bg-blue-50 border-blue-100" },
  { id: "imap", name: "מייל אחר (IMAP)", icon: "✉️", color: "bg-secondary border-border" },
];

const OnboardingPage = () => {
  const [step, setStep] = useState(0);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [accountantName, setAccountantName] = useState("");
  const [accountantEmail, setAccountantEmail] = useState("");
  const [connectedInboxes, setConnectedInboxes] = useState<ConnectedInbox[]>([]);
  const [foundInvoices, setFoundInvoices] = useState(0);
  const [scanSummary, setScanSummary] = useState<DashboardSummaryResponse | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isConnectingProvider, setIsConnectingProvider] = useState<InboxProvider | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const displayName = accountantName || "עמרם";

  const slideVariants = {
    enter: { x: -50, opacity: 0 },
    center: { x: 0, opacity: 1 },
    exit: { x: 50, opacity: 0 },
  };

  const hydrateState = (state: Awaited<ReturnType<typeof getOnboardingState>>) => {
    setBusinessId(state.business.id);
    setAccountantName(state.business.accountantName);
    setConnectedInboxes(state.connectedInboxes);
    if (state.connectedInboxes.length > 0) {
      setStep((current) => (current < 1 ? 1 : current));
    }
  };

  const loadOnboardingState = async (id: string) => {
    const state = await getOnboardingState(id);
    hydrateState(state);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthStatus = params.get("oauth");
    const provider = params.get("provider");
    const callbackBusinessId = params.get("businessId");
    const message = params.get("message");
    const savedBusinessId = getActiveBusinessId();
    const nextBusinessId = callbackBusinessId ?? savedBusinessId;

    if (nextBusinessId) {
      setActiveBusinessId(nextBusinessId);
      loadOnboardingState(nextBusinessId).catch((error) => {
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

    if (oauthStatus || callbackBusinessId || provider || message) {
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
      if (provider === "gmail" || provider === "outlook") {
        const response = await getOAuthStartUrl(businessId, provider as OAuthProvider);
        window.location.href = response.authUrl;
        return;
      }

      const response = await connectInbox({ businessId, provider });
      setConnectedInboxes(response.connectedInboxes);
      setIsConnectingProvider(null);
    } catch (error) {
      toast({
        title: "חיבור תיבה נכשל",
        description: error instanceof Error ? error.message : "לא הצלחנו לחבר את התיבה המבוקשת.",
        variant: "destructive",
      });
      setIsConnectingProvider(null);
    }
  };

  const runScan = async () => {
    if (!businessId) {
      return;
    }
    setIsScanning(true);
    try {
      const response = await runInitialScan({ businessId });
      setFoundInvoices(response.foundInvoices);
      setScanSummary(response.summary);
      setTimeout(() => setStep(2), 900);
    } catch (error) {
      toast({
        title: "סריקה נכשלה",
        description: error instanceof Error ? error.message : "לא הצלחנו לסרוק מסמכים כרגע.",
        variant: "destructive",
      });
    } finally {
      setIsScanning(false);
    }
  };

  const handleFinish = () => {
    navigate("/dashboard");
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-xl">
        <div className="flex items-center gap-2 mb-8">
          {[0, 1, 2].map((s) => (
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
          {step === 0 && (
            <motion.div key="step0" variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.3 }} className="bg-card rounded-2xl p-8 md:p-10 shadow-elevated border border-border">
              <div className="w-16 h-16 rounded-2xl gradient-coral flex items-center justify-center mb-6 shadow-coral">
                <Sparkles className="w-8 h-8 text-accent-foreground" />
              </div>
              <h1 className="font-display text-3xl font-bold text-foreground mb-3">איך קוראים לרואה החשבון שלך?</h1>
              <p className="text-muted-foreground mb-8">נתאים את כל החוויה סביבו כדי שהמסמכים יגיעו בזמן.</p>
              <Input
                placeholder="לדוגמה: סיגל, משה, דבורה..."
                value={accountantName}
                onChange={(event) => setAccountantName(event.target.value)}
                className="h-14 text-lg rounded-xl mb-3 border-border focus:border-coral focus:ring-coral"
              />
              <Input
                type="email"
                placeholder="כתובת מייל של רואה החשבון"
                value={accountantEmail}
                onChange={(event) => setAccountantEmail(event.target.value)}
                className="h-14 text-lg rounded-xl mb-4 border-border focus:border-coral focus:ring-coral"
                dir="ltr"
              />
              <Button variant="coral" className="w-full h-12" onClick={beginOnboarding} disabled={isStarting}>
                {isStarting ? "מגדירים את החשבון..." : accountantName ? "יאללה, קדימה!" : "בלי שם, קדימה"} <ArrowLeft className="w-4 h-4" />
              </Button>
            </motion.div>
          )}

          {step === 1 && (
            <motion.div key="step1" variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.3 }} className="bg-card rounded-2xl p-8 md:p-10 shadow-elevated border border-border">
              <div className="w-16 h-16 rounded-2xl bg-coral-light flex items-center justify-center mb-6">
                <Mail className="w-8 h-8 text-coral" />
              </div>
              <h1 className="font-display text-3xl font-bold text-foreground mb-3">חבר את תיבות הדואר שלך</h1>
              <p className="text-muted-foreground mb-8">נסרוק את תיבת הדואר ונמצא חשבוניות וקבלות אוטומטית.</p>

              {/* Connected inboxes list */}
              {connectedInboxes.length > 0 && (
                <div className="space-y-2 mb-4">
                  {connectedInboxes.map((inbox) => (
                    <div key={inbox.id} className="flex items-center gap-3 p-3 rounded-xl border border-success bg-success/5">
                      <Check className="w-4 h-4 text-success flex-shrink-0" />
                      <span className="text-sm font-medium text-foreground flex-1 text-right">{inbox.email}</span>
                      <span className="text-xs text-success">{inbox.provider === "gmail" ? "Gmail" : inbox.provider === "outlook" ? "Outlook" : inbox.provider}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Provider buttons — always available for adding more */}
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
                        {isLoading ? "מחבר..." : <><Plus className="w-4 h-4 inline" /> חבר</>}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep(0)} className="h-12">
                  <ArrowRight className="w-4 h-4" />
                </Button>
                <Button variant="coral" className="flex-1 h-12" onClick={runScan} disabled={connectedInboxes.length === 0 || isScanning}>
                  {isScanning ? "סורק..." : "סרוק והמשך"} <ArrowLeft className="w-4 h-4" />
                </Button>
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="step2" variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.3 }} className="bg-card rounded-2xl p-8 md:p-10 shadow-elevated border border-border text-center">
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", duration: 0.6 }} className="w-20 h-20 rounded-full gradient-coral flex items-center justify-center mx-auto mb-6 shadow-coral">
                <Check className="w-10 h-10 text-accent-foreground" />
              </motion.div>
              <h1 className="font-display text-3xl font-bold text-foreground mb-3">נמצאו {foundInvoices} חשבוניות!</h1>
              <p className="text-muted-foreground mb-2">מוכנות לשליחה ל-<span className="font-semibold text-foreground">{displayName}</span>.</p>
              <p className="text-sm text-muted-foreground mb-8">סיימנו סריקה ראשונית. עכשיו אפשר לראות הכל מסודר בדשבורד.</p>

              <div className="grid grid-cols-3 gap-4 mb-8">
                <div className="bg-secondary rounded-xl p-4">
                  <p className="font-display font-bold text-2xl text-foreground">{scanSummary?.totals.sent ?? 0}</p>
                  <p className="text-xs text-muted-foreground">נשלחו</p>
                </div>
                <div className="bg-secondary rounded-xl p-4">
                  <p className="font-display font-bold text-2xl text-foreground">{scanSummary?.totals.pending ?? 0}</p>
                  <p className="text-xs text-muted-foreground">ממתינות</p>
                </div>
                <div className="bg-secondary rounded-xl p-4">
                  <p className="font-display font-bold text-2xl text-foreground">{scanSummary?.totals.review ?? 0}</p>
                  <p className="text-xs text-muted-foreground">לבדיקה</p>
                </div>
              </div>

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
