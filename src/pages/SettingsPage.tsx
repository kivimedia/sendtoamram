import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CreditCard, FileText, Mail, Plug, Plus, Trash2, User } from "lucide-react";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  connectInbox,
  connectWhatsAppIntegration,
  disconnectInbox,
  getOAuthStartUrl,
  getSettings,
  getWhatsAppSession,
  updateSettingsAccount,
  updateSettingsAccountant,
} from "@/lib/api";
import { getActiveBusinessId } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";

type SettingsTab = "account" | "inboxes" | "accountant" | "notifications" | "integrations" | "billing";

const tabs: { id: SettingsTab; label: string; icon: typeof User }[] = [
  { id: "account", label: "חשבון", icon: User },
  { id: "inboxes", label: "תיבות דואר מחוברות", icon: Mail },
  { id: "accountant", label: "רואה החשבון שלך", icon: FileText },
  { id: "notifications", label: "התראות", icon: Bell },
  { id: "integrations", label: "אינטגרציות", icon: Plug },
  { id: "billing", label: "חיוב ותוכנית", icon: CreditCard },
];

const providerLabel: Record<string, string> = {
  gmail: "Gmail",
  outlook: "Outlook",
  imap: "IMAP",
  yahoo: "Yahoo",
  icloud: "iCloud",
};

