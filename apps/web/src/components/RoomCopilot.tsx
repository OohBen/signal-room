import { MessageSquare } from "lucide-react";
import type { MapNode, QueueItem, SharedNote } from "../types/signalRoom";
import type { SpacetimeAdapterStatus } from "../adapters/spacetimeAdapter";
import { Chip, ChipRow, PanelTitle } from "./Primitives";

interface RoomCopilotProps {
  focusedNode: MapNode;
  queueItems: QueueItem[];
  sharedNotes: SharedNote[];
  adapterStatus: SpacetimeAdapterStatus;
  onOpenThread: () => void;
  onHint: () => void;
}

export function RoomCopilot({
  focusedNode,
  queueItems,
  sharedNotes,
  adapterStatus,
  onOpenThread,
  onHint,
}: RoomCopilotProps) {
  const focus = focusedNode.focus;

  return (
    <aside className="panel side-stack">
      <div className="panel-head">
        <PanelTitle>
          <MessageSquare size={17} strokeWidth={2.1} />
          Room Copilot
        </PanelTitle>
        <span className="panel-sub">TV rail</span>
      </div>
      <div className="side-content">
        <article className="source-row">
          <strong>
            {adapterStatus.mode === "spacetime" ? "Live SpacetimeDB" : "Connecting"}
          </strong>
          <span>
            {adapterStatus.mode === "spacetime"
              ? `${adapterStatus.counts.nodes} nodes, ${adapterStatus.counts.notes} notes, ${adapterStatus.counts.tasks} tasks synced in room ${adapterStatus.roomId ?? "DEMO"}.`
              : adapterStatus.connectionError ?? adapterStatus.reason}
          </span>
        </article>

        <article className="focus-card">
          <div className="chip-row">
            <Chip chip={{ label: focus.type, tone: focus.typeTone }} />
            <Chip chip={{ label: focus.age }} />
          </div>
          <h3>{focus.title}</h3>
          <p>{focus.text}</p>
          <div className="focus-meta">
            <div className="focus-metric">
              <strong>{focus.impact}</strong>
              <span>possible impact</span>
            </div>
            <div className="focus-metric">
              <strong>{focus.action}</strong>
              <span>room action</span>
            </div>
          </div>
          <article className="source-row">
            <strong>{focus.source}</strong>
            <span>{focus.connected}</span>
          </article>
          <div className="mini-actions">
            <button type="button" onClick={onOpenThread}>
              Open full read
            </button>
            <button type="button" onClick={onHint}>
              How to open
            </button>
          </div>
        </article>

        {sharedNotes.map((note) => (
          <article className="queue-row" key={note.id}>
            <div className="queue-meta">
              <strong>Human note from {note.author}</strong>
              <Chip chip={{ label: "shared quietly", tone: "green" }} />
            </div>
            <span>{note.body}</span>
            <ChipRow
              chips={[
                { label: `Source: ${note.author}`, tone: "green" },
                { label: `Connected: ${note.connected}` },
              ]}
            />
          </article>
        ))}

        {queueItems.map((item) => (
          <article className="queue-row" key={item.id}>
            <div className="queue-meta">
              <strong>{item.title}</strong>
              <Chip chip={item.metaChip} />
            </div>
            <span>{item.body}</span>
            <ChipRow chips={item.chips} />
          </article>
        ))}

        <article className="source-row">
          <strong>Display behavior</strong>
          <span>
            AI can surface candidates here, but it does not interrupt the room. Humans choose what to
            discuss. Low-signal items fall off automatically.
          </span>
        </article>
      </div>
    </aside>
  );
}
