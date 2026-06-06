import { spawn } from "node:child_process";

export interface ReducerCallResult {
  reducer: string;
  ok: boolean;
  stdout: string;
  stderr: string;
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function callReducer(
  database: string,
  reducer: string,
  args: string[]
): Promise<ReducerCallResult> {
  const result = await runCommand("spacetime", ["call", database, reducer, ...args]);
  return {
    reducer,
    ok: result.code === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

export async function querySql(database: string, sql: string): Promise<string> {
  const result = await runCommand("spacetime", ["sql", database, sql]);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `spacetime sql exited ${result.code}`);
  }

  return result.stdout;
}

export function jsonString(value: string): string {
  return JSON.stringify(value);
}

export function optionU64(value: bigint | undefined): string {
  return value === undefined ? '{"none":{}}' : `{"some":${value.toString()}}`;
}

export function parseSqlTable(stdout: string): string[][] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes("|") && !/^-+\+/.test(line))
    .slice(1)
    .map((line) => line.split("|").map((cell) => stripSqlCell(cell.trim())));
}

function stripSqlCell(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }

  const optionMatch = value.match(/^\(some = (.+)\)$/);
  if (optionMatch) return stripSqlCell(optionMatch[1].trim());

  return value;
}

export function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
    });
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}