const SettingsPage = () => {
  const businessId = getActiveBusinessId();
  const [activeTab, setActiveTab] = useState<SettingsTab>("account");
  const [accountForm, setAccountForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    businessName: "",
    currency: "ILS",
  });
  const [accountantForm, setAccountantForm] = useState({
    name: "",
    email: "",
    phone: "",
    firmName: "",
    monthlyDeliveryDay: 3,
    autoMonthlyDelivery: true,
  });
  const [whatsAppPhone, setWhatsAppPhone] = useState("");
  const [whatsAppName, setWhatsAppName] = useState("");
  const [whatsAppQrDataUrl, setWhatsAppQrDataUrl] = useState<string | null>(null);
  const [whatsAppRuntimeStatus, setWhatsAppRuntimeStatus] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const settingsQuery = useQuery({
    queryKey: ["settings", businessId],
    queryFn: () => getSettings(businessId as string),
    enabled: Boolean(businessId),
  });

  useEffect(() => {
    if (!settingsQuery.data) {
      return;
    }
    setAccountForm({
      fullName: settingsQuery.data.owner?.fullName ?? "",
      email: settingsQuery.data.owner?.email ?? "",
      phone: settingsQuery.data.owner?.phone ?? "",
      businessName: settingsQuery.data.business.name,
      currency: settingsQuery.data.business.currency,
    });
    setAccountantForm({
      name: settingsQuery.data.accountant.name ?? "",
      email: settingsQuery.data.accountant.email ?? "",
      phone: settingsQuery.data.accountant.phone ?? "",
      firmName: settingsQuery.data.accountant.firmName ?? "",
      monthlyDeliveryDay: settingsQuery.data.accountant.monthlyDeliveryDay,
      autoMonthlyDelivery: settingsQuery.data.accountant.autoMonthlyDelivery,
    });
    setWhatsAppPhone(settingsQuery.data.whatsapp?.customerPhoneE164 ?? "");
    setWhatsAppName(settingsQuery.data.whatsapp?.customerName ?? "");
    setWhatsAppRuntimeStatus(settingsQuery.data.whatsapp?.status ?? null);
    setWhatsAppQrDataUrl(null);
  }, [settingsQuery.data]);

  useEffect(() => {
    if (!businessId || !settingsQuery.data?.whatsapp) {
      return;
    }
    if (settingsQuery.data.whatsapp.provider !== "baileys") {
      return;
    }
    if (whatsAppRuntimeStatus === "connected" || whatsAppRuntimeStatus === "failed") {
      return;
    }

    const interval = window.setInterval(() => {
      getWhatsAppSession(businessId)
        .then((session) => {
          setWhatsAppRuntimeStatus(session.status);
          setWhatsAppQrDataUrl(session.qrDataUrl);
        })
        .catch(() => {
          // Polling is best-effort.
        });
    }, 3000);

    return () => window.clearInterval(interval);
  }, [businessId, settingsQuery.data?.whatsapp, whatsAppRuntimeStatus]);

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["settings", businessId] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const saveAccountMutation = useMutation({
    mutationFn: () =>
      updateSettingsAccount(businessId as string, {
        fullName: accountForm.fullName,
        email: accountForm.email,
        phone: accountForm.phone || null,
        businessName: accountForm.businessName,
        currency: accountForm.currency,
      }),
    onSuccess: () => {
      refreshAll();
      toast({ title: "החשבון עודכן" });
    },
    onError: (error) => {
      toast({
        title: "עדכון חשבון נכשל",
        description: error instanceof Error ? error.message : "שגיאה בעדכון פרטי החשבון.",
        variant: "destructive",
      });
    },
  });

  const saveAccountantMutation = useMutation({
    mutationFn: () =>
      updateSettingsAccountant(businessId as string, {
        name: accountantForm.name,
        email: accountantForm.email || null,
        phone: accountantForm.phone || null,
        firmName: accountantForm.firmName || null,
        monthlyDeliveryDay: accountantForm.monthlyDeliveryDay,
        autoMonthlyDelivery: accountantForm.autoMonthlyDelivery,
      }),
    onSuccess: () => {
      refreshAll();
      toast({ title: "פרטי רואה החשבון עודכנו" });
    },
    onError: (error) => {
      toast({
        title: "עדכון נכשל",
        description: error instanceof Error ? error.message : "שגיאה בעדכון פרטי רואה החשבון.",
        variant: "destructive",
      });
    },
  });

  const disconnectInboxMutation = useMutation({
    mutationFn: (inboxId: string) => disconnectInbox(businessId as string, inboxId),
    onSuccess: () => {
      refreshAll();
      toast({ title: "התיבה נותקה בהצלחה" });
    },
    onError: (error) => {
      toast({
        title: "ניתוק תיבה נכשל",
        description: error instanceof Error ? error.message : "אירעה שגיאה בניתוק התיבה.",
        variant: "destructive",
      });
    },
  });

  const connectImapMutation = useMutation({
    mutationFn: () => connectInbox({ businessId: businessId as string, provider: "imap" }),
    onSuccess: () => {
      refreshAll();
      toast({ title: "תיבת IMAP נוספה" });
    },
    onError: (error) => {
      toast({
        title: "חיבור IMAP נכשל",
        description: error instanceof Error ? error.message : "אירעה שגיאה בחיבור IMAP.",
        variant: "destructive",
      });
    },
  });

  const connectWhatsAppMutation = useMutation({
    mutationFn: () =>
      connectWhatsAppIntegration({
        businessId: businessId as string,
        phoneE164: whatsAppPhone,
        customerName: whatsAppName || undefined,
      }),
    onSuccess: (response) => {
      refreshAll();
      setWhatsAppRuntimeStatus(response.session?.status ?? response.integration?.status ?? null);
      setWhatsAppQrDataUrl(response.session?.qrDataUrl ?? null);
      toast({
        title: "WhatsApp status updated",
        description: response.session?.lastError ?? response.integration?.lastError ?? "Connection saved.",
        variant: (response.session?.status ?? response.integration?.status) === "failed" ? "destructive" : "default",
      });
    },
    onError: (error) => {
      toast({
        title: "WhatsApp connection failed",
        description: error instanceof Error ? error.message : "An unexpected WhatsApp error occurred.",
        variant: "destructive",
      });
    },
  });

  const startOAuth = async (provider: "gmail" | "outlook") => {
    try {
      const response = await getOAuthStartUrl(businessId as string, provider);
      window.location.href = response.authUrl;
    } catch (error) {
      toast({
        title: "התחלת OAuth נכשלה",
        description: error instanceof Error ? error.message : "לא הצלחנו להתחיל תהליך OAuth.",
        variant: "destructive",
      });
    }
  };

  if (!businessId) {
    return <Navigate to="/onboarding" replace />;
  }

  const data = settingsQuery.data;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-20 pb-8">
        <div className="container mx-auto px-4">
          <div className="mb-8">
            <h1 className="font-display text-2xl md:text-3xl font-bold text-foreground">הגדרות</h1>
            <p className="text-muted-foreground">נהל את החשבון, תיבות הדואר וההעדפות שלך.</p>
          </div>

          <div className="flex flex-col lg:flex-row gap-6">
            <div className="lg:w-64 flex-shrink-0">
              <nav className="bg-card rounded-xl shadow-card border border-border p-2 space-y-1">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      activeTab === tab.id
                        ? "bg-coral text-accent-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                    }`}
                  >
                    <tab.icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                ))}
              </nav>
            </div>

            <div className="flex-1 min-w-0">
              <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                {!data && <div className="text-sm text-muted-foreground">טוען הגדרות...</div>}

                {data && activeTab === "account" && (
                  <div className="space-y-6">
                    <SettingsCard title="פרטים אישיים">
                      <div className="grid sm:grid-cols-2 gap-4">
                        <Field label="שם מלא">
                          <Input value={accountForm.fullName} onChange={(event) => setAccountForm((prev) => ({ ...prev, fullName: event.target.value }))} className="h-11" />
                        </Field>
                        <Field label="אימייל">
                          <Input value={accountForm.email} onChange={(event) => setAccountForm((prev) => ({ ...prev, email: event.target.value }))} className="h-11" />
                        </Field>
                        <Field label="טלפון">
                          <Input value={accountForm.phone} onChange={(event) => setAccountForm((prev) => ({ ...prev, phone: event.target.value }))} className="h-11" />
                        </Field>
                        <Field label="שם העסק">
                          <Input value={accountForm.businessName} onChange={(event) => setAccountForm((prev) => ({ ...prev, businessName: event.target.value }))} className="h-11" />
                        </Field>
                      </div>
                      <div className="mt-4 flex items-center gap-3">
                        <Field label="מטבע">
                          <Input value={accountForm.currency} onChange={(event) => setAccountForm((prev) => ({ ...prev, currency: event.target.value }))} className="h-11 w-36" />
                        </Field>
                        <Button variant="coral" className="mt-6" onClick={() => saveAccountMutation.mutate()} disabled={saveAccountMutation.isPending}>
                          {saveAccountMutation.isPending ? "שומר..." : "שמור שינויים"}
                        </Button>
                      </div>
                    </SettingsCard>
                  </div>
                )}

                {data && activeTab === "inboxes" && (
                  <div className="space-y-6">
                    <SettingsCard
                      title="חשבונות מייל מחוברים"
                      action={
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => startOAuth("gmail")}>Gmail OAuth</Button>
                          <Button variant="outline" size="sm" onClick={() => startOAuth("outlook")}>Outlook OAuth</Button>
                          <Button variant="coral" size="sm" onClick={() => connectImapMutation.mutate()}><Plus className="w-4 h-4" /> הוסף IMAP</Button>
                        </div>
                      }
                    >
                      <div className="space-y-3">
                        {data.inboxes.map((inbox) => (
                          <div key={inbox.id} className="flex items-center gap-4 p-4 bg-secondary/50 rounded-xl">
                            <div className="w-10 h-10 rounded-lg bg-card flex items-center justify-center border border-border">
                              <Mail className="w-5 h-5 text-coral" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-foreground">{inbox.email}</p>
                              <p className="text-xs text-muted-foreground">
                                {providerLabel[inbox.provider] ?? inbox.provider} · {inbox.authMethod ?? "manual"} · {inbox.invoicesFound ?? 0} חשבוניות
                              </p>
                            </div>
                            <span className={`px-2 py-1 rounded-md text-xs font-medium ${inbox.status === "connected" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                              {inbox.status === "connected" ? "מחובר" : inbox.status}
                            </span>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => disconnectInboxMutation.mutate(inbox.id)} disabled={disconnectInboxMutation.isPending}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        ))}
                        {data.inboxes.length === 0 && <p className="text-sm text-muted-foreground">עדיין לא חוברו תיבות דואר.</p>}
                      </div>
                    </SettingsCard>
                  </div>
                )}

                {data && activeTab === "accountant" && (
                  <div className="space-y-6">
                    <SettingsCard title="רואה החשבון שלך">
                      <div className="grid sm:grid-cols-2 gap-4">
                        <Field label="שם רואה החשבון">
                          <Input value={accountantForm.name} onChange={(event) => setAccountantForm((prev) => ({ ...prev, name: event.target.value }))} className="h-11" />
                        </Field>
                        <Field label="אימייל">
                          <Input value={accountantForm.email} onChange={(event) => setAccountantForm((prev) => ({ ...prev, email: event.target.value }))} className="h-11" />
                        </Field>
                        <Field label="טלפון / וואטסאפ">
                          <Input value={accountantForm.phone} onChange={(event) => setAccountantForm((prev) => ({ ...prev, phone: event.target.value }))} className="h-11" />
                        </Field>
                        <Field label="שם המשרד">
                          <Input value={accountantForm.firmName} onChange={(event) => setAccountantForm((prev) => ({ ...prev, firmName: event.target.value }))} className="h-11" />
                        </Field>
                      </div>
                      <div className="flex items-center gap-4 mt-4">
                        <Field label="יום שליחה חודשי">
                          <Input type="number" min={1} max={28} value={accountantForm.monthlyDeliveryDay} onChange={(event) => setAccountantForm((prev) => ({ ...prev, monthlyDeliveryDay: Number(event.target.value) || 3 }))} className="h-11 w-28" />
                        </Field>
                        <div className="mt-6 flex items-center gap-2">
                          <Switch checked={accountantForm.autoMonthlyDelivery} onCheckedChange={(checked) => setAccountantForm((prev) => ({ ...prev, autoMonthlyDelivery: checked }))} />
                          <span className="text-sm text-foreground">שליחה אוטומטית</span>
                        </div>
                        <Button variant="coral" className="mt-6" onClick={() => saveAccountantMutation.mutate()} disabled={saveAccountantMutation.isPending}>
                          {saveAccountantMutation.isPending ? "שומר..." : "שמור שינויים"}
                        </Button>
                      </div>
                    </SettingsCard>
                  </div>
                )}

                {data && activeTab === "integrations" && (
                  <div className="space-y-6">
                    <SettingsCard title="סטטוס אינטגרציות">
                      <div className="grid sm:grid-cols-2 gap-3">
                        {data.integrations.map((integration) => (
                          <div key={integration.name} className={`flex items-center justify-between p-4 rounded-xl border ${integration.connected ? "border-success/30 bg-success/5" : "border-border"}`}>
                            <p className="font-medium text-foreground">{integration.name}</p>
                            <span className={`text-xs font-medium ${integration.connected ? "text-success" : "text-muted-foreground"}`}>
                              {integration.connected ? "מחובר" : "לא מחובר"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </SettingsCard>

                    <SettingsCard title="WhatsApp">
                      <div className="grid sm:grid-cols-2 gap-4">
                        <Field label="Main number (E.164)">
                          <Input value={whatsAppPhone} onChange={(event) => setWhatsAppPhone(event.target.value)} placeholder="+972501234567" className="h-11" />
                        </Field>
                        <Field label="Contact name">
                          <Input value={whatsAppName} onChange={(event) => setWhatsAppName(event.target.value)} placeholder="Owner name" className="h-11" />
                        </Field>
                      </div>
                      {whatsAppQrDataUrl && data.whatsapp?.provider === "baileys" && (
                        <div className="mt-4">
                          <img src={whatsAppQrDataUrl} alt="WhatsApp QR" className="w-44 h-44 rounded-lg border border-border bg-white p-2" />
                          <p className="text-xs text-muted-foreground mt-2">
                            Scan with WhatsApp, then open Linked devices and tap Link a device.
                          </p>
                        </div>
                      )}
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <Button variant="coral" onClick={() => connectWhatsAppMutation.mutate()} disabled={connectWhatsAppMutation.isPending}>
                          {connectWhatsAppMutation.isPending ? "Connecting..." : "Connect WhatsApp"}
                        </Button>
                        <span className="text-sm text-muted-foreground">
                          Status: {whatsAppRuntimeStatus ?? data.whatsapp?.status ?? "idle"} {data.whatsapp?.lastError ? `· ${data.whatsapp.lastError}` : ""}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          Provider: {data.whatsapp?.provider ?? "unknown"}
                        </span>
                      </div>
                    </SettingsCard>
                  </div>
                )}

                {data && activeTab === "notifications" && (
                  <SettingsCard title="התראות">
                    <p className="text-sm text-muted-foreground">טאב התראות נשאר במצב תצוגה כרגע. נתוני החשבון, התיבות, הרו״ח והאינטגרציות כבר מחוברים ל-API.</p>
                  </SettingsCard>
                )}

                {data && activeTab === "billing" && (
                  <SettingsCard title="חיוב ותוכנית">
                    <p className="text-sm text-muted-foreground">טאב חיוב נשאר תצוגה בלבד בשלב זה.</p>
                  </SettingsCard>
                )}
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const SettingsCard = ({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) => (
  <div className="bg-card rounded-xl shadow-card border border-border p-6">
    <div className="flex items-center justify-between mb-4">
      <h2 className="font-display font-semibold text-lg text-foreground">{title}</h2>
      {action}
    </div>
    {children}
  </div>
);

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <label className="text-sm font-medium text-foreground mb-1.5 block">{label}</label>
    {children}
  </div>
);

export default SettingsPage;

