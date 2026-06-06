export interface NoSpeechPolicy {
  allowSpeechOutput: false;
  allowInterruptions: false;
  defaultDisposition: "listen_and_route";
  note: string;
}

export interface RouterTranscriptEvent {
  roomId: string;
  text: string;
  receivedAt?: string;
}

export interface RouterProposal {
  transcriptChunk?: {
    source: "Room conversation";
    text: string;
    observedAt: string;
  };
  mapProposal?: {
    title: string;
    summary: string;
  };
}

export interface OpenAiRealtimeRouter {
  readonly policy: NoSpeechPolicy;
  connect(): Promise<void>;
  close(): Promise<void>;
  routeTranscript(event: RouterTranscriptEvent): Promise<RouterProposal>;
}

export const DEFAULT_NO_SPEECH_POLICY: NoSpeechPolicy = {
  allowSpeechOutput: false,
  allowInterruptions: false,
  defaultDisposition: "listen_and_route",
  note: "MVP router is silent by default. It may create transcript chunks, map proposals, and tasks, but it must not speak or interrupt.",
};

export function createOpenAiRealtimeRouter(): OpenAiRealtimeRouter {
  return new PlaceholderOpenAiRealtimeRouter();
}

class PlaceholderOpenAiRealtimeRouter implements OpenAiRealtimeRouter {
  readonly policy = DEFAULT_NO_SPEECH_POLICY;

  async connect(): Promise<void> {
    return Promise.resolve();
  }

  async close(): Promise<void> {
    return Promise.resolve();
  }

  async routeTranscript(event: RouterTranscriptEvent): Promise<RouterProposal> {
    const observedAt = event.receivedAt ?? new Date().toISOString();
    return {
      transcriptChunk: {
        source: "Room conversation",
        text: event.text,
        observedAt,
      },
      mapProposal: {
        title: summarizeTitle(event.text),
        summary: event.text,
      },
    };
  }
}

function summarizeTitle(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "Room conversation";
  }

  if (normalized.length <= 60) {
    return normalized;
  }

  return `${normalized.slice(0, 57)}...`;
}
