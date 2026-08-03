export type RoomCategory =
  | "romantic"
  | "pamper"
  | "party"
  | "games"
  | "cinema"
  | "vacation";

export interface Room {
  id: string;
  category: RoomCategory;
  title: string;
  subtitle: string;
  description: string;
  icon: string;
  image: string;
  locked?: boolean;
  isNew?: boolean;
  premium?: boolean;
}

export const CATEGORIES: {
  id: RoomCategory;
  title: string;
  subtitle: string;
  icon: string;
  image: string;
}[] = [
  {
    id: "romantic",
    title: "חדר רומנטי",
    subtitle: "אווירה אינטימית ורגעים שורפים",
    icon: "♡",
    image:
      "https://images.unsplash.com/photo-1616594039964-ae9021a400a0?auto=format&fit=crop&w=800&q=80",
  },
  {
    id: "pamper",
    title: "חדר פינוק",
    subtitle: "רוגע, ספא ופינוק מושלם",
    icon: "❀",
    image:
      "https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=800&q=80",
  },
  {
    id: "party",
    title: "חדר מסיבה",
    subtitle: "מוזיקה, אורות ואדרנלין",
    icon: "✦",
    image:
      "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=800&q=80",
  },
  {
    id: "games",
    title: "חדר משחקים",
    subtitle: "משחקי תפקידים וחידות",
    icon: "◐",
    image:
      "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=800&q=80",
  },
  {
    id: "cinema",
    title: "חדר קולנוע",
    subtitle: "שב, תהנה ותן להפתעות לקרות",
    icon: "▶",
    image:
      "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=800&q=80",
  },
  {
    id: "vacation",
    title: "חדר חופשה",
    subtitle: "בריחה מהשגרה לחוויה חלומית",
    icon: "☀",
    image:
      "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80",
  },
];

export const ROOMS: Room[] = [
  {
    id: "romantic-1",
    category: "romantic",
    title: "חדר רומנטי",
    subtitle: "אווירה אינטימית ורגעים שורפים",
    description: "נרות, ורדים ותאורה רכה — חוויה זוגית בלתי נשכחת.",
    icon: "♡",
    image: CATEGORIES[0].image,
  },
  {
    id: "pamper-1",
    category: "pamper",
    title: "חדר פינוק",
    subtitle: "רוגע, ספא ופינוק מושלם",
    description: "ג'קוזי, ניחוחות ושקט מוחלט — הזמן שלך להתפנק.",
    icon: "❀",
    image: CATEGORIES[1].image,
    isNew: true,
  },
  {
    id: "party-1",
    category: "party",
    title: "חדר מסיבה",
    subtitle: "מוזיקה, אורות ואדרנלין",
    description: "דיסקו, אורות סגול ואווירה שמרימה את האנרגיה.",
    icon: "✦",
    image: CATEGORIES[2].image,
  },
  {
    id: "games-1",
    category: "games",
    title: "חדר משחקים",
    subtitle: "לשחק, לגרות ולגלות צדדים חדשים",
    description: "חידות, משחקי תפקידים והפתעות שמחכות מאחורי הדלת.",
    icon: "◐",
    image: CATEGORIES[3].image,
  },
  {
    id: "cinema-1",
    category: "cinema",
    title: "חדר קולנוע",
    subtitle: "שקט, רגיעה והפתעות על המסך",
    description: "קולנוע ביתי עם תוכן מותאם במיוחד עבורך.",
    icon: "▶",
    image: CATEGORIES[4].image,
    isNew: true,
  },
  {
    id: "vacation-1",
    category: "vacation",
    title: "חדר חופשה",
    subtitle: "חוויה בטבע ותחושת חופש",
    description: "אווירת חוף וחופש — בלי לצאת מהעיר.",
    icon: "☀",
    image: CATEGORIES[5].image,
  },
  {
    id: "gourmet-1",
    category: "pamper",
    title: "חדר אוכל גורמה",
    subtitle: "טעמים, ניחוחות ופינוק חושי",
    description: "חוויית טעימות זוגית עם הפתעות קולינריות.",
    icon: "◈",
    image:
      "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=800&q=80",
    isNew: true,
    premium: true,
  },
  {
    id: "luxury-1",
    category: "vacation",
    title: "חדר יוקרתי",
    subtitle: "יוקרה, סטייל ובלתי נשכח",
    description: "וילה, בריכה ותחושת פרימיום מלאה.",
    icon: "♛",
    image:
      "https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=800&q=80",
    premium: true,
    locked: true,
  },
];

export const POINT_ACTIONS = [
  { id: "open_room", label: "פתיחת חדר", points: 100 },
  { id: "share", label: "שיתוף חוויה", points: 50 },
  { id: "invite", label: "הזמנת חבר/ה", points: 200 },
  { id: "daily", label: "חדר יומי", points: 150 },
  { id: "chat", label: "שיחה בצ'אט", points: 30 },
] as const;

export const ACHIEVEMENTS = [
  { id: "lover", title: "אוהב/ת חוויות", icon: "♡" },
  { id: "explorer", title: "מגלה עולמות", icon: "✧" },
  { id: "legend", title: "אגדה", icon: "♛" },
] as const;

export function getRoomById(id: string): Room | undefined {
  return ROOMS.find((room) => room.id === id);
}

export function getRoomsByCategory(category: RoomCategory): Room[] {
  return ROOMS.filter((room) => room.category === category);
}

export function pickSurpriseRoom(excludeIds: string[] = []): Room {
  const unlocked = ROOMS.filter(
    (room) => !room.locked && !excludeIds.includes(room.id),
  );
  const pool = unlocked.length > 0 ? unlocked : ROOMS.filter((r) => !r.locked);
  return pool[Math.floor(Math.random() * pool.length)] ?? ROOMS[0];
}
