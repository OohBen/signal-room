import { Bot, BookOpen, CheckSquare, Database, LayoutPanelLeft, Moon, Plus, Settings, Sparkles, Sun } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { WorkspaceLayout } from "../types/signalRoom";

interface AppShellProps {
  layout: WorkspaceLayout;
  roomCode: string;
  roomQuestion: string;
  roomReady: boolean;
  theme: "dark" | "light";
  presenceCount: number;
  onLayoutChange: (layout: WorkspaceLayout) => void;
  onNewRoom: () => void;
  onPrivateOpen: () => void;
  onThemeToggle: () => void;
  children: ReactNode;
}

const layoutOptions: Array<{ id: WorkspaceLayout; label: string; icon: LucideIcon }> = [
  { id: "canvas", label: "Canvas", icon: LayoutPanelLeft },
  { id: "briefing", label: "Briefing", icon: BookOpen },
];

export function AppShell({
  layout,
  roomCode,
  roomQuestion,
  roomReady,
  theme,
  presenceCount,
  onLayoutChange,
  onNewRoom,
  onPrivateOpen,
  onThemeToggle,
  children,
}: AppShellProps) {
  const hereCount = Math.max(1, presenceCount);

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

        <div className="room-pill">
          <span className="q">{roomQuestion}</span>
          <span className="code mono">{roomCode}</span>
        </div>

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
          <span className="avatar human sm">B</span>
          You
        </button>

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
          <button type="button" onClick={onPrivateOpen} title="Tasks">
            <CheckSquare size={18} strokeWidth={2.1} />
            <span>Tasks</span>
          </button>
          <button type="button" onClick={onPrivateOpen} title="Sources">
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
