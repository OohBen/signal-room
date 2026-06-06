import { AlignLeft, ListTree } from "lucide-react";
import type { SignalRoomSnapshot } from "../adapters/roomAdapter";
import { Chip, ChipRow, PanelTitle } from "./Primitives";

interface TranscriptChunksProps {
  room: SignalRoomSnapshot;
}

export function TranscriptChunks({ room }: TranscriptChunksProps) {
  const { state } = room;

  return (
    <section className="screen active" aria-label="Transcript chunks">
      <div className="transcript-grid">
        <section className="panel side-stack">
          <div className="panel-head">
            <PanelTitle>
              <AlignLeft size={17} strokeWidth={2.1} />
              Transcript
            </PanelTitle>
            <span className="panel-sub">review, not TV</span>
          </div>
          <div className="transcript">
            {state.transcript.map((utterance) => (
              <article className="utterance" key={utterance.id}>
                <strong>
                  {utterance.speaker}
                  <span>{utterance.timestamp}</span>
                </strong>
                <p>{utterance.text}</p>
                <ChipRow chips={utterance.chips} />
              </article>
            ))}
          </div>
        </section>

        <aside className="panel side-stack">
          <div className="panel-head">
            <PanelTitle>
              <ListTree size={17} strokeWidth={2.1} />
              Topic Chunks
            </PanelTitle>
            <span className="panel-sub">map input</span>
          </div>
          <div className="side-content">
            {state.topicChunks.map((chunk) => (
              <article className="queue-row" key={chunk.id}>
                <div className="queue-meta">
                  <strong>{chunk.window}</strong>
                  <Chip chip={chunk.chip} />
                </div>
                <span>{chunk.summary}</span>
              </article>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}
