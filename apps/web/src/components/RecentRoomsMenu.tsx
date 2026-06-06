import { ArrowRight, History } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getRecentRooms, type RecentRoom } from "../adapters/recentRooms";

export function RecentRoomsMenu({ currentCode }: { currentCode: string }) {
  const [open, setOpen] = useState(false);
  const [rooms, setRooms] = useState<RecentRoom[]>([]);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) setRooms(getRecentRooms());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function openRoom(code: string) {
    window.localStorage.setItem("signal-room.current-room", code);
    window.location.href = `${window.location.pathname}?room=${encodeURIComponent(code)}`;
  }

  return (
    <div className="recents" ref={ref}>
      <button
        className={`icon-btn${open ? " on" : ""}`}
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="Recent rooms"
      >
        <History size={16} strokeWidth={2.1} />
      </button>
      {open ? (
        <div className="recents-menu" role="menu">
          <div className="recents-head">Recent rooms</div>
          {rooms.length === 0 ? (
            <div className="recents-empty">No rooms visited yet.</div>
          ) : (
            rooms.map((room) => (
              <button
                className={`recents-item${room.code === currentCode ? " current" : ""}`}
                key={room.code}
                type="button"
                onClick={() => openRoom(room.code)}
              >
                <span className="recents-text">
                  <span className="recents-title">{room.title}</span>
                  <span className="recents-code mono">{room.code}</span>
                </span>
                {room.code === currentCode ? (
                  <span className="recents-here">here</span>
                ) : (
                  <ArrowRight size={13} strokeWidth={2.2} />
                )}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
