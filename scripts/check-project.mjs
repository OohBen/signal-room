import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const rootChecks = [
  ["PLAN.md", "project plan"],
  ["SPECS.md", "product/technical spec"],
  ["TASKS.md", "sprint tracker"],
  ["STATUS.md", "status tracker"],
  ["apps/spacetime/spacetimedb/src/index.ts", "SpacetimeDB module"],
  ["mocks/research-room/index.html", "static mock"],
];

const futureChecks = [
  ["apps/web/package.json", "web app"],
  ["apps/gateway/package.json", "agent gateway"],
];

function commandVersion(command, args = ["--version"]) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
      .split("\n")[0]
      .trim();
  } catch {
    return null;
  }
}

function envNames() {
  const path = join(homedir(), ".ai.env");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map(line => line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/)?.[1])
    .filter(Boolean)
    .sort();
}

const names = envNames();
const requiredEnv = ["OPENAI_API_KEY", "EXA_API_KEY"];

console.log("Signal Room project status\n");

for (const [path, label] of rootChecks) {
  console.log(`${existsSync(path) ? "ok " : "miss"} ${label}: ${path}`);
}

console.log("\nSlices");
for (const [path, label] of futureChecks) {
  console.log(`${existsSync(path) ? "ok " : "todo"} ${label}: ${path}`);
}

console.log("\nTools");
console.log(`node: ${commandVersion("node") ?? "missing"}`);
console.log(`pnpm: ${commandVersion("pnpm") ?? "missing"}`);
console.log(`spacetime: ${commandVersion("spacetime") ?? "missing"}`);

console.log("\nEnv");
for (const key of requiredEnv) {
  console.log(`${names.includes(key) ? "ok " : "miss"} ${key}`);
}

