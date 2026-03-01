import { Check, Clock, AlertTriangle, X } from "lucide-react";

export const statusConfig: Record<string, { label: string; className: string; icon: typeof Check }> = {
  sent: { label: "נשלח", className: "bg-success/10 text-success", icon: Check },
  pending: { label: "ממתין", className: "bg-warning/10 text-warning", icon: Clock },
  review: { label: "לבדיקה", className: "bg-coral-light text-coral", icon: AlertTriangle },
  ignored: { label: "התעלם", className: "bg-muted text-muted-foreground", icon: X },
};

export const sourceIcons: Record<string, string> = {
  gmail: "📧",
  outlook: "📬",
  imap: "✉️",
  whatsapp: "💬",
};

export function formatAmount(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || cents === 0) return "ממתין לחילוץ";
  return `₪${(cents / 100).toLocaleString("he-IL", { maximumFractionDigits: 0 })}`;
}

export function formatAmountShort(cents: number): string {
  if (cents === 0) return "₪0";
  return `₪${(cents / 100).toLocaleString("he-IL", { maximumFractionDigits: 0 })}`;
}

export function formatDate(dateIso: string): string {
  return new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "short", year: "numeric" }).format(new Date(dateIso));
}

export const CATEGORY_COLORS: Record<string, string> = {
  "תוכנה": "hsl(220, 70%, 55%)",
  "ענן ואחסון": "hsl(200, 75%, 50%)",
  "פרסום": "hsl(15, 85%, 55%)",
  "שיווק": "hsl(50, 80%, 50%)",
  "תקשורת": "hsl(170, 65%, 42%)",
  "משרד": "hsl(160, 60%, 45%)",
  "ציוד": "hsl(30, 80%, 55%)",
  "נסיעות": "hsl(340, 70%, 55%)",
  "מזון": "hsl(8, 75%, 55%)",
  "שכירות": "hsl(260, 55%, 55%)",
  "ביטוח": "hsl(240, 50%, 60%)",
  "חשבונות": "hsl(280, 60%, 55%)",
  "ייעוץ": "hsl(300, 50%, 50%)",
  "לימודים": "hsl(140, 60%, 45%)",
  "רישיונות": "hsl(80, 55%, 45%)",
  "בנקאות": "hsl(100, 40%, 50%)",
  "מקצועי": "hsl(190, 60%, 45%)",
  "כללי": "hsl(0, 0%, 60%)",
};

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? `hsl(${hashString(category) % 360}, 55%, 50%)`;
}
