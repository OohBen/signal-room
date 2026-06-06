import { DbConnection } from "./module_bindings";

export const SPACETIME_URI =
  import.meta.env.VITE_SPACETIME_URI || "wss://maincloud.spacetimedb.com";
export const SPACETIME_DATABASE =
  import.meta.env.VITE_SPACETIME_DATABASE || "signal-room";
export const SPACETIME_TOKEN_KEY = "signal-room.spacetime.token.v1";
export const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || "http://127.0.0.1:8787";

export function createSpacetimeConnectionBuilder() {
  return DbConnection.builder()
    .withUri(SPACETIME_URI)
    .withDatabaseName(SPACETIME_DATABASE)
    .withToken(window.localStorage.getItem(SPACETIME_TOKEN_KEY) || undefined);
}
