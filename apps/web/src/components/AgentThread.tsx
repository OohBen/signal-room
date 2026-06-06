import { ArrowLeft, ArrowRight, GitBranch, ListChecks } from "lucide-react";
import { useState } from "react";
import type { SignalRoomSnapshot } from "../adapters/roomAdapter";
import type { ScreenId } from "../types/signalRoom";
import { PanelTitle } from "./Primitives";

interface AgentThreadProps {
  room: SignalRoomSnapshot;
  onScreenChange: (screen: ScreenId) => void;
  onToast: (message: string) => void;
}

const defaultRedirect =
  "Check production volume, not just headlines. Also compare this to the old CPI sensitivity note.";

export function AgentThread({ room, onScreenChange, onToast }: AgentThreadProps) {
  const { state, actions } = room;
  const [redirect, setRedirect] = useState(defaultRedirect);

  function sendRedirect() {
    if (!redirect.trim()) {
      onToast("Add a note before redirecting");
      return;
    }

    actions.redirectAgent(redirect);
    onToast("Agent redirected with human feedback");
  }

  return (
    <section className="screen active" aria-label="Agent thread">
      <div className="thread-grid">
        <section className="panel agent-workspace">
          <div className="thread-hero">
            <div>
              <h2>{state.thread.title}</h2>
              <p>{state.thread.summary}</p>
            </div>
            <div className="score-stack">
              <div className="score">
                <strong>{state.thread.impact}</strong>
                <span>estimated impact</span>
              </div>
              <button className="ghost-btn" type="button" onClick={() => onScreenChange("room")}>
                <ArrowLeft size={16} strokeWidth={2.1} />
                Back to room
              </button>
            </div>
          </div>

          <div className="timeline">
            {state.thread.steps.map((step) => (
              <article className="step" key={step.id}>
                <b>{step.title}</b>
                <span>{step.body}</span>
              </article>
            ))}
          </div>

          <div className="thread-body">
            <article className="answer">
              <h3>Agent finding</h3>
              <p>{state.thread.findingParagraph}</p>
              <ul>
                {state.thread.findingBullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            </article>

            <article className="answer">
              <h3>Human edits and objections</h3>
              {state.thread.humanEdits.map((edit) => (
                <p key={edit}>{edit}</p>
              ))}
            </article>
          </div>
        </section>

        <aside className="panel">
          <div className="panel-head">
            <PanelTitle>
              <GitBranch size={17} strokeWidth={2.1} />
              Redirect Agent
            </PanelTitle>
            <span className="panel-sub">live</span>
          </div>
          <div className="intervene">
            <textarea
              aria-label="Redirect agent"
              value={redirect}
              onChange={(event) => setRedirect(event.target.value)}
            />
            <button className="primary-btn" type="button" onClick={sendRedirect}>
              <ArrowRight size={17} strokeWidth={2.1} />
              Redirect research
            </button>
            <button
              className="ghost-btn"
              type="button"
              onClick={() => onToast("Agent marked this as a watch item")}
            >
              <ListChecks size={17} strokeWidth={2.1} />
              Mark as watch item
            </button>
            <button
              className="danger-btn"
              type="button"
              onClick={() => onToast("Agent finding challenged by human reviewer")}
            >
              Challenge finding
            </button>

            <article className="source-row">
              <strong>Sources checked</strong>
              <span>{state.thread.sourceSummary}</span>
            </article>
            <article className="source-row">
              <strong>Agent question</strong>
              <span>{state.thread.agentQuestion}</span>
            </article>
            <article className="source-row">
              <strong>Next update</strong>
              <span>{state.thread.nextUpdate}</span>
            </article>
          </div>
        </aside>
      </div>
    </section>
  );
}
