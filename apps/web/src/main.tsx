import { createRoot } from "react-dom/client";
import { SpacetimeDBProvider } from "spacetimedb/react";
import App from "./App";
import { createSpacetimeConnectionBuilder } from "./config";
import "./styles.css";

// Note: StrictMode is intentionally omitted. Its double-invocation races with the
// SpacetimeDB React SDK's per-table subscription timing (useTable runs a different
// number of hooks until a table's subscription applies), which surfaces as a
// false "change in order of Hooks" warning on first connect.
const connectionBuilder = createSpacetimeConnectionBuilder();

createRoot(document.getElementById("root") as HTMLElement).render(
  <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
    <App />
  </SpacetimeDBProvider>
);
