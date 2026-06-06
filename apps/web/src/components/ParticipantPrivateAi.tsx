import { AlertTriangle, FileText, Monitor, Plus, Send, Table2, MessageSquare } from "lucide-react";
import { useState } from "react";
import type { SignalRoomSnapshot } from "../adapters/roomAdapter";
import { Chip, OwnerLabel, PanelTitle } from "./Primitives";

interface ParticipantPrivateAiProps {
  room: SignalRoomSnapshot;
  onClose: () => void;
  onOpenThread: () => void;
  onToast: (message: string) => void;
}

const initialPrompt =
  "Agent, consider whether Algeria matters in the Nigeria oil case, and only interrupt the room if it changes inflation or rates expectations.";

export function ParticipantPrivateAi({ room, onClose, onOpenThread, onToast }: ParticipantPrivateAiProps) {
  const { state, actions, focusedNode } = room;
  const [prompt, setPrompt] = useState(initialPrompt);
  const mapCards = state.mapNodes.slice(0, 4).map((node) => ({
    id: node.id,
    title: node.title,
    body: node.summary,
    chip: { label: node.focus.type, tone: node.focus.typeTone },
    ownerInitial: node.ownerInitial,
    ownerKind: node.ownerKind,
    ownerLabel: node.source,
  }));
  const cards = mapCards.length
    ? mapCards
    : [
        {
          id: "empty-personal-map",
          title: "Waiting for shared context",
          body: "Quiet notes, transcript chunks, and agent findings will appear here after they create live map branches.",
          chip: { label: "ready", tone: "blue" as const },
          ownerInitial: "R",
          ownerKind: "agent" as const,
          ownerLabel: "Room router",
        },
      ];
  const mapProgress = Math.min(100, Math.max(8, state.mapNodes.length * 18 + state.queueItems.length * 10));
  const summaryText = state.mapNodes.length
    ? `${state.mapNodes.length} shared ${state.mapNodes.length === 1 ? "topic is" : "topics are"} live. ${state.queueItems.length} passive ${state.queueItems.length === 1 ? "prompt" : "prompts"} or finding ${state.queueItems.length === 1 ? "is" : "are"} waiting on the room display.`
    : "This room is waiting for its first shared signal. Start the mic, replay a transcript, or add a quiet note to create the first branch.";

  function askPrivately() {
    if (!prompt.trim()) return;
    actions.addPrivatePrompt(prompt);
    onToast("Saved privately");
  }

  async function addToSharedMap() {
    if (!prompt.trim()) return;
    const synced = await actions.addSharedNote(prompt);
    if (!synced) {
      onToast("Shared note did not sync");
      return;
    }
    onToast("Private note added to the shared map as a quiet human contribution");
  }

  return (
    <>
      <button className="scrim" type="button" aria-label="Close private notes" onClick={onClose} />
      <aside className="sheet" aria-label="Private notes">
        <div className="sheet-head">
          <span className="avatar human">{state.displayName.slice(0, 1).toUpperCase() || "B"}</span>
          <div className="t">
            <b>Private notes</b>
            <span>Only you can see this · nothing here enters the room until you send it</span>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close private notes">
            ×
          </button>
        </div>

        <div className="sheet-body">
          <div className="compose">
            <div className="panel-head inline-head">
              <PanelTitle>
                <Monitor size={17} strokeWidth={2.1} />
                Private Notes
              </PanelTitle>
              <span className="panel-sub">{state.displayName}</span>
            </div>
            <textarea
              aria-label="Private note"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
            <div className="field-row">
              <div className="select-like">Target: {focusedNode.title}</div>
              <div className="select-like">Visibility: private</div>
            </div>
            <button className="primary-btn" type="button" onClick={askPrivately}>
              <Send size={17} strokeWidth={2.1} />
              Save privately
            </button>
            <button className="ghost-btn" type="button" onClick={() => void addToSharedMap()}>
              <Plus size={17} strokeWidth={2.1} />
              Add to shared map
            </button>
            <button
              className="ghost-btn"
              type="button"
              onClick={() => onToast("Context attached to the current branch")}
            >
              <FileText size={17} strokeWidth={2.1} />
              Attach context or research
            </button>
            <button
              className="danger-btn"
              type="button"
              onClick={() => {
                onOpenThread();
                onToast("Opened active finding");
              }}
            >
              <AlertTriangle size={17} strokeWidth={2.1} />
              Open active finding
            </button>
          </div>

          <section className="sheet-section">
          <div className="panel-head inline-head">
            <PanelTitle>
              <Table2 size={17} strokeWidth={2.1} />
              Personal Map View
            </PanelTitle>
            <span className="panel-sub">same shared room</span>
          </div>
          <div className="personal-map">
            <article className="wide-card">
              <h3>Working room summary</h3>
              <p>{summaryText}</p>
              <div className="confidence">
                <div className="bar">
                  <span style={{ width: `${mapProgress}%` }} />
                </div>
                <strong>{state.mapNodes.length ? "live state" : "empty room"}</strong>
              </div>
            </article>

            {cards.map((card) => (
              <article className="small-card" key={card.id}>
                <h4>{card.title}</h4>
                <p>{card.body}</p>
                <div className="card-bottom">
                  <Chip chip={card.chip} />
              <OwnerLabel
                    initial={card.ownerInitial}
                    kind={card.ownerKind}
                    label={card.ownerLabel}
                  />
                </div>
              </article>
            ))}
          </div>
          </section>

          <section className="sheet-section">
          <div className="panel-head inline-head">
            <PanelTitle>
              <MessageSquare size={17} strokeWidth={2.1} />
              Private Scratchpad
            </PanelTitle>
            <span className="panel-sub">only you</span>
          </div>
          <div className="feed">
            {state.scratchpad.map((entry) => (
              <article className="note-row" key={entry.id}>
                <strong>{entry.title}</strong>
                <span>{entry.body}</span>
              </article>
            ))}
          </div>
          </section>
        </div>
      </aside>
    </>
  );
}
