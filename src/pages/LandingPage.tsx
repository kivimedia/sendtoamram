import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Mail, MessageCircle, Zap, Shield, BarChart3, Users, Check, ArrowLeft, Star } from "lucide-react";
import Navbar from "@/components/Navbar";
import heroImg from "@/assets/hero-illustration.png";

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.6 },
};

const stagger = {
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
};

const features = [
  { icon: Mail, title: "סריקת מספר תיבות דואר", desc: "חבר תיבות Gmail, Outlook ו-IMAP ללא הגבלה. אנחנו סורקים את כולן." },
  { icon: MessageCircle, title: "בוט AI בוואטסאפ", desc: "צלם קבלות, שאל שאלות, קבל תשובות מיידיות. הכל בוואטסאפ." },
  { icon: Zap, title: "הגדרה ב-60 שניות", desc: "חבר מייל, ספר לנו את שם רואה החשבון שלך. זהו. סיימנו." },
  { icon: Shield, title: "תואם מס ישראלי", desc: "מספרי הקצאה, דוחות מע״מ, OCR בעברית. בנוי לישראל." },
  { icon: BarChart3, title: "דוחות חכמים", desc: "סיכומי הוצאות חודשיים נשלחים אוטומטית לרואה החשבון שלך." },
  { icon: Users, title: "חינם לרואי חשבון", desc: "ניהול לקוחות ללא הגבלה. ראה מי ירוק, צהוב, אדום. ללא עלות." },
];

const steps = [
  { num: "1", title: "ספר לנו את שם רואה החשבון שלך", desc: "אנחנו מתאימים הכל סביב העמרם שלך." },
  { num: "2", title: "חבר את המייל שלך", desc: "לחיצה אחת OAuth. Gmail, Outlook, מה שלא תשתמש." },
  { num: "3", title: "זהו. ברצינות.", desc: "אנחנו מוצאים את החשבוניות שלך ושולחים לרואה החשבון. אוטומטית." },
];

const pricing = [
  { name: "חינם", price: "$0", period: "/לתמיד", features: ["2 חשבונות מייל", "50 מסמכים/חודש", "בוט וואטסאפ", "דוחות בסיסיים"], cta: "התחל בחינם", popular: false },
  { name: "פרו", price: "$15", period: "/חודש", features: ["10 חשבונות מייל", "מסמכים ללא הגבלה", "שאילתות AI בוואטסאפ", "דוחות מתקדמים", "כל האינטגרציות"], cta: "שדרג לפרו", popular: true },
  { name: "עסקי", price: "$39", period: "/חודש", features: ["תיבות דואר ללא הגבלה", "צוות ללא הגבלה", "תמיכה עדיפה", "קטגוריות מותאמות", "White-label"], cta: "צור קשר", popular: false },
];

const testimonials = [
  { name: "יעל כ.", role: "מעצבת פרילנס", text: "הייתי מבזבזת 3 שעות בחודש על איסוף קבלות. עכשיו? אפס. סיגל מקבלת הכל אוטומטית.", stars: 5 },
  { name: "משה ר.", role: "בעל סוכנות", text: "12 אנשי צוות, אפס רדיפה אחרי קבלות. דבורה באמת הודתה לי בפעם הראשונה אחרי 8 שנים.", stars: 5 },
  { name: "עמרם ל.", role: "רו״ח", text: "כן, שמי הוא באמת עמרם. וכן, המוצר הזה שינה לי את החיים. 80 לקוחות, אפס רדיפות.", stars: 5 },
];

