import { Bot, BookOpen, Check, CheckSquare, Database, LayoutPanelLeft, Moon, Pencil, Plus, Settings, Sparkles, Sun, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { WorkspaceLayout } from "../types/signalRoom";
import { RecentRoomsMenu } from "./RecentRoomsMenu";

interface AppShellProps {
  layout: WorkspaceLayout;
  roomCode: string;
  roomQuestion: string;
  roomReady: boolean;
  theme: "dark" | "light";
  userDisplayName: string;
  presenceCount: number;
  onLayoutChange: (layout: WorkspaceLayout) => void;
  onNewRoom: () => void;
  onPrivateOpen: () => void;
  onRoomTitleChange: (title: string) => Promise<boolean>;
  onThemeToggle: () => void;
  children: ReactNode;
}

const layoutOptions: Array<{ id: Extract<WorkspaceLayout, "canvas" | "briefing">; label: string; icon: LucideIcon }> = [
  { id: "canvas", label: "Canvas", icon: LayoutPanelLeft },
  { id: "briefing", label: "Briefing", icon: BookOpen },
];

export function AppShell({
  layout,
  roomCode,
  roomQuestion,
  roomReady,
  theme,
  userDisplayName,
  presenceCount,
  onLayoutChange,
  onNewRoom,
  onPrivateOpen,
  onRoomTitleChange,
  onThemeToggle,
  children,
}: AppShellProps) {
  const hereCount = Math.max(1, presenceCount);
  const userLabel = userDisplayName.trim() || "Guest";
  const userInitial = userLabel.slice(0, 1).toUpperCase() || "G";
  const [editingRoomTitle, setEditingRoomTitle] = useState(false);
  const [roomTitleDraft, setRoomTitleDraft] = useState(roomQuestion);

  useEffect(() => {
    if (!editingRoomTitle) setRoomTitleDraft(roomQuestion);
  }, [editingRoomTitle, roomQuestion]);

  async function submitRoomTitle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = roomTitleDraft.trim();
    if (!nextTitle || nextTitle === roomQuestion) {
      setRoomTitleDraft(roomQuestion);
      setEditingRoomTitle(false);
      return;
    }

    const renamed = await onRoomTitleChange(nextTitle);
    if (renamed) setEditingRoomTitle(false);
  }

  return (
    <div className="app">
      <header className="bar">
        <div className="brand">
          <span className="mark" aria-hidden="true">
            <SignalMark />
          </span>
          <span className="wordmark">
            <b>Signal Room</b>
            <span>Live research</span>
          </span>
        </div>

        <form className={`room-pill${editingRoomTitle ? " editing" : ""}`} onSubmit={submitRoomTitle}>
          {editingRoomTitle ? (
            <>
              <input
                className="room-title-input"
                value={roomTitleDraft}
                onChange={(event) => setRoomTitleDraft(event.target.value)}
                aria-label="Room name"
                maxLength={96}
                autoFocus
              />
              <button className="pill-icon" type="submit" title="Save room name">
                <Check size={14} strokeWidth={2.2} />
              </button>
              <button
                className="pill-icon"
                type="button"
                title="Cancel"
                onClick={() => {
                  setRoomTitleDraft(roomQuestion);
                  setEditingRoomTitle(false);
                }}
              >
                <X size={14} strokeWidth={2.2} />
              </button>
            </>
          ) : (
            <>
              <button className="q room-title-button" type="button" onClick={() => setEditingRoomTitle(true)} title="Rename room">
                {roomQuestion}
              </button>
              <span className="code mono">{roomCode}</span>
              <button className="pill-icon room-edit" type="button" onClick={() => setEditingRoomTitle(true)} title="Rename room">
                <Pencil size={13} strokeWidth={2.1} />
              </button>
            </>
          )}
        </form>

        <span className="bar-spacer" />

        <span className="live">
          <span className="dot" aria-hidden="true" />
          {roomReady ? `Live · ${hereCount} here` : "Connecting"}
        </span>

        <nav className="seg" aria-label="Workspace views">
          {layoutOptions.map((option) => {
            const Icon = option.icon;
            return (
              <button
                className={layout === option.id ? "on" : ""}
                key={option.id}
                type="button"
                onClick={() => onLayoutChange(option.id)}
              >
                <Icon size={15} strokeWidth={2} />
                {option.label}
              </button>
            );
          })}
        </nav>

        <button className="you-btn" type="button" onClick={onPrivateOpen}>
          <span className="avatar human sm">{userInitial}</span>
          <span className="you-label">{userLabel}</span>
        </button>

        <RecentRoomsMenu currentCode={roomCode} />

        <button className="icon-btn" type="button" onClick={onNewRoom} title="New live room">
          <Plus size={16} strokeWidth={2.1} />
        </button>

        <button className="icon-btn" type="button" onClick={onThemeToggle} title="Toggle theme">
          {theme === "dark" ? <Sun size={16} strokeWidth={2.1} /> : <Moon size={16} strokeWidth={2.1} />}
        </button>
      </header>

      <main>
        <nav className="side-rail" aria-label="Signal Room sections">
          <button className={layout === "canvas" ? "active" : ""} type="button" onClick={() => onLayoutChange("canvas")} title="Room">
            <LayoutPanelLeft size={18} strokeWidth={2.1} />
            <span>Room</span>
          </button>
          <button className={layout === "briefing" ? "active" : ""} type="button" onClick={() => onLayoutChange("briefing")} title="Briefing">
            <BookOpen size={18} strokeWidth={2.1} />
            <span>Brief</span>
          </button>
          <button className={layout === "takeaways" ? "active" : ""} type="button" onClick={() => onLayoutChange("takeaways")} title="Takeaways">
            <CheckSquare size={18} strokeWidth={2.1} />
            <span>Items</span>
          </button>
          <button className={layout === "sources" ? "active" : ""} type="button" onClick={() => onLayoutChange("sources")} title="Sources">
            <Database size={18} strokeWidth={2.1} />
            <span>Sources</span>
          </button>
          <button type="button" onClick={onPrivateOpen} title="Agents">
            <Bot size={18} strokeWidth={2.1} />
            <span>Agents</span>
          </button>
          <span className="rail-spacer" />
          <button type="button" onClick={onThemeToggle} title="Settings">
            <Settings size={18} strokeWidth={2.1} />
            <span>Theme</span>
          </button>
        </nav>
        <div className="stage-shell">{children}</div>
      </main>
    </div>
  );
}

function SignalMark() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" fill="none" aria-hidden="true">
      <rect x="0.6" y="0.6" width="32.8" height="32.8" rx="9" fill="var(--blue-bg)" stroke="var(--line)" />
      <g stroke="var(--blue)" strokeWidth="1.4" opacity="0.55">
        <line x1="17" y1="17" x2="9" y2="9" />
        <line x1="17" y1="17" x2="25" y2="10" />
        <line x1="17" y1="17" x2="10" y2="25" />
        <line x1="17" y1="17" x2="25" y2="24" />
      </g>
      <g fill="var(--blue)">
        <circle cx="9" cy="9" r="2.1" opacity="0.85" />
        <circle cx="25" cy="10" r="2.1" opacity="0.85" />
        <circle cx="10" cy="25" r="2.1" opacity="0.85" />
        <circle cx="25" cy="24" r="2.1" opacity="0.85" />
      </g>
      <circle cx="17" cy="17" r="4.1" fill="var(--blue)" />
      <Sparkles className="mark-spark" x="11" y="11" size={12} strokeWidth={1.5} />
    </svg>
  );
}
