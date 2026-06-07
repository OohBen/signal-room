import { ArrowLeft, ArrowRight, Check, ChevronRight, ExternalLink, FileText, Network, Send, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { SignalRoomSnapshot } from "../adapters/roomAdapter";
import { GATEWAY_URL, SPACETIME_DATABASE } from "../config";
import { cleanInsight } from "../lib/cleanInsight";
import { renderRich } from "../lib/renderRich";
import type {
  AgentWorker,
  Chip as SignalChip,
  MapNode,
  PresencePin,
  QueueItem,
  TranscriptUtterance,
  WorkspaceLayout,
} from "../types/signalRoom";
import { Avatar, Chip, ChipRow } from "./Primitives";
import { LiveSignals } from "./LiveSignals";
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

  if (layout === "takeaways") {
    return <TakeawaysLayout room={room} onJump={(nodeId) => jumpToNode(room, nodeId, onLayoutChange)} onToast={onToast} />;
  }

  if (layout === "sources") {
    return <SourcesLayout room={room} onJump={(nodeId) => jumpToNode(room, nodeId, onLayoutChange)} />;
  }

  return <CanvasLayout room={room} onToast={onToast} />;
}

function TakeawaysLayout({
  room,
  onJump,
  onToast,
}: {
  room: SignalRoomSnapshot;
  onJump: (nodeId: string) => void;
  onToast: (message: string) => void;
}) {
  const { state } = room;
  const [researchWorking, setResearchWorking] = useState(false);
  const taskItems = useMemo(
    () => state.queueItems.filter((item) => isResearchTaskItem(item)),
    [state.queueItems]
  );
  const takeawayLines = useMemo(
    () => buildTakeawayLines(state.takeaways, state.signals, state.mapNodes),
    [state.mapNodes, state.signals, state.takeaways]
  );
  const openQuestions = useMemo(
    () => state.queueItems.filter((item) => /question/i.test(item.title)).slice(0, 5),
    [state.queueItems]
  );

  async function workResearchTasks() {
    if (researchWorking) return;
    if (taskItems.length === 0) {
      onToast("No research tasks are queued");
      return;
    }
    setResearchWorking(true);
    onToast("AI is working the research tasks");
    try {
      const response = await fetch(`${GATEWAY_URL}/work-room`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode: state.roomCode,
          database: SPACETIME_DATABASE,
          maxTasks: Math.min(3, taskItems.length),
        }),
      });
      if (!response.ok) throw new Error(`work-room ${response.status}`);
      onToast("AI research task run finished");
    } catch {
      onToast("Could not reach the research worker");
    } finally {
      setResearchWorking(false);
    }
  }

  return (
    <section className="work briefing" aria-label="Takeaways">
      <div className="digest">
        <div className="digest-hero">
          <div className="digest-title-row">
            <div>
              <div className="section-label">Takeaways · {state.roomCode}</div>
              <h1>Takeaway items</h1>
            </div>
            <button
              className="run-fleet digest-action-btn"
              type="button"
              onClick={() => void workResearchTasks()}
              disabled={researchWorking || taskItems.length === 0}
              title={taskItems.length ? undefined : "No research tasks are queued"}
            >
              <Network size={13} strokeWidth={2.2} />
              {researchWorking ? "AI working…" : "Have AI work research"}
            </button>
          </div>
          <p className="lead">
            Decision-ready points from the room. Research tasks stay here until the AI swarm works them into findings.
          </p>
          <div className="digest-stats">
            <DigestStat color="var(--green)" label="Takeaways" value={String(takeawayLines.length)} />
            <DigestStat color="var(--amber)" label="Research tasks" value={String(taskItems.length)} />
            <DigestStat color="var(--accent)" label="Agent findings" value={String(state.signals.length)} />
            <DigestStat label="Open questions" value={String(openQuestions.length)} />
          </div>
        </div>

        <div className="digest-grid">
          <div className="digest-col">
            <div className="section-label">Room takeaways</div>
            {takeawayLines.length ? (
              takeawayLines.map((line, index) => (
                <article className="takeaway-item" key={`${line}-${index}`}>
                  <Sparkles size={15} strokeWidth={2} />
                  <p>{renderRich(cleanInsight(line))}</p>
                </article>
              ))
            ) : (
              <article className="q-card">
                <p>Start the mic or run the agent fleet; takeaways will appear here as the room produces findings.</p>
              </article>
            )}

            {openQuestions.length ? (
              <>
                <div className="section-label digest-subhead">Open room questions</div>
                {openQuestions.map((item) => <QueueCard item={item} key={item.id} />)}
              </>
            ) : null}
          </div>

          <div className="digest-col">
            <div className="section-label">Research tasks for AI</div>
            {taskItems.length ? (
              taskItems.map((item) => <QueueCard item={item} key={item.id} />)
            ) : (
              <article className="q-card">
                <p>No research tasks are queued. When the realtime operator or a human creates one, it lands here for the AI swarm to work.</p>
              </article>
            )}

            {state.mapNodes.length ? (
              <>
                <div className="section-label digest-subhead">Map context</div>
                {state.mapNodes.slice(0, 5).map((node) => (
                  <button className="q-card digest-action map-context-card" key={node.id} type="button" onClick={() => onJump(node.id)}>
                    <div className="top">
                      <span className="t">{node.title}</span>
                      <span className="sp" />
                      <Chip chip={{ label: node.focus.type, tone: node.focus.typeTone }} />
                    </div>
                    <p>{node.summary}</p>
                  </button>
                ))}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

interface EvidenceSource {
  id: string;
  label: string;
  href?: string;
  origin: string;
  connected: string;
  connectedNodeId?: string;
}

function SourcesLayout({
  room,
  onJump,
}: {
  room: SignalRoomSnapshot;
  onJump: (nodeId: string) => void;
}) {
  const { state } = room;
  const aiSources = useMemo(() => collectAiSources(state), [state.mapNodes, state.signals]);

  return (
    <section className="work briefing" aria-label="Sources">
      <div className="digest">
        <div className="digest-hero">
          <div className="section-label">Sources · {state.roomCode}</div>
          <h1>Room sources</h1>
          <p className="lead">
            AI research links and human-added notes in one place. Sources stay attached to the map instead of disappearing into side chat.
          </p>
          <div className="digest-stats">
            <DigestStat color="var(--accent)" label="AI sources" value={String(aiSources.length)} />
            <DigestStat color="var(--green)" label="People added" value={String(state.sharedNotes.length)} />
            <DigestStat label="Findings" value={String(state.signals.length)} />
            <DigestStat label="Map nodes" value={String(state.mapNodes.length)} />
          </div>
        </div>

        <div className="digest-grid source-grid">
          <div className="digest-col">
            <div className="section-label">AI sources</div>
            {aiSources.length ? (
              aiSources.map((source) => <AiSourceCard key={source.id} source={source} onJump={onJump} />)
            ) : (
              <article className="q-card">
                <p>No AI source links yet. "Hey agent" answers and fleet research findings will add cited sources here.</p>
              </article>
            )}
          </div>

          <div className="digest-col">
            <div className="section-label">People added</div>
            {state.sharedNotes.length ? (
              state.sharedNotes.map((note) => <HumanSourceCard key={note.id} note={note} />)
            ) : (
              <article className="q-card">
                <p>No human notes have been added to the shared map yet.</p>
              </article>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function CanvasLayout({ room, onToast }: { room: SignalRoomSnapshot; onToast: (message: string) => void }) {
  const { state, focusedNode, focusNodeId, actions } = room;
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [railView, setRailView] = useState<"signals" | "node">("signals");
  const [fleetRunning, setFleetRunning] = useState(false);
  const insetRight = inspectorOpen ? 440 : 0;

  const researchingNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const worker of state.workers) {
      if (worker.active && worker.currentNodeId) ids.add(worker.currentNodeId);
    }
    for (const node of state.mapNodes) {
      if (node.agent?.state === "working") ids.add(node.id);
    }
    return ids;
  }, [state.mapNodes, state.workers]);
  const activeWorkers = state.workers.filter((worker) => worker.active);

  const rootNode = state.mapNodes.find((node) => node.isRoot) ?? state.mapNodes[0];
  const rootAnswer =
    rootNode?.agent && rootNode.agent.kind !== "none"
      ? {
          question: rootNode.title,
          answer: rootNode.agent.insight,
          state: rootNode.agent.state,
          confidence: rootNode.agent.confidence,
        }
      : undefined;

  async function runFleet() {
    if (fleetRunning) return;
    if (state.mapNodes.length === 0) {
      onToast("Start the mic or add transcript before running the fleet");
      return;
    }
    setFleetRunning(true);
    onToast("Agent fleet started");
    try {
      const response = await fetch(`${GATEWAY_URL}/fleet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomCode: state.roomCode }),
      });
      if (!response.ok) throw new Error(`fleet ${response.status}`);
      onToast("Agent fleet finished");
    } catch {
      onToast("Could not reach the gateway for the fleet");
    } finally {
      setFleetRunning(false);
    }
  }

  function focusNode(nodeId: string) {
    actions.setFocusNode(nodeId);
    setRailView("node");
    setInspectorOpen(true);
  }

  function openSignals() {
    setRailView("signals");
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
        <PresenceStack presence={state.presence} />
        <SwarmStrip workers={state.workers} activeCount={activeWorkers.length} />
        <div className="canvas-legend" aria-label="Node states">
          <span><i className="state-dot listening" />Listening</span>
          <span><i className="state-dot checking" />Checking</span>
          <span><i className="state-dot ready" />Finding ready</span>
        </div>
      </div>

      <div className="map-wrap full" style={{ right: insetRight }}>
        <RoomMap
          nodes={state.mapNodes}
          edges={state.mapEdges}
          presence={state.presence}
          cursors={state.cursors}
          focusedNodeId={focusNodeId}
          researchingNodeIds={researchingNodeIds}
          insetRight={0}
          onFocusNode={focusNode}
          onClearFocus={actions.clearFocusNode}
          onCursorMove={actions.moveCursor}
          onMoveNode={actions.moveMapNode}
          onCleanLayout={actions.cleanMapLayout}
        />
      </div>

      {inspectorOpen ? (
        <div className="inspector-shell">
          {railView === "signals" ? (
            <LiveSignals
              signals={state.signals}
              activeAgents={activeWorkers.length}
              rootAnswer={rootAnswer}
              takeaways={state.takeaways}
              canRunFleet={state.mapNodes.length > 0}
              fleetRunning={fleetRunning}
              onRunFleet={runFleet}
              onOpenNode={focusNode}
              onClose={() => setInspectorOpen(false)}
              onHide={() => setInspectorOpen(false)}
            />
          ) : (
            <InspectorPanel
              room={room}
              node={focusedNode}
              onClose={() => setInspectorOpen(false)}
              onHide={() => setInspectorOpen(false)}
              onBackToSignals={openSignals}
              onJump={focusNode}
              onToast={onToast}
            />
          )}
        </div>
      ) : (
        <button className="reopen r-right" type="button" onClick={() => setInspectorOpen(true)}>
          <span className="led" />
          {railView === "signals" ? `Live signals · ${state.signals.length}` : "Node detail"}
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
  onBackToSignals,
  onJump,
  onToast,
}: {
  room: SignalRoomSnapshot;
  node: MapNode;
  onClose: () => void;
  onHide: () => void;
  onBackToSignals: () => void;
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

  const agentStatus = {
    label: node.hasAlert
      ? "Urgent — review"
      : node.agent?.state === "working"
        ? "Researching…"
        : node.agent?.kind === "none"
          ? "No agent needed"
          : node.agent?.insight
            ? "Insight ready"
            : node.focus.action,
    tone: node.hasAlert ? "red" : "green",
  };

  async function submitAgentPrompt() {
    const body = agentPrompt.trim();
    if (!body) return;
    const queued = await room.actions.redirectAgent(body);
    if (!queued) {
      onToast("Agent task did not queue");
      return;
    }
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

  async function deleteNode() {
    if (isEmpty || node.isRoot) return;
    const deleted = await room.actions.deleteMapNode(node.id);
    if (!deleted) {
      onToast("Card did not delete");
      return;
    }
    onBackToSignals();
    onToast("Card deleted");
  }

  return (
    <aside className="panel right">
      <div className="panel-head">
        <button className="back-to-signals" type="button" onClick={onBackToSignals} title="Back to live signals">
          <ArrowLeft size={15} strokeWidth={2.1} />
          Signals
        </button>
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
              {!isEmpty && !node.isRoot ? (
                <button className="inline-action danger" type="button" onClick={deleteNode} title="Delete bad card">
                  <Trash2 size={13} strokeWidth={2.1} />
                  Delete
                </button>
              ) : null}
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
                <b className={agentStatus.tone}>{agentStatus.label}</b>
              </div>
            </div>
          </div>
        </section>

        {node.agent && node.agent.kind !== "none" && node.agent.insight ? (
          <section className="insp-section">
            <div className="h">
              <span className="t">Agent insight</span>
              <span className="sp" />
              <span className="agent-confidence">{node.agent.confidence}</span>
            </div>
            <div className="c">
              <p className="agent-insight-text">{renderRich(cleanInsight(node.agent.insight))}</p>
              {node.agent.sources.length ? (
                <div className="signal-sources">
                  {node.agent.sources.map((source, index) =>
                    source.href ? (
                      <a className="signal-source" href={source.href} key={index} target="_blank" rel="noreferrer">
                        {source.label}
                      </a>
                    ) : (
                      <span className="signal-source" key={index}>
                        {source.label}
                      </span>
                    )
                  )}
                </div>
              ) : null}
            </div>
          </section>
        ) : node.agent?.kind === "none" ? (
          <section className="insp-section">
            <div className="c">
              <p className="muted-copy">No agent on this card — web research won't help here; it needs the room's own input.</p>
            </div>
          </section>
        ) : findings.length ? (
          <section className="insp-section">
            <div className="h">
              <span className="t">Latest finding</span>
            </div>
            <div className="c queue-list">
              {findings.map((item) => <QueueCard item={item} key={item.id} />)}
            </div>
          </section>
        ) : null}

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
            <button className="btn primary full" type="button" onClick={() => void submitAgentPrompt()}>
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

function AiSourceCard({ source, onJump }: { source: EvidenceSource; onJump: (nodeId: string) => void }) {
  return (
    <article className="evidence-card ai-source-card">
      <div className="evidence-top">
        <Network size={15} strokeWidth={2.1} />
        <span>AI source</span>
      </div>
      {source.href ? (
        <a className="evidence-title" href={source.href} target="_blank" rel="noreferrer">
          {source.label}
          <ExternalLink size={13} strokeWidth={2.1} />
        </a>
      ) : (
        <strong className="evidence-title">{source.label}</strong>
      )}
      <p>{source.origin}</p>
      <div className="evidence-bottom">
        <span>{source.connected}</span>
        {source.connectedNodeId ? (
          <button className="inline-action" type="button" onClick={() => onJump(source.connectedNodeId!)}>
            Open on map
          </button>
        ) : null}
      </div>
    </article>
  );
}

function HumanSourceCard({ note }: { note: SignalRoomSnapshot["state"]["sharedNotes"][number] }) {
  return (
    <article className="evidence-card human-source-card">
      <div className="evidence-top">
        <FileText size={15} strokeWidth={2.1} />
        <span>{note.author}</span>
      </div>
      <strong className="evidence-title">{note.connected}</strong>
      <p>{note.body}</p>
    </article>
  );
}

function isResearchTaskItem(item: SignalRoomSnapshot["state"]["queueItems"][number]): boolean {
  const text = `${item.title} ${item.metaChip.label} ${item.body}`.toLowerCase();
  return /\b(?:agent task|quick_research|research|lookup|look up|source|evidence)\b/.test(text);
}

function buildTakeawayLines(
  takeaways: string | undefined,
  signals: SignalRoomSnapshot["state"]["signals"],
  nodes: MapNode[]
): string[] {
  const explicit = splitTakeawayLines(takeaways);
  if (explicit.length) return explicit.slice(0, 8);

  const signalLines = signals
    .slice(0, 5)
    .map((signal) => `${signal.title}: ${signal.body}`)
    .map((line) => cleanInsight(line))
    .filter(Boolean);
  if (signalLines.length) return signalLines;

  const root = nodes.find((node) => node.isRoot) ?? nodes[0];
  return root?.summary ? [root.summary] : [];
}

function splitTakeawayLines(takeaways: string | undefined): string[] {
  return (takeaways ?? "")
    .split(/\n+/)
    .map((line) => cleanInsight(line.replace(/^[•\-*]\s*/, "")))
    .filter(Boolean);
}

function collectAiSources(state: SignalRoomSnapshot["state"]): EvidenceSource[] {
  const seen = new Set<string>();
  const sources: EvidenceSource[] = [];

  const pushSource = (
    chip: SignalChip,
    origin: string,
    connected: string,
    connectedNodeId?: string
  ) => {
    const label = chip.label.trim();
    if (!label) return;
    const key = chip.href ? `href:${chip.href}` : `label:${label.toLowerCase()}:${origin.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    sources.push({
      id: key,
      label,
      href: chip.href,
      origin,
      connected,
      connectedNodeId,
    });
  };

  for (const signal of state.signals) {
    for (const source of signal.sources) {
      pushSource(source, signal.title, signal.connectedNodeTitle, signal.connectedNodeId);
    }
  }

  for (const node of state.mapNodes) {
    for (const source of node.agent?.sources ?? []) {
      pushSource(source, node.title, node.title, node.id);
    }
  }

  return sources;
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
  const openQuestions = useMemo(() => briefingQuestions(state.queueItems), [state.queueItems]);
  const primaryNode =
    state.mapNodes.find((node) => node.id === state.defaultFocusNodeId) ??
    state.mapNodes.find((node) => node.isRoot) ??
    state.mapNodes[0];
  const alertNode = chooseBriefingDecisionNode(state.mapNodes, primaryNode);
  const latestSignals = useMemo(() => briefingTranscript(state.transcript), [state.transcript]);

  return (
    <section className="work briefing" aria-label="Room briefing">
      <div className="digest">
        <div className="digest-hero">
          <div className="section-label">Room briefing · {state.roomCode} · catch up in 20 seconds</div>
          <h1>{state.question}</h1>
          <p className="lead">
            {primaryNode?.focus.text ??
              "The room is waiting for its first live signal. Start the mic and the map will fill as people talk."}
          </p>
          <div className="digest-stats">
            <DigestStat color="var(--accent)" label="Working synthesis" value={state.synthesisState} />
            <DigestStat color="var(--green)" label="Shared nodes" value={String(state.mapNodes.length)} />
            <DigestStat label="Researching now" value={`${state.agents.filter((agent) => agent.status === "busy").length} agents`} />
            <DigestStat label="Clean turns" value={`${latestSignals.length} shown`} />
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
            {openQuestions.length ? (
              openQuestions.map((item) => (
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
                <p>No clean human-decision questions are waiting. Agent findings stay in Live Signals.</p>
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

function chooseBriefingDecisionNode(nodes: SignalRoomSnapshot["state"]["mapNodes"], primaryNode?: SignalRoomSnapshot["state"]["mapNodes"][number]) {
  return (
    nodes.find((node) => node.hasAlert && !isTopicShiftNode(node)) ??
    primaryNode ??
    nodes.find((node) => !isTopicShiftNode(node)) ??
    nodes[0]
  );
}

function isTopicShiftNode(node: SignalRoomSnapshot["state"]["mapNodes"][number]): boolean {
  const text = `${node.title} ${node.focus.type}`.toLowerCase();
  return /\btopic shift\b|\bshift to\b/.test(text);
}

function briefingQuestions(items: QueueItem[]): QueueItem[] {
  const seen = new Set<string>();
  return items
    .filter((item) => /question/i.test(item.title))
    .filter((item) => !isLowSignalBriefingQuestion(item.body))
    .filter((item) => {
      const key = briefingQuestionKey(item.body);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4);
}

function briefingTranscript(transcript: TranscriptUtterance[]): TranscriptUtterance[] {
  return transcript.filter((utterance) => isUsefulBriefingTurn(utterance.text)).slice(0, 6);
}

function isUsefulBriefingTurn(text: string): boolean {
  const clean = text.trim().replace(/\s+/g, " ");
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length < 5) return false;
  if (/[.…]{2,}$/.test(clean)) return false;
  if (/^(?:and|or|um|uh|yeah|okay)[.?!…]*$/i.test(clean)) return false;
  return !/\b(?:and|or|um|uh|so|sort of|kind of|like)\s*[.?!…]*$/i.test(clean);
}

function isLowSignalBriefingQuestion(text: string): boolean {
  const lower = text.toLowerCase();
  return /transcription glitch|could someone restate|restate the goal|intended action/.test(lower);
}

function briefingQuestionKey(question: string): string {
  const lower = question.toLowerCase();
  if (/\breview\b/.test(lower) && /\bcriteria\b/.test(lower)) return "review-criteria";
  if (/\bmicrowave\b/.test(lower) && /\bhackathon\b/.test(lower)) return "microwave-or-hackathon";
  return lower
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !BRIEFING_QUESTION_STOP_WORDS.has(token))
    .sort()
    .join(" ");
}

const BRIEFING_QUESTION_STOP_WORDS = new Set([
  "and",
  "are",
  "choice",
  "choosing",
  "decision",
  "discussion",
  "does",
  "for",
  "question",
  "the",
  "topic",
  "what",
  "will",
]);

function PresenceStack({ presence }: { presence: PresencePin[] }) {
  if (presence.length === 0) return null;
  const shown = presence.slice(0, 6);
  const overflow = presence.length - shown.length;

  return (
    <div className="presence-stack" aria-label={`${presence.length} people in room`}>
      {shown.map((person) => (
        <span
          className={`presence-dot${person.isSelf ? " self" : ""}`}
          key={person.id}
          style={{ backgroundColor: person.color }}
          title={`${person.label}${person.isSelf ? " (you)" : ""} · ${person.viewing}`}
        >
          {person.initial}
        </span>
      ))}
      {overflow > 0 ? <span className="presence-dot more">+{overflow}</span> : null}
      <span className="presence-count">{presence.length} here</span>
    </div>
  );
}

function SwarmStrip({ workers, activeCount }: { workers: AgentWorker[]; activeCount: number }) {
  if (workers.length === 0) return null;

  return (
    <div className="swarm-strip" aria-label="Agent swarm">
      <span className="swarm-label">
        <i className={`swarm-led${activeCount ? " on" : ""}`} />
        {activeCount ? `${activeCount} agent${activeCount === 1 ? "" : "s"} working` : "Agents idle"}
      </span>
      <div className="swarm-chips">
        {workers.slice(0, 5).map((worker) => (
          <span className={`swarm-chip${worker.active ? " active" : ""}`} key={worker.id} title={worker.detail}>
            <i className="swarm-chip-dot" />
            <b>{worker.name}</b>
            <span>{worker.status}</span>
          </span>
        ))}
      </div>
    </div>
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
