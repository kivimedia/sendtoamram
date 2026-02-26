import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import OnboardingPage from "./pages/OnboardingPage";
import DashboardPage from "./pages/DashboardPage";
import SettingsPage from "./pages/SettingsPage";
import AccountantLoginPage from "./pages/accountant/AccountantLoginPage";
import AccountantVerifyPage from "./pages/accountant/AccountantVerifyPage";
import AccountantDashboardPage from "./pages/accountant/AccountantDashboardPage";
import AccountantClientPage from "./pages/accountant/AccountantClientPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/accountant" element={<AccountantLoginPage />} />
          <Route path="/accountant/verify" element={<AccountantVerifyPage />} />
          <Route path="/accountant/dashboard" element={<AccountantDashboardPage />} />
          <Route path="/accountant/clients/:businessId" element={<AccountantClientPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
