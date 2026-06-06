import { useCallback, useEffect, useState } from "react";
import { useSpacetimeDB } from "spacetimedb/react";
import { useRoomState } from "./adapters/roomAdapter";
import { AppShell } from "./components/AppShell";
import { HostMic } from "./components/HostMic";
import { ParticipantPrivateAi } from "./components/ParticipantPrivateAi";
import { RoomDisplay } from "./components/RoomDisplay";
import { Toast } from "./components/Toast";
import type { WorkspaceLayout } from "./types/signalRoom";

type Theme = "dark" | "light";

function readLayout(): WorkspaceLayout {
  return window.localStorage.getItem("sr.layout") === "briefing" ? "briefing" : "canvas";
}

function readTheme(): Theme {
  return "light";
}

// Gate the table-consuming app on a live connection. The SpacetimeDB React SDK's
// useTable runs a different number of hooks until a table's subscription is
// registered; mounting RoomApp only once the connection is active guarantees every
// table is known on its first render, so the hook order is stable.
export default function App() {
  const connection = useSpacetimeDB();
  if (!connection.isActive) {
    return <ConnectingScreen error={connection.connectionError?.message} />;
  }
  return <RoomApp />;
}

function ConnectingScreen({ error }: { error?: string }) {
  return (
    <div className="connecting-screen">
      <div className="connecting-card">
        <span className="connecting-dot" aria-hidden="true" />
        <b>Signal Room</b>
        <span>{error ? `Connection error: ${error}` : "Connecting to the live room…"}</span>
      </div>
    </div>
  );
}

function RoomApp() {
  const room = useRoomState();
  const [layout, setLayout] = useState<WorkspaceLayout>(() => readLayout());
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  const [privateOpen, setPrivateOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "light");
    window.localStorage.setItem("sr.theme", "light");
    if (theme !== "light") setTheme("light");
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem("sr.layout", layout);
  }, [layout]);

  useEffect(() => {
    if (!toast) return;

    const timeout = window.setTimeout(() => setToast(null), 1900);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const showToast = useCallback((message: string) => {
    setToast(message);
  }, []);

  const openNewRoom = useCallback(() => {
    const roomCode = `LIVE-${Date.now().toString(36).toUpperCase().slice(-6)}`;
    window.localStorage.setItem("signal-room.current-room", roomCode);
    window.location.href = `${window.location.pathname}?room=${encodeURIComponent(roomCode)}`;
  }, []);

  return (
    <AppShell
      layout={layout}
      roomCode={room.state.roomCode}
      roomQuestion={room.state.question}
      roomReady={room.adapterStatus.mode === "spacetime" && Boolean(room.adapterStatus.roomId)}
      theme={theme}
      presenceCount={room.state.presence.length}
      onLayoutChange={setLayout}
      onNewRoom={openNewRoom}
      onPrivateOpen={() => setPrivateOpen(true)}
      onThemeToggle={() => setTheme("light")}
    >
      <RoomDisplay room={room} layout={layout} onLayoutChange={setLayout} onToast={showToast} />
      <HostMic room={room} isActive={false} onToast={showToast} />
      {privateOpen ? (
        <ParticipantPrivateAi
          room={room}
          onClose={() => setPrivateOpen(false)}
          onOpenThread={() => setLayout("canvas")}
          onToast={showToast}
        />
      ) : null}
      <Toast message={toast} />
    </AppShell>
  );
}
