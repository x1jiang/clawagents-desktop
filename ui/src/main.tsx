import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import "./style.css";

import { GatewayClient } from "./lib/gateway";
import { tauriApi } from "./lib/tauri";
import { useProjects } from "./stores/projects";
import { useSettings } from "./stores/settings";
import { Route as RootRoute } from "./routes/__root";
import { Route as IndexRoute } from "./routes/index";

const routeTree = RootRoute.addChildren([IndexRoute]);
const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function Bootstrap() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setClient = useProjects((s) => s.setClient);
  const loadSettings = useSettings((s) => s.load);

  useEffect(() => {
    (async () => {
      try {
        const info = await tauriApi.getGatewayInfo();
        setClient(new GatewayClient(info.url, info.token));
        await loadSettings();
        setReady(true);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [setClient, loadSettings]);

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
  return <RouterProvider router={router} />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Bootstrap />
  </React.StrictMode>,
);
