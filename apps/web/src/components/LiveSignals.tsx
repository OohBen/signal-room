import { ArrowUpRight, ChevronRight, Network, Radio, Sparkles, X } from "lucide-react";
import { useState } from "react";
import type { RoomSignal } from "../types/signalRoom";

export interface RootAnswer {
  question: string;
  answer: string;
  state: string;
  confidence: string;
}

interface LiveSignalsProps {
  signals: RoomSignal[];
  activeAgents: number;
  rootAnswer?: RootAnswer;
  canRunFleet: boolean;
  fleetRunning: boolean;
  onRunFleet: () => void;
  onOpenNode: (nodeId: string) => void;
  onClose: () => void;
  onHide: () => void;
}

const KIND_LABEL: Record<RoomSignal["kind"], string> = {
  answer: "Question",
  important: "Important",
  finding: "Finding",
};

export function LiveSignals({
  signals,
  activeAgents,
  rootAnswer,
  canRunFleet,
  fleetRunning,
  onRunFleet,
  onOpenNode,
  onClose,
  onHide,
}: LiveSignalsProps) {
  const fleetThinking = fleetRunning || rootAnswer?.state === "working";
  const fleetDisabled = fleetThinking || !canRunFleet;

  return (
    <aside className="panel right live-signals">
      <div className="panel-head">
        <Radio size={15} strokeWidth={2.1} />
        <span className="t">Live signals</span>
        <span className="sp" />
        <button
          className="run-fleet"
          type="button"
          onClick={onRunFleet}
          disabled={fleetDisabled}
          title={canRunFleet ? undefined : "Map needs a topic before the fleet can run"}
        >
          <Network size={13} strokeWidth={2.2} />
          {!canRunFleet ? "Waiting for map" : fleetThinking ? "Fleet thinking…" : "Run agent fleet"}
        </button>
        <button className="icon-btn mini" type="button" onClick={onClose} title="Close">
          <X size={15} strokeWidth={2.1} />
        </button>
        <button className="icon-btn mini" type="button" onClick={onHide} title="Hide panel">
          <ChevronRight size={15} strokeWidth={2.1} />
        </button>
      </div>

      <div className="panel-body">
        {rootAnswer ? (
          <article className={`working-answer${fleetThinking ? " thinking" : ""}`}>
            <div className="wa-top">
              <Network size={13} strokeWidth={2.2} />
              <span>{fleetThinking ? "Fleet synthesizing answer" : "Working answer"}</span>
              <span className="sp" />
              <span className="wa-confidence">{rootAnswer.confidence}</span>
            </div>
            <h3 className="wa-question">{rootAnswer.question}</h3>
            <p className="wa-answer">
              {rootAnswer.answer || "Agents are researching the factors and synthesizing an answer…"}
            </p>
          </article>
        ) : null}

        <p className="signals-lead">
          {activeAgents
            ? `${activeAgents} agent${activeAgents === 1 ? "" : "s"} working across the map.`
            : "What the room should glance at — agent answers and important findings, newest and most urgent first."}
        </p>

        {signals.length === 0 ? (
          <div className="signals-empty">
            <Sparkles size={20} strokeWidth={1.8} />
            <h3>Listening to the room</h3>
            <p>
              As people talk, the map fills in. Say <b>&ldquo;Hey agent, &hellip;&rdquo;</b> to ask a quick
              question — the answer lands here. Important findings surface here too, without interrupting anyone.
            </p>
          </div>
        ) : (
          <div className="signals-list">
            {signals.map((signal) => (
              <SignalCard key={signal.id} signal={signal} onOpenNode={onOpenNode} />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function SignalCard({ signal, onOpenNode }: { signal: RoomSignal; onOpenNode: (nodeId: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const body = formatSignalBody(signal.body);
  const visibleBody = expanded ? body.full : body.preview;

  return (
    <article className={`signal-card ${signal.kind}`}>
      <div className="signal-top">
        <span className={`signal-badge ${signal.kind}`}>{KIND_LABEL[signal.kind]}</span>
        <span className="sp" />
        <span className="signal-on" title={`On: ${signal.connectedNodeTitle}`}>{signal.connectedNodeTitle}</span>
      </div>
      <h3 className="signal-title">{signal.title}</h3>
      <p className="signal-body">{visibleBody}</p>
      {body.canExpand ? (
        <button className="inline-action signal-expand" type="button" onClick={() => setExpanded((open) => !open)}>
          {expanded ? "Show less" : "Show full finding"}
        </button>
      ) : null}
      {signal.sources.length ? (
        <div className="signal-sources">
          {signal.sources.map((source, index) =>
            source.href ? (
              <a className="signal-source" href={source.href} key={index} target="_blank" rel="noreferrer">
                {source.label}
                <ArrowUpRight size={12} strokeWidth={2.2} />
              </a>
            ) : (
              <span className="signal-source" key={index}>
                {source.label}
              </span>
            )
          )}
        </div>
      ) : null}
      {signal.connectedNodeId ? (
        <button className="inline-action" type="button" onClick={() => onOpenNode(signal.connectedNodeId as string)}>
          Open on map
        </button>
      ) : null}
    </article>
  );
}

function formatSignalBody(raw: string): { preview: string; full: string; canExpand: boolean } {
  const full = raw.replace(/\s+/g, " ").trim();
  const verdictMatch = full.match(/\bVerdict:\s*([^.!?]+[.!?]?)/i);
  const lead = verdictMatch?.[0]?.trim();
  const body = lead ? full.replace(lead, "").trim() : full;
  const limit = 360;
  const previewSource = lead ? `${lead} ${body}`.trim() : body;
  const preview =
    previewSource.length <= limit ? previewSource : `${previewSource.slice(0, limit - 3).trim()}...`;
  return {
    preview,
    full,
    canExpand: full.length > preview.length,
  };
}
