import { ArrowRight, Check, ChevronRight, Send, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { SignalRoomSnapshot } from "../adapters/roomAdapter";
import type { MapNode, WorkspaceLayout } from "../types/signalRoom";
import { Avatar, Chip, ChipRow } from "./Primitives";
import { RoomMap } from "./RoomMap";

interface RoomDisplayProps {
  room: SignalRoomSnapshot;
  layout: WorkspaceLayout;
  onLayoutChange: (layout: WorkspaceLayout) => void;
  onToast: (message: string) => void;
}

export function RoomDisplay({ room, layout, onLayoutChange, onToast }: RoomDisplayProps) {
  if (layout === "briefing") {
    return <BriefingLayout room={room} onJump={(nodeId) => jumpToNode(room, nodeId, onLayoutChange)} />;
  }

  return <CanvasLayout room={room} onToast={onToast} />;
}

function CanvasLayout({ room, onToast }: { room: SignalRoomSnapshot; onToast: (message: string) => void }) {
  const { state, focusedNode, focusNodeId, actions } = room;
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const insetRight = inspectorOpen ? 440 : 0;

  function focusNode(nodeId: string) {
    actions.setFocusNode(nodeId);
    setInspectorOpen(true);
  }

  return (
    <section className="work canvas signal-workspace" aria-label="Signal Room canvas">
      <div className="canvas-top-strip">
        <div className="canvas-stat">
          <b>{state.mapNodes.length}</b>
          <span>nodes</span>
        </div>
        <div className="canvas-stat">
          <b>{state.queueItems.length}</b>
          <span>agent items</span>
        </div>
        <div className="canvas-legend" aria-label="Node states">
          <span><i className="state-dot listening" />Listening</span>
          <span><i className="state-dot checking" />Checking</span>
          <span><i className="state-dot ready" />Finding ready</span>
        </div>
      </div>

      <div className="map-wrap full" style={{ right: insetRight }}>
        <RoomMap
          nodes={state.mapNodes}
          presence={state.presence}
          focusedNodeId={focusNodeId}
          insetRight={0}
          onFocusNode={focusNode}
          onClearFocus={actions.clearFocusNode}
        />
      </div>

      {inspectorOpen ? (
        <div className="inspector-shell">
          <InspectorPanel
            room={room}
            node={focusedNode}
            onClose={() => setInspectorOpen(false)}
            onHide={() => setInspectorOpen(false)}
            onJump={focusNode}
            onToast={onToast}
          />
        </div>
      ) : (
        <button className="reopen r-right" type="button" onClick={() => setInspectorOpen(true)}>
          <span className="led" />
          Synthesis · {state.queueItems.length} waiting
        </button>
      )}
    </section>
  );
}

function InspectorPanel({
  room,
  node,
  onClose,
  onHide,
  onJump,
  onToast,
}: {
  room: SignalRoomSnapshot;
  node: MapNode;
  onClose: () => void;
  onHide: () => void;
  onJump: (nodeId: string) => void;
  onToast: (message: string) => void;
}) {
  const { state } = room;
  const isEmpty = node.id === "empty-room";
  const [agentPrompt, setAgentPrompt] = useState("");
  const [isEditingNode, setIsEditingNode] = useState(false);
  const [draftTitle, setDraftTitle] = useState(node.title);
  const [draftSummary, setDraftSummary] = useState(node.summary);

  useEffect(() => {
    setIsEditingNode(false);
    setDraftTitle(node.title);
    setDraftSummary(node.summary);
  }, [node.id, node.summary, node.title]);

  const connectedItems = useMemo(() => {
    const title = node.title.toLowerCase();
    const items = state.queueItems.filter((item) =>
      item.chips.some((chip) => chip.label.toLowerCase().includes(title))
    );
    return node.isRoot ? (items.length ? items : state.queueItems) : items;
  }, [node.isRoot, node.title, state.queueItems]);
  const findings = connectedItems.filter((item) => /finding/i.test(item.title)).slice(0, 2);
  const questions = connectedItems.filter((item) => /question/i.test(item.title)).slice(0, 2);
  const tasks = connectedItems.filter((item) => /task/i.test(item.title)).slice(0, 2);

  function submitAgentPrompt() {
    const body = agentPrompt.trim();
    if (!body) return;
    room.actions.redirectAgent(body);
    setAgentPrompt("");
    onToast("Agent task queued");
  }

  async function saveNodeEdit() {
    const nextTitle = draftTitle.trim();
    const nextSummary = draftSummary.trim();
    if (!nextTitle || !nextSummary) return;
    await room.actions.updateMapNode(node.id, {
      title: nextTitle,
      summary: nextSummary,
    });
    setIsEditingNode(false);
    onToast("Map node updated");
  }

  return (
    <aside className="panel right">
      <div className="panel-head">
        {isEmpty ? <Sparkles size={15} strokeWidth={2.1} /> : <Avatar initial={node.ownerInitial} kind={node.ownerKind} />}
        <span className="t">{isEmpty ? "Room synthesis" : node.focus.type}</span>
        <span className="sp" />
        <span className="badge">{state.agents.length} agents</span>
        <button className="icon-btn mini" type="button" onClick={onClose} title="Close inspector">
          <X size={15} strokeWidth={2.1} />
        </button>
        <button className="icon-btn mini" type="button" onClick={onHide} title="Hide panel">
          <ChevronRight size={15} strokeWidth={2.1} />
        </button>
      </div>

      <div className="panel-body">
        <section className="insp-section insp-hero">
          <div className="c">
            <div className="row">
              <Chip chip={{ label: node.focus.type, tone: node.focus.typeTone }} />
              <Chip chip={{ label: node.focus.age }} />
              <span className="sp" />
              <button className="inline-action" type="button" onClick={() => setIsEditingNode((open) => !open)}>
                {isEditingNode ? "Cancel" : "Edit"}
              </button>
            </div>
            {isEditingNode ? (
              <div className="node-edit-form">
                <input
                  aria-label="Map node title"
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                />
                <textarea
                  aria-label="Map node summary"
                  value={draftSummary}
                  onChange={(event) => setDraftSummary(event.target.value)}
                />
                <button className="btn primary full" type="button" onClick={saveNodeEdit}>
                  <Check size={15} strokeWidth={2.1} />
                  Save correction
                </button>
              </div>
            ) : (
              <>
                <h2>{node.focus.title}</h2>
                <p>{node.focus.text}</p>
              </>
            )}
            <div className="factor-meta">
              <div>
                <span>Origin</span>
                <b>{node.source}</b>
              </div>
              <div>
                <span>Status</span>
                <b className={node.hasAlert ? "red" : "green"}>{node.hasAlert ? "Finding ready" : node.focus.action}</b>
              </div>
            </div>
          </div>
        </section>

        <section className="insp-section">
          <div className="h">
            <span className="t">Latest finding</span>
          </div>
          <div className="c queue-list">
            {findings.length ? (
              findings.map((item) => <QueueCard item={item} key={item.id} />)
            ) : (
              <p className="muted-copy">No research result has landed for this factor yet.</p>
            )}
          </div>
        </section>

        <section className="insp-section">
          <div className="h">
            <span className="t">Quiet question candidates</span>
          </div>
          <div className="c queue-list">
            {questions.length ? (
              questions.map((item) => <QueueCard item={item} key={item.id} />)
            ) : (
              <p className="muted-copy">No quiet questions are waiting. The agent will add them without interrupting the room.</p>
            )}
          </div>
        </section>

        {tasks.length ? (
          <section className="insp-section">
            <div className="h">
              <span className="t">Research tasks</span>
            </div>
            <div className="c queue-list">
              {tasks.map((item) => <QueueCard item={item} key={item.id} />)}
            </div>
          </section>
        ) : null}

        <section className="insp-section agent-compose">
          <div className="h">
            <span className="t">Tell this agent</span>
          </div>
          <div className="c">
            <textarea
              aria-label="Tell this factor agent"
              placeholder="Ask for focus, sources, counter-evidence, or next steps..."
              value={agentPrompt}
              onChange={(event) => setAgentPrompt(event.target.value)}
            />
            <button className="btn primary full" type="button" onClick={submitAgentPrompt}>
              <Send size={15} strokeWidth={2.1} />
              Queue agent note
            </button>
          </div>
        </section>

        {state.sharedNotes.length ? (
          <section className="insp-section">
            <div className="h">
              <span className="t">Human edits</span>
            </div>
            <div className="c">
              {state.sharedNotes.slice(0, 4).map((note) => (
                <div className="edit-row" key={note.id}>
                  <Avatar initial={note.author.slice(0, 1).toUpperCase()} kind="human" />
                  <div className="b">
                    <b>{note.author}: </b>
                    {note.body}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {!node.isRoot && state.mapNodes.length > 1 ? (
          <button className="btn ghost full compact-return" type="button" onClick={() => onJump(state.mapNodes[0].id)}>
            <Check size={15} strokeWidth={2.1} />
            Back to room synthesis
          </button>
        ) : null}
      </div>
    </aside>
  );
}

function QueueCard({ item }: { item: SignalRoomSnapshot["state"]["queueItems"][number] }) {
  const [expanded, setExpanded] = useState(false);
  const formatted = formatQueueBody(item.body);
  const body = expanded ? formatted.full : formatted.preview;

  return (
    <article className="q-card">
      <div className="top">
        <span className="t">{item.title}</span>
        <span className="sp" />
        <Chip chip={item.metaChip} />
      </div>
      {formatted.verdict ? <span className={`verdict ${formatted.verdictTone}`}>{formatted.verdict}</span> : null}
      <p>{body}</p>
      {formatted.canExpand ? (
        <button className="inline-action" type="button" onClick={() => setExpanded((open) => !open)}>
          {expanded ? "Show less" : "Show full note"}
        </button>
      ) : null}
      {item.chips.length ? <ChipRow chips={item.chips.slice(0, 3)} /> : null}
    </article>
  );
}

function formatQueueBody(rawBody: string): {
  preview: string;
  full: string;
  canExpand: boolean;
  verdict?: string;
  verdictTone: "confirm" | "contradict" | "unclear";
} {
  const clean = rawBody
    .replace(/\s*\[\d+\]/g, "")
    .replace(/\s*Sources?:\s*.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const verdictMatch = clean.match(/\bVerdict:\s*([^.!?]+)[.!?]?/i);
  const verdict = verdictMatch?.[1]?.trim();
  const verdictTone =
    verdict && /contradict|false|wrong|not support/i.test(verdict)
      ? "contradict"
      : verdict && /unclear|mixed|unknown|inconclusive/i.test(verdict)
        ? "unclear"
        : "confirm";
  const withoutLead = clean
    .replace(/^.*?:\s*(?=Verdict:)/i, "")
    .replace(/\bVerdict:\s*[^.!?]+[.!?]?\s*/i, "")
    .trim();
  const full = withoutLead || clean;
  const preview = full.length <= 300 ? full : `${full.slice(0, 297).trim()}...`;
  return {
    preview,
    full,
    canExpand: full.length > preview.length,
    verdict: verdict ? `Verdict: ${verdict}` : undefined,
    verdictTone,
  };
}

function BriefingLayout({
  room,
  onJump,
}: {
  room: SignalRoomSnapshot;
  onJump: (nodeId: string) => void;
}) {
  const { state } = room;
  const alertNode = state.mapNodes.find((node) => node.hasAlert) ?? state.mapNodes[0];
  const latestSignals = state.transcript.slice(0, 8);

  return (
    <section className="work briefing" aria-label="Room briefing">
      <div className="digest">
        <div className="digest-hero">
          <div className="section-label">Room briefing · {state.roomCode} · catch up in 20 seconds</div>
          <h1>{state.question}</h1>
          <p className="lead">
            {state.mapNodes[0]?.focus.text ??
              "The room is waiting for its first live signal. Start the mic and the map will fill as people talk."}
          </p>
          <div className="digest-stats">
            <DigestStat color="var(--accent)" label="Working synthesis" value={state.synthesisState} />
            <DigestStat color="var(--green)" label="Shared nodes" value={String(state.mapNodes.length)} />
            <DigestStat label="Researching now" value={`${state.agents.filter((agent) => agent.status === "busy").length} agents`} />
            <DigestStat label="Captured this session" value={`${Math.max(state.transcript.length, state.roomEvents.length)} signals`} />
          </div>
        </div>

        <div className="digest-grid">
          <div className="digest-col">
            <div className="section-label">Needs a decision</div>
            {alertNode ? (
              <button className="decision" type="button" onClick={() => onJump(alertNode.id)}>
                <div className="top">
                  <Avatar initial={alertNode.ownerInitial} kind={alertNode.ownerKind} />
                  <Chip chip={{ label: alertNode.focus.type, tone: alertNode.focus.typeTone }} />
                  <span className={`impact ${alertNode.impactTone}`}>{alertNode.focus.impact}</span>
                </div>
                <h2>{alertNode.title}</h2>
                <p>{alertNode.focus.text}</p>
                <span className="open-link">
                  <ArrowRight size={14} strokeWidth={2.1} />
                  Open full thread on canvas
                </span>
              </button>
            ) : null}

            <div className="section-label digest-subhead">Open questions · waiting on a human</div>
            {state.queueItems.length ? (
              state.queueItems.map((item) => (
                <button className="q-card digest-action" key={item.id} type="button" onClick={() => alertNode && onJump(alertNode.id)}>
                  <div className="top">
                    <span className="t">{item.title}</span>
                    <span className="sp" />
                    <Chip chip={item.metaChip} />
                  </div>
                  <p>{item.body}</p>
                </button>
              ))
            ) : (
              <article className="q-card">
                <p>No passive questions are waiting. The Realtime operator will add them here when useful.</p>
              </article>
            )}
          </div>

          <div className="digest-col">
            <div className="section-label">Live feed · how the map was built</div>
            <div className="digest-feed">
              {latestSignals.length ? (
                latestSignals.map((utterance) => (
                  <button className="feed-item digest-action" key={utterance.id} type="button" onClick={() => alertNode && onJump(alertNode.id)}>
                    <div className="feed-meta">
                      <span className="feed-kind tone-blue">speech</span>
                      <span className="who">{utterance.speaker}</span>
                      <span className="ts mono">{utterance.timestamp}</span>
                    </div>
                    <p>{utterance.text}</p>
                    <span className="became tone-blue">
                      <ArrowRight size={13} strokeWidth={2.1} />
                      transcript signal
                    </span>
                  </button>
                ))
              ) : (
                state.roomEvents.map((event) => (
                  <article className="feed-item" key={event.id}>
                    <div className="feed-meta">
                      <span className="feed-kind tone-green">event</span>
                      <span className="who">Room</span>
                    </div>
                    <p>{event.text}</p>
                  </article>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function DigestStat({ color, label, value }: { color?: string; label: string; value: string }) {
  return (
    <div className="dstat">
      <div className="v" style={color ? { color } : undefined}>
        {value}
      </div>
      <div className="l">{label}</div>
    </div>
  );
}

function jumpToNode(
  room: SignalRoomSnapshot,
  nodeId: string,
  onLayoutChange: (layout: WorkspaceLayout) => void,
) {
  room.actions.setFocusNode(nodeId);
  onLayoutChange("canvas");
}

function fallbackSteps(node: MapNode) {
  return [
    { id: "heard", title: "Heard in room", body: node.summary },
    { id: "source", title: "Attached to map", body: node.focus.source },
    { id: "next", title: "Needs next action", body: node.focus.action },
  ];
}
