import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "./style.css";

import { GatewayClient } from "./lib/gateway";
import { tauriApi } from "./lib/tauri";
import { useProjects } from "./stores/projects";
import { ProjectList } from "./components/ProjectList";

function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setClient = useProjects((s) => s.setClient);

  useEffect(() => {
    tauriApi
      .getGatewayInfo()
      .then((info) => {
        setClient(new GatewayClient(info.url, info.token));
        setReady(true);
      })
      .catch((e) => setError((e as Error).message));
  }, [setClient]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-red-600 text-sm">
        Gateway not reachable: {error}
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-gray-500 text-sm">
        Connecting to gateway…
      </div>
    );
  }
  return <ProjectList />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
