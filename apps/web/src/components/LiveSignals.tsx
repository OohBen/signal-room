import { ArrowUpRight, ChevronRight, Radio, Sparkles, X } from "lucide-react";
import type { RoomSignal } from "../types/signalRoom";

interface LiveSignalsProps {
  signals: RoomSignal[];
  activeAgents: number;
  onOpenNode: (nodeId: string) => void;
  onClose: () => void;
  onHide: () => void;
}

const KIND_LABEL: Record<RoomSignal["kind"], string> = {
  answer: "You asked",
  important: "Important",
  finding: "Finding",
};

export function LiveSignals({ signals, activeAgents, onOpenNode, onClose, onHide }: LiveSignalsProps) {
  return (
    <aside className="panel right live-signals">
      <div className="panel-head">
        <Radio size={15} strokeWidth={2.1} />
        <span className="t">Live signals</span>
        <span className="sp" />
        <span className="badge">
          {activeAgents ? `${activeAgents} agent${activeAgents === 1 ? "" : "s"} working` : `${signals.length} cards`}
        </span>
        <button className="icon-btn mini" type="button" onClick={onClose} title="Close">
          <X size={15} strokeWidth={2.1} />
        </button>
        <button className="icon-btn mini" type="button" onClick={onHide} title="Hide panel">
          <ChevronRight size={15} strokeWidth={2.1} />
        </button>
      </div>

      <div className="panel-body">
        <p className="signals-lead">
          What the room should glance at — agent answers and important findings, newest and most urgent first.
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
  return (
    <article className={`signal-card ${signal.kind}`}>
      <div className="signal-top">
        <span className={`signal-badge ${signal.kind}`}>{KIND_LABEL[signal.kind]}</span>
        <span className="sp" />
        <span className="signal-on" title={`On: ${signal.connectedNodeTitle}`}>{signal.connectedNodeTitle}</span>
      </div>
      <h3 className="signal-title">{signal.title}</h3>
      <p className="signal-body">{signal.body}</p>
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
