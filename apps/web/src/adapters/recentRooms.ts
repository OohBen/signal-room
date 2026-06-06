export interface RecentRoom {
  code: string;
  title: string;
  ts: number;
}

const KEY = "signal-room.recent-rooms.v1";
const MAX = 12;

export function getRecentRooms(): RecentRoom[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentRoom[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((room) => room && typeof room.code === "string");
  } catch {
    return [];
  }
}

export function recordRecentRoom(code: string, title: string): void {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return;
  try {
    const existing = getRecentRooms().filter((room) => room.code !== normalized);
    const next: RecentRoom[] = [
      { code: normalized, title: title.trim() || normalized, ts: Date.now() },
      ...existing,
    ].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable — recents are a convenience, not critical.
  }
}
