import { appPaths } from "./paths";

export type NavigationItem = {
  to: string;
  label: string;
};

export const navigationItems: NavigationItem[] = [
  { to: appPaths.dashboard, label: "לוח בקרה" },
  { to: appPaths.draws, label: "היסטוריית הגרלות" },
  { to: appPaths.frequency, label: "תדירות מספרים" },
  { to: appPaths.strongNumber, label: "סטטיסטיקת מספר חזק" },
  { to: appPaths.pairs, label: "ניתוח זוגות" },
  { to: appPaths.snapshots, label: "ניהול Snapshot" },
  { to: appPaths.health, label: "בריאות מערכת" },
];

