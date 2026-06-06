import { Exa } from "exa-js";
import { getSecret } from "../config/env.js";

export type ResearchSearchMode = "quick" | "deep";

export interface ResearchSearchInput {
  query: string;
  numResults?: number;
  mode?: ResearchSearchMode;
}

export interface ResearchSource {
  title: string;
  url: string;
  publishedDate?: string;
  author?: string;
  text?: string;
}

export interface ResearchSearchResult {
  provider: "exa" | "exa_answer";
  mode: ResearchSearchMode;
  query: string;
  answer?: string;
  sources: ResearchSource[];
}

export interface ResearchClient {
  search(input: ResearchSearchInput): Promise<ResearchSearchResult>;
}

export interface ExaClientOptions {
  apiKey?: string;
}

export function createExaResearchClient(options: ExaClientOptions = {}): ResearchClient {
  const apiKey = options.apiKey ?? getSecret("EXA_API_KEY");
  if (!apiKey) {
    throw new Error("EXA_API_KEY is required for research; set it in .env or ~/.ai.env");
  }

  return new ExaResearchClient({ apiKey });
}

class ExaResearchClient implements ResearchClient {
  private readonly client: Exa;

  constructor(options: Required<Pick<ExaClientOptions, "apiKey">>) {
    this.client = new Exa(options.apiKey);
  }

  async search(input: ResearchSearchInput): Promise<ResearchSearchResult> {
    const mode = input.mode ?? "quick";
    if (mode === "deep") {
      return this.deepAnswer(input);
    }

    return this.quickAnswer(input);
  }

  private async quickAnswer(input: ResearchSearchInput): Promise<ResearchSearchResult> {
    const response = await this.client.answer(input.query, {
      text: false,
      model: "exa",
      systemPrompt: [
        "You are a fast fact-checking research agent for a live Signal Room meeting.",
        "Answer in 4-6 concise sentences.",
        "Start with 'Verdict: confirms', 'Verdict: contradicts', or 'Verdict: unclear'.",
        "Call out any material contradiction or game-changing update plainly.",
        "Use only public/current sources and cite enough context for a human to judge.",
      ].join(" "),
    });

    return {
      provider: "exa_answer",
      mode: "quick",
      query: input.query,
      answer: normalizeAnswer(response.answer),
      sources: normalizeExaResults(response.citations),
    };
  }

  private async deepAnswer(input: ResearchSearchInput): Promise<ResearchSearchResult> {
    let answer = "";
    const citations = new Map<string, ExaResult>();

    for await (const chunk of this.client.streamAnswer(input.query, {
      text: true,
      model: "exa-pro",
      systemPrompt: [
        "You are doing background research for a live Signal Room meeting.",
        "Be concise, evidence-first, and useful for updating a shared research map.",
        "Prefer current public sources, primary sources, filings, reputable news, and named citations.",
        "Do not speculate beyond the cited evidence.",
      ].join(" "),
    })) {
      if (chunk.content) {
        answer += chunk.content;
      }
      for (const citation of chunk.citations ?? []) {
        if (citation.url && !citations.has(citation.url)) {
          citations.set(citation.url, citation);
        }
      }
    }

    return {
      provider: "exa_answer",
      mode: "deep",
      query: input.query,
      answer: answer.trim(),
      sources: normalizeExaResults([...citations.values()]),
    };
  }
}

function normalizeAnswer(answer: string | Record<string, unknown>): string {
  if (typeof answer === "string") return answer.trim();
  return JSON.stringify(answer);
}

class MockExaResearchClient implements ResearchClient {
  async search(input: ResearchSearchInput): Promise<ResearchSearchResult> {
    const encodedQuery = encodeURIComponent(input.query.toLowerCase().replace(/\s+/g, "-"));
    return {
      provider: "mock",
      mode: input.mode ?? "quick",
      query: input.query,
      answer: `Mock research fallback used for "${input.query}".`,
      sources: [
        {
          title: `Mock source for ${input.query}`,
          url: `https://example.test/research/${encodedQuery}`,
          text: "Mock research fallback used because EXA_API_KEY was not present or mock mode was requested.",
        },
      ],
    };
  }
}

class FallbackResearchClient implements ResearchClient {
  constructor(
    private readonly primary: ResearchClient,
    private readonly fallback: ResearchClient
  ) {}

  async search(input: ResearchSearchInput): Promise<ResearchSearchResult> {
    try {
      return await this.primary.search(input);
    } catch (error: unknown) {
      console.warn(
        error instanceof Error
          ? `Exa search failed; falling back to mock research: ${error.message}`
          : "Exa search failed; falling back to mock research"
      );
      return this.fallback.search(input);
    }
  }
}

interface ExaResult {
  title?: string | null;
  url?: string;
  publishedDate?: string;
  author?: string;
  text?: string;
  highlights?: string[];
}

function normalizeExaResults(results: readonly ExaResult[] | undefined): ResearchSource[] {
  return (results ?? [])
    .filter((result): result is ExaResult & { url: string } => typeof result.url === "string" && result.url.length > 0)
    .map((result) => ({
      title: result.title?.trim() || result.url,
      url: result.url,
      publishedDate: result.publishedDate,
      author: result.author,
      text: result.text ?? result.highlights?.join("\n"),
    }));
}
