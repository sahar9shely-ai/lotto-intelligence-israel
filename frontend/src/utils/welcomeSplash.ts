export const WELCOME_SEEN_KEY = "tazrim_welcome_seen";

export function hasSeenWelcome(): boolean {
  try {
    return localStorage.getItem(WELCOME_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markWelcomeSeen(): void {
  try {
    localStorage.setItem(WELCOME_SEEN_KEY, "1");
  } catch {
    /* private mode */
  }
}

export function resetWelcomeSeen(): void {
  try {
    localStorage.removeItem(WELCOME_SEEN_KEY);
  } catch {
    /* private mode */
  }
}
