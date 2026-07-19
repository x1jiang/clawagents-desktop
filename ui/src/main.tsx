import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import "./style.css";

import { connectGateway } from "./lib/gateway_connection";
import { useSettings } from "./stores/settings";
import { useCustomCommands } from "./stores/custom_commands";
import { getLastPath } from "./lib/recent_chats";
// Side-effect: theme store reads stored preference and applies `dark` class
// on the html element when imported.
import "./stores/theme";
import { Route as RootRoute } from "./routes/__root";
import { Route as IndexRoute } from "./routes/index";
import { Route as ProjectRoute } from "./routes/project.$id";
import { Route as ProjectChatRoute } from "./routes/project.$id.chat.$cid";
import { Route as ChatRoute } from "./routes/chat.$cid";
import { Route as SettingsRoute } from "./routes/settings";
import { Route as StatsRoute } from "./routes/stats";
import { Route as CommandsRoute } from "./routes/commands";
import { Route as TemplatesRoute } from "./routes/templates";
import { Route as TrashRoute } from "./routes/trash";

const routeTree = RootRoute.addChildren([
  IndexRoute,
  ProjectRoute,
  ProjectChatRoute,
  ChatRoute,
  SettingsRoute,
  StatsRoute,
  CommandsRoute,
  TemplatesRoute,
  TrashRoute,
]);
const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function Bootstrap() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadSettings = useSettings((s) => s.load);

  useEffect(() => {
    (async () => {
      try {
        const client = await connectGateway();
        await loadSettings();
        // Custom commands are a best-effort load; if the dir is missing or
        // the endpoint errors, we just have an empty list — the built-in
        // slash commands still work.
        await useCustomCommands.getState().load(() => client.listCustomCommands());
        setReady(true);
        // Resume the last-visited chat path if the user had one open
        // before quitting. Skipped when the user is already on a
        // non-index route (Tauri always boots us to "/" so this is
        // mostly cosmetic, but it's good practice).
        try {
          const last = getLastPath();
          if (last && last !== "/" && window.location.pathname === "/") {
            router.navigate({ to: last } as any);
          }
        } catch { /* ignore */ }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [loadSettings]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center text-sm">
        <div className="text-red-600 dark:text-red-400 font-medium">Gateway failed to start</div>
        <pre className="max-w-xl whitespace-pre-wrap break-words text-left text-xs text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-900 p-3 rounded border border-gray-200 dark:border-gray-700">
          {error}
        </pre>
        <div className="text-gray-500 text-xs">
          Logs: ~/Library/Logs/ClawAgentsDesktop/
        </div>
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
