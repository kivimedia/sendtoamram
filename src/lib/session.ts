const ACTIVE_BUSINESS_ID_KEY = "sendtoamram.activeBusinessId";

export function getActiveBusinessId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(ACTIVE_BUSINESS_ID_KEY);
}

export function setActiveBusinessId(businessId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(ACTIVE_BUSINESS_ID_KEY, businessId);
}

export function clearActiveBusinessId(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(ACTIVE_BUSINESS_ID_KEY);
}
