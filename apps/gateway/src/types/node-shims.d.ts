declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exitCode?: number;
  cwd(): string;
  on(event: string, listener: (...args: unknown[]) => void): void;
};

declare module "node:fs/promises" {
  export function readFile(path: string, encoding: BufferEncoding): Promise<string>;
  export function readFile(path: string): Promise<Uint8Array>;
  export function mkdtemp(prefix: string): Promise<string>;
  export function readdir(path: string): Promise<string[]>;
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
}

declare module "node:http" {
  export interface IncomingMessage {
    method?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
    on(event: "data", listener: (chunk: unknown) => void): void;
    on(event: "end", listener: () => void): void;
    on(event: "error", listener: (error: Error) => void): void;
  }

  export interface ServerResponse {
    statusCode: number;
    setHeader(name: string, value: string): void;
    end(chunk?: string): void;
  }

  export interface Server {
    listen(port: number, host: string, callback?: () => void): void;
    close(callback?: (error?: Error) => void): void;
  }

  export function createServer(
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
  ): Server;
}

declare module "node:child_process" {
  export interface SpawnOptions {
    cwd?: string;
    env?: Record<string, string | undefined>;
  }

  export interface ChildProcess {
    stdout?: {
      on(event: "data", listener: (chunk: unknown) => void): void;
    };
    stderr?: {
      on(event: "data", listener: (chunk: unknown) => void): void;
    };
    on(event: "error", listener: (error: Error) => void): void;
    on(event: "close", listener: (code: number | null) => void): void;
  }

  export function spawn(command: string, args?: string[], options?: SpawnOptions): ChildProcess;
}

declare module "node:os" {
  export function homedir(): string;
  export function tmpdir(): string;
}

declare module "node:path" {
  export function basename(path: string): string;
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
}

type BufferEncoding = "utf8" | "utf-8";
