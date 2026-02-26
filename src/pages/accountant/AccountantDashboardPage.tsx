import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Users, LogOut, FileText, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAccountantClients, type AccountantClient } from "@/lib/accountant-api";
import { clearAccountantSession, getAccountantEmail, isAccountantLoggedIn } from "@/lib/accountant-session";

const healthColors: Record<string, { bg: string; text: string; label: string }> = {
  green: { bg: "bg-success/10", text: "text-success", label: "תקין" },
  yellow: { bg: "bg-warning/10", text: "text-warning", label: "ממתין" },
  red: { bg: "bg-coral-light", text: "text-coral", label: "דורש טיפול" },
};

const AccountantDashboardPage = () => {
  const navigate = useNavigate();
  const email = getAccountantEmail();

  if (!isAccountantLoggedIn()) {
    navigate("/accountant", { replace: true });
    return null;
  }

  const clientsQuery = useQuery({
    queryKey: ["accountant", "clients"],
    queryFn: getAccountantClients,
  });

  const clients = clientsQuery.data?.clients ?? [];

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl gradient-coral flex items-center justify-center">
              <Users className="w-5 h-5 text-accent-foreground" />
            </div>
            <div>
              <h1 className="font-display font-bold text-lg text-foreground">פורטל רואה חשבון</h1>
              <p className="text-xs text-muted-foreground" dir="ltr">{email}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              clearAccountantSession();
              navigate("/accountant");
            }}
          >
            <LogOut className="w-4 h-4" /> התנתק
          </Button>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <h2 className="font-display text-xl font-semibold mb-6">הלקוחות שלי ({clients.length})</h2>

        {clientsQuery.isLoading && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">טוען לקוחות...</p>
          </div>
        )}

        {!clientsQuery.isLoading && clients.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">אין לקוחות משויכים לכתובת המייל הזו עדיין.</p>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {clients.map((client) => {
            const health = healthColors[client.health] ?? healthColors.green;
            return (
              <Link
                key={client.businessId}
                to={`/accountant/clients/${client.businessId}`}
                className="bg-card rounded-xl shadow-card border border-border p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="font-display font-semibold text-foreground">{client.businessName}</h3>
                  <span className={`px-2 py-1 rounded-md text-xs font-medium ${health.bg} ${health.text}`}>
                    {health.label}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div>
                    <p className="font-bold text-foreground">{client.totalCount}</p>
                    <p className="text-xs text-muted-foreground">סה״כ</p>
                  </div>
                  <div>
                    <p className="font-bold text-warning">{client.pendingCount}</p>
                    <p className="text-xs text-muted-foreground">ממתין</p>
                  </div>
                  <div>
                    <p className="font-bold text-success">{client.sentCount}</p>
                    <p className="text-xs text-muted-foreground">נשלח</p>
                  </div>
                </div>
                <div className="flex items-center justify-end mt-3 text-xs text-muted-foreground">
                  צפה בפרטים <ChevronLeft className="w-3 h-3 mr-1" />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default AccountantDashboardPage;
