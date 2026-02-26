import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, AlertTriangle, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { verifyMagicLink } from "@/lib/accountant-api";
import { setAccountantSession } from "@/lib/accountant-session";

const AccountantVerifyPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setError("קישור לא תקין, חסר טוקן.");
      return;
    }

    verifyMagicLink(token)
      .then((result) => {
        setAccountantSession(result.token, result.email);
        setStatus("success");
        setTimeout(() => navigate("/accountant/dashboard", { replace: true }), 1500);
      })
      .catch((err) => {
        setStatus("error");
        setError(err instanceof Error ? err.message : "אימות נכשל");
      });
  }, [token, navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4" dir="rtl">
      <div className="w-full max-w-sm text-center">
        {status === "loading" && (
          <div className="space-y-4">
            <Loader2 className="w-12 h-12 text-coral mx-auto animate-spin" />
            <p className="text-foreground font-medium">מאמת כניסה...</p>
          </div>
        )}
        {status === "success" && (
          <div className="space-y-4">
            <CheckCircle className="w-12 h-12 text-success mx-auto" />
            <p className="text-foreground font-medium">נכנסת בהצלחה!</p>
            <p className="text-sm text-muted-foreground">מעביר לדשבורד...</p>
          </div>
        )}
        {status === "error" && (
          <div className="space-y-4">
            <AlertTriangle className="w-12 h-12 text-destructive mx-auto" />
            <p className="text-foreground font-medium">אימות נכשל</p>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="coral" onClick={() => navigate("/accountant")}>
              נסה שוב
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AccountantVerifyPage;
