export const PDF_SCAN_CONSENT_REQUIRED = "pdf_scan_consent_required";
const changeEvent = "plancatch:pdf-scan-consent";
const key = (userId: string) => `plancatch:pdf-scan-consent:v1:${userId}`;

export function hasPdfScanConsent(userId: string | undefined) {
  try {
    return Boolean(userId && localStorage.getItem(key(userId)) === "yes");
  } catch {
    return false;
  }
}

export function setPdfScanConsent(userId: string, remember: boolean) {
  try {
    if (remember) localStorage.setItem(key(userId), "yes");
    else localStorage.removeItem(key(userId));
    window.dispatchEvent(new Event(changeEvent));
  } catch {
    // If browser storage is unavailable, each scan requires fresh consent.
  }
}

export function subscribePdfScanConsent(onChange: () => void) {
  window.addEventListener(changeEvent, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(changeEvent, onChange);
    window.removeEventListener("storage", onChange);
  };
}
