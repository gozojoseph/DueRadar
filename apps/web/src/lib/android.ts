// Google Play build detection for the TWA wrapper.
//
// The Play Store build's start_url is "/?src=play". The first launch carries the
// param; we persist a localStorage flag so later launches (which do not carry
// it) keep hiding the web payment UI. Google Play's Payments policy disallows
// offering external (non-Play-Billing) purchases from within the app, and
// Paystack checkout is not enrolled in an external-offers program in Ghana.
const FLAG = "dueradar.androidApp";

export function markAndroidApp(): void {
  try {
    localStorage.setItem(FLAG, "1");
  } catch {
    // localStorage unavailable (e.g. blocked storage); nothing to persist.
  }
}

export function isAndroidApp(): boolean {
  try {
    return localStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}