const LandingPage = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Hero */}
      <section className="pt-24 pb-16 md:pt-32 md:pb-24">
        <div className="container mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <motion.div {...fadeUp}>
              <div className="inline-flex items-center gap-2 bg-coral-light text-coral-dark rounded-full px-4 py-1.5 text-sm font-medium mb-6">
                <Zap className="w-4 h-4" /> החשבוניות שלך, באוטופילוט
              </div>
              <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-6">
                עמרם מחכה לחשבוניות שלך.{" "}
                <span className="text-gradient-coral">אנחנו נשלח אותן.</span>
              </h1>
              <p className="text-lg text-muted-foreground mb-8 max-w-lg">
                חבר את המייל שלך. ספר לנו את שם רואה החשבון שלך. אל תחשוב יותר על קבלות. AI מוצא, מארגן ומעביר את החשבוניות שלך אוטומטית.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Link to="/onboarding">
                  <Button variant="hero">
                    מי העמרם שלך? <ArrowLeft className="w-5 h-5" />
                  </Button>
                </Link>
                <a href="#how-it-works">
                  <Button variant="hero-outline">ראה איך זה עובד</Button>
                </a>
              </div>
              <div className="flex items-center gap-6 mt-8 text-sm text-muted-foreground">
                <span className="flex items-center gap-1"><Check className="w-4 h-4 text-success" /> חינם להתחלה</span>
                <span className="flex items-center gap-1"><Check className="w-4 h-4 text-success" /> הגדרה ב-60 שניות</span>
                <span className="flex items-center gap-1"><Check className="w-4 h-4 text-success" /> ללא כרטיס אשראי</span>
              </div>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="relative"
            >
              <img src={heroImg} alt="AI מארגן חשבוניות ממיילים" className="rounded-2xl shadow-elevated w-full" />
              {/* Floating stat card */}
              <motion.div
                animate={{ y: [0, -8, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                className="absolute -bottom-4 -right-4 bg-card rounded-xl shadow-elevated p-4 border border-border"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center">
                    <Check className="w-5 h-5 text-success" />
                  </div>
                  <div>
                    <p className="font-display font-bold text-foreground">נמצאו 47 חשבוניות</p>
                    <p className="text-sm text-muted-foreground">מוכנות לשליחה לסיגל</p>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 bg-secondary/50">
        <div className="container mx-auto px-4">
          <motion.div {...fadeUp} className="text-center mb-16">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-4">
              כל מה שרואה החשבון שלך היה רוצה שיהיה לך
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              תפסיק לרדוף אחרי קבלות. תפסיק להילחם עם גיליונות אלקטרוניים. תן ל-AI לטפל בדברים המשעממים.
            </p>
          </motion.div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                {...stagger}
                transition={{ delay: i * 0.1, duration: 0.5 }}
                className="bg-card rounded-xl p-6 shadow-card hover:shadow-card-hover transition-shadow duration-300 border border-border"
              >
                <div className="w-12 h-12 rounded-xl bg-coral-light flex items-center justify-center mb-4">
                  <f.icon className="w-6 h-6 text-coral" />
                </div>
                <h3 className="font-display font-semibold text-lg text-foreground mb-2">{f.title}</h3>
                <p className="text-muted-foreground">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-20">
        <div className="container mx-auto px-4">
          <motion.div {...fadeUp} className="text-center mb-16">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-4">
              שלושה צעדים. שישים שניות. סיימנו.
            </h2>
          </motion.div>
          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {steps.map((s, i) => (
              <motion.div key={s.num} {...stagger} transition={{ delay: i * 0.15, duration: 0.5 }} className="text-center">
                <div className="w-16 h-16 rounded-full gradient-coral flex items-center justify-center mx-auto mb-4 shadow-coral">
                  <span className="font-display font-bold text-2xl text-accent-foreground">{s.num}</span>
                </div>
                <h3 className="font-display font-semibold text-lg text-foreground mb-2">{s.title}</h3>
                <p className="text-muted-foreground">{s.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-20 bg-secondary/50">
        <div className="container mx-auto px-4">
          <motion.div {...fadeUp} className="text-center mb-16">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-4">
              אנשים אוהבים לשלוח לעמרם
            </h2>
          </motion.div>
          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {testimonials.map((t, i) => (
              <motion.div key={t.name} {...stagger} transition={{ delay: i * 0.1, duration: 0.5 }}
                className="bg-card rounded-xl p-6 shadow-card border border-border"
              >
                <div className="flex gap-1 mb-3">
                  {Array.from({ length: t.stars }).map((_, j) => (
                    <Star key={j} className="w-4 h-4 fill-warning text-warning" />
                  ))}
                </div>
                <p className="text-foreground mb-4 italic">"{t.text}"</p>
                <div>
                  <p className="font-display font-semibold text-foreground">{t.name}</p>
                  <p className="text-sm text-muted-foreground">{t.role}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20">
        <div className="container mx-auto px-4">
          <motion.div {...fadeUp} className="text-center mb-16">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-4">
              תמחור פשוט. בלי הפתעות.
            </h2>
            <p className="text-lg text-muted-foreground">רואי חשבון? תמיד בחינם. לקוחות ללא הגבלה. ברצינות.</p>
          </motion.div>
          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {pricing.map((p, i) => (
              <motion.div key={p.name} {...stagger} transition={{ delay: i * 0.1, duration: 0.5 }}
                className={`rounded-xl p-8 border ${p.popular ? "border-coral shadow-coral bg-card relative" : "border-border bg-card shadow-card"}`}
              >
                {p.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 gradient-coral text-accent-foreground text-xs font-bold px-4 py-1 rounded-full">
                    הכי פופולרי
                  </div>
                )}
                <h3 className="font-display font-bold text-xl text-foreground mb-2">{p.name}</h3>
                <div className="mb-6">
                  <span className="font-display font-bold text-4xl text-foreground">{p.price}</span>
                  <span className="text-muted-foreground">{p.period}</span>
                </div>
                <ul className="space-y-3 mb-8">
                  {p.features.map(f => (
                    <li key={f} className="flex items-center gap-2 text-foreground">
                      <Check className="w-4 h-4 text-success flex-shrink-0" /> {f}
                    </li>
                  ))}
                </ul>
                <Link to="/onboarding">
                  <Button variant={p.popular ? "coral" : "outline"} className="w-full">
                    {p.cta}
                  </Button>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <motion.div {...fadeUp} className="gradient-hero rounded-2xl p-12 md:p-16 text-center">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-primary-foreground mb-4">
              העמרם שלך מחכה. אל תשאיר אותו תלוי.
            </h2>
            <p className="text-primary-foreground/70 text-lg mb-8 max-w-xl mx-auto">
              חבר את המייל שלך ב-60 שניות. רואה החשבון שלך יודה לך. כנראה בפעם הראשונה אי פעם.
            </p>
            <Link to="/onboarding">
              <Button variant="hero" className="bg-coral">
                התחל בחינם <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-border">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg gradient-coral flex items-center justify-center">
                <span className="text-accent-foreground font-display font-bold text-xs">S</span>
              </div>
              <span className="font-display font-bold text-foreground">SendTo<span className="text-coral">Amram</span></span>
            </div>
            <div className="flex gap-6 text-sm text-muted-foreground">
              <a href="#" className="hover:text-foreground transition-colors">פרטיות</a>
              <a href="#" className="hover:text-foreground transition-colors">תנאי שימוש</a>
              <a href="#" className="hover:text-foreground transition-colors">צור קשר</a>
            </div>
            <p className="text-sm text-muted-foreground">© 2026 SendToAmram. נוצר בישראל 🇮🇱</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;