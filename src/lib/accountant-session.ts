const ACCOUNTANT_TOKEN_KEY = "sendtoamram.accountantToken";
const ACCOUNTANT_EMAIL_KEY = "sendtoamram.accountantEmail";

export function getAccountantToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACCOUNTANT_TOKEN_KEY);
}

export function getAccountantEmail(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACCOUNTANT_EMAIL_KEY);
}

export function setAccountantSession(token: string, email: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACCOUNTANT_TOKEN_KEY, token);
  window.localStorage.setItem(ACCOUNTANT_EMAIL_KEY, email);
}

export function clearAccountantSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ACCOUNTANT_TOKEN_KEY);
  window.localStorage.removeItem(ACCOUNTANT_EMAIL_KEY);
}

export function isAccountantLoggedIn(): boolean {
  return Boolean(getAccountantToken());
}
