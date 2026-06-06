import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SpacetimeDBProvider } from "spacetimedb/react";
import App from "./App";
import { createSpacetimeConnectionBuilder } from "./config";
import "./styles.css";

const connectionBuilder = createSpacetimeConnectionBuilder();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <App />
    </SpacetimeDBProvider>
  </StrictMode>
);
