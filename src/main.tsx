import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installClientErrorHooks } from "./lib/diagnostics";
import "./index.css";
import { applyFontSize, applyTheme, useUi } from "./store/ui";

// a webview crash must leave a trace on disk, not just a blank window
installClientErrorHooks();

applyTheme(useUi.getState().theme);
applyFontSize(useUi.getState().fontSize);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);