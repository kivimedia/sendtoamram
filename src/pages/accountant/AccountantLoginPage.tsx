import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sendMagicLink } from "@/lib/accountant-api";
import { isAccountantLoggedIn } from "@/lib/accountant-session";

const AccountantLoginPage = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // If already logged in, redirect to dashboard
  if (isAccountantLoggedIn()) {
    navigate("/accountant/dashboard", { replace: true });
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setLoading(true);
    setError("");

    try {
      await sendMagicLink(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה בשליחת הקישור");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4" dir="rtl">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl gradient-coral flex items-center justify-center mx-auto mb-4">
            <Mail className="w-8 h-8 text-accent-foreground" />
          </div>
          <h1 className="font-display text-2xl font-bold text-foreground">פורטל רואה חשבון</h1>
          <p className="text-muted-foreground mt-2">SendToAmram</p>
        </div>

        <div className="bg-card rounded-xl shadow-card border border-border p-6">
          {!sent ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground block mb-1">
                  כתובת מייל
                </label>
                <Input
                  type="email"
                  placeholder="accountant@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="text-left"
                  dir="ltr"
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                type="submit"
                variant="coral"
                className="w-full"
                disabled={loading || !email.trim()}
              >
                {loading ? "שולח..." : "שלח קישור כניסה"}
              </Button>
            </form>
          ) : (
            <div className="text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mx-auto">
                <Mail className="w-6 h-6 text-success" />
              </div>
              <div>
                <h3 className="font-display font-semibold text-foreground">הקישור נשלח!</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  בדוק/י את תיבת המייל שלך ב-<strong dir="ltr">{email}</strong>
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  הקישור תקף ל-15 דקות.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSent(false);
                  setEmail("");
                }}
              >
                שלח שוב
              </Button>
            </div>
          )}
        </div>

        <div className="text-center mt-6">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
            <ArrowLeft className="w-4 h-4" /> חזרה לעמוד הראשי
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AccountantLoginPage;
