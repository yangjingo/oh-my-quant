import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createFixtureClient } from "./fixtures.ts";
import { Workbench } from "./Workbench.tsx";
import "./styles/app.css";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

/**
 * Entry selection lives here and only here. The Electron build and the Host
 * served build pass their own client; until that exists, the fixture is used
 * and the status bar says so rather than pretending a Host is attached.
 */
createRoot(container).render(
  <StrictMode>
    <Workbench client={createFixtureClient()} />
  </StrictMode>,
);
