import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface EnvLoadOptions {
  path?: string;
  overwrite?: boolean;
}

export interface EnvLoadResult {
  sourcePath: string;
  found: boolean;
  loadedNames: string[];
  skippedNames: string[];
}

export interface GatewayRuntimeEnv {
  hasOpenAiApiKey: boolean;
  hasExaApiKey: boolean;
  hasOpenRouterApiKey: boolean;
  envFile: EnvLoadResult;
}

export function defaultAiEnvPath(): string {
  return join(homedir(), ".ai.env");
}

export function defaultEnvPaths(): string[] {
  return [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../..", ".env"),
    defaultAiEnvPath(),
  ];
}

export async function loadAiEnv(options: EnvLoadOptions = {}): Promise<EnvLoadResult> {
  const sourcePaths = options.path ? [resolve(options.path)] : uniquePaths(defaultEnvPaths());

  for (const sourcePath of sourcePaths) {
    let raw: string;
    try {
      raw = await readFile(sourcePath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        continue;
      }

      throw new Error(`Unable to read env file at ${sourcePath}`);
    }

    return loadEnvFile(raw, sourcePath, options);
  }

  return {
    sourcePath: sourcePaths[0] ?? defaultAiEnvPath(),
    found: false,
    loadedNames: [],
    skippedNames: [],
  };
}

function loadEnvFile(raw: string, sourcePath: string, options: EnvLoadOptions): EnvLoadResult {
  const loadedNames: string[] = [];
  const skippedNames: string[] = [];

  for (const entry of parseEnvFile(raw, sourcePath)) {
    if (!options.overwrite && hasSecret(entry.name)) {
      skippedNames.push(entry.name);
      continue;
    }

    process.env[entry.name] = entry.value;
    loadedNames.push(entry.name);
  }

  return {
    sourcePath,
    found: true,
    loadedNames,
    skippedNames,
  };
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}

export function getGatewayRuntimeEnv(envFile: EnvLoadResult): GatewayRuntimeEnv {
  return {
    hasOpenAiApiKey: hasSecret("OPENAI_API_KEY"),
    hasExaApiKey: hasSecret("EXA_API_KEY"),
    hasOpenRouterApiKey: hasSecret("OPENROUTER_API_KEY"),
    envFile,
  };
}

export function getSecret(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function hasSecret(name: string): boolean {
  return getSecret(name) !== undefined;
}

interface ParsedEnvEntry {
  name: string;
  value: string;
}

function parseEnvFile(raw: string, sourcePath: string): ParsedEnvEntry[] {
  const entries: ParsedEnvEntry[] = [];
  const lines = raw.split(/\r?\n/);

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trimStart() : trimmed;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error(`Invalid env assignment in ${sourcePath} at line ${index + 1}`);
    }

    const name = normalized.slice(0, separatorIndex).trim();
    if (!ENV_NAME_PATTERN.test(name)) {
      throw new Error(`Invalid env name in ${sourcePath} at line ${index + 1}`);
    }

    const rawValue = normalized.slice(separatorIndex + 1).trim();
    entries.push({
      name,
      value: parseEnvValue(rawValue),
    });
  });

  return entries;
}

function parseEnvValue(rawValue: string): string {
  if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
    return rawValue.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }

  if (rawValue.startsWith("'") && rawValue.endsWith("'")) {
    return rawValue.slice(1, -1);
  }

  return rawValue.replace(/\s+#.*$/, "").trim();
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
