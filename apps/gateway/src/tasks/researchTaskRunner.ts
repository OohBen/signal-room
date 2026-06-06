import type { ResearchClient, ResearchSearchMode, ResearchSource } from "../clients/exa.js";

export type Urgency = "low" | "medium" | "high";

export interface ResearchTaskInput {
  taskId?: string;
  roomId?: string;
  query: string;
  taskType?: string;
  connectedNode: ConnectedNode;
  urgencyHint?: Urgency;
}

export interface ConnectedNode {
  id: string;
  title?: string;
}

export interface SourceLink {
  title: string;
  url: string;
}

export interface SuggestedMapUpdate {
  action: "add_finding_node";
  title: string;
  summary: string;
  edgeLabel: string;
}

export interface ResearchTaskOutput {
  taskId?: string;
  summary: string;
  sourceLinks: SourceLink[];
  connectedNode: ConnectedNode;
  urgency: Urgency;
  suggestedMapUpdate: SuggestedMapUpdate;
  provider: "exa" | "exa_answer";
  mode: ResearchSearchMode;
  completedAt: string;
}

export class ResearchTaskRunner {
  constructor(private readonly client: ResearchClient) {}

  async run(input: ResearchTaskInput): Promise<ResearchTaskOutput> {
    const mode = researchModeForTask(input.taskType);
    const query = buildResearchQuery(input);
    const searchResult = await this.client.search({
      query,
      numResults: mode === "quick" ? 10 : 8,
      mode,
    });
    const sourceLinks = toSourceLinks(searchResult.sources);
    const summary = buildSummary(input.query, searchResult.sources, searchResult.answer);
    const urgency = inferOutputUrgency(input, summary);

    return {
      taskId: input.taskId,
      summary,
      sourceLinks,
      connectedNode: input.connectedNode,
      urgency,
      suggestedMapUpdate: {
        action: "add_finding_node",
        title: buildFindingTitle(input.query),
        summary,
        edgeLabel: "research finding",
      },
      provider: searchResult.provider,
      mode: searchResult.mode,
      completedAt: new Date().toISOString(),
    };
  }
}

function buildResearchQuery(input: ResearchTaskInput): string {
  const nodeTitle = input.connectedNode.title?.trim();
  return [
    `Live Signal Room research task: ${input.query.trim()}`,
    nodeTitle ? `Connected map factor: ${nodeTitle}` : "",
    "Fact-check the room's framing. If public evidence contradicts the premise, say so directly.",
    "Return: Verdict, key evidence, impact on the room's current discussion, and sources.",
  ]
    .filter(Boolean)
    .join("\n");
}
function toSourceLinks(sources: ResearchSource[]): SourceLink[] {
  return sources.slice(0, 5).map((source) => ({
    title: source.title,
    url: source.url,
  }));
}

function buildSummary(query: string, sources: ResearchSource[], answer: string | undefined): string {
  if (answer?.trim()) {
    const compact = answer.trim().replace(/\s+/g, " ");
    return compact.length <= 640 ? compact : `${compact.slice(0, 637)}...`;
  }

  if (sources.length === 0) {
    return `No sources were returned for "${query}". Keep the task open or retry with a narrower query.`;
  }

  const titles = sources
    .slice(0, 3)
    .map((source) => source.title)
    .join("; ");

  return `Research for "${query}" found ${sources.length} source${sources.length === 1 ? "" : "s"}. Top signals: ${titles}.`;
}

function researchModeForTask(taskType: string | undefined): ResearchSearchMode {
  const normalized = taskType?.toLowerCase().trim();
  if (normalized === "quick_research" || normalized === "fast_research") return "quick";
  return "deep";
}

function buildFindingTitle(query: string): string {
  const normalized = query.trim().replace(/\s+/g, " ");
  if (normalized.length <= 72) {
    return normalized;
  }

  return `${normalized.slice(0, 69)}...`;
}

function inferUrgency(query: string): Urgency {
  const normalized = query.toLowerCase();
  if (/\b(blocker|critical|urgent|outage|risk|deadline|security)\b/.test(normalized)) {
    return "high";
  }

  if (/\b(soon|decision|compare|validate|launch|demo)\b/.test(normalized)) {
    return "medium";
  }

  return "low";
}

function inferOutputUrgency(input: ResearchTaskInput, summary: string): Urgency {
  const normalized = `${input.query} ${summary}`.toLowerCase();
  if (/\b(?:verdict:\s*)?contradicts?\b|\bmaterial contradiction\b|\bgame-changing\b|\bmaterially changes?\b/.test(normalized)) {
    return "high";
  }
  return input.urgencyHint ?? inferUrgency(input.query);
}
