import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { Menu, X, User } from "lucide-react";
import { useState } from "react";
import { getAuthToken } from "@/lib/session";

const Navbar = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const isLanding = location.pathname === "/";
  const isLoggedIn = Boolean(getAuthToken());

  return (
    <motion.nav
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="fixed top-0 left-0 right-0 z-50 bg-card/80 backdrop-blur-lg border-b border-border"
    >
      <div className="container mx-auto flex items-center justify-between h-16 px-4">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg gradient-coral flex items-center justify-center">
            <span className="text-accent-foreground font-display font-bold text-sm">S</span>
          </div>
          <span className="font-display font-bold text-lg text-foreground">
            SendTo<span className="text-coral">Amram</span>
          </span>
        </Link>

        {isLanding && (
          <div className="hidden md:flex items-center gap-1">
            <a href="#features"><Button variant="nav" size="sm">תכונות</Button></a>
            <a href="#how-it-works"><Button variant="nav" size="sm">איך זה עובד</Button></a>
            <a href="#pricing"><Button variant="nav" size="sm">תמחור</Button></a>
          </div>
        )}

        <div className="hidden md:flex items-center gap-3">
          {isLoggedIn ? (
            <Link to="/dashboard">
              <Button variant="coral" size="sm" className="gap-2">
                <User className="w-4 h-4" /> דשבורד
              </Button>
            </Link>
          ) : (
            <>
              <Link to="/onboarding">
                <Button variant="coral" size="sm">התחל בחינם</Button>
              </Link>
            </>
          )}
        </div>

        <button className="md:hidden" onClick={() => setMobileOpen(!mobileOpen)}>
          {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {mobileOpen && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="md:hidden bg-card border-b border-border px-4 pb-4"
        >
          <div className="flex flex-col gap-2">
            {isLanding && (
              <>
                <a href="#features" onClick={() => setMobileOpen(false)}><Button variant="nav" className="w-full justify-start">תכונות</Button></a>
                <a href="#how-it-works" onClick={() => setMobileOpen(false)}><Button variant="nav" className="w-full justify-start">איך זה עובד</Button></a>
                <a href="#pricing" onClick={() => setMobileOpen(false)}><Button variant="nav" className="w-full justify-start">תמחור</Button></a>
              </>
            )}
            {isLoggedIn ? (
              <Link to="/dashboard" onClick={() => setMobileOpen(false)}>
                <Button variant="coral" className="w-full gap-2">
                  <User className="w-4 h-4" /> דשבורד
                </Button>
              </Link>
            ) : (
              <Link to="/onboarding" onClick={() => setMobileOpen(false)}>
                <Button variant="coral" className="w-full">התחל בחינם</Button>
              </Link>
            )}
          </div>
        </motion.div>
      )}
    </motion.nav>
  );
};

export default Navbar;
