import { createRoute } from "@tanstack/react-router";
import { Route as RootRoute } from "./__root";
import { WelcomeCard } from "../components/WelcomeCard";
import { SetupReadinessPanel } from "../components/SetupReadinessPanel";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/",
  component: () => (
    <div className="h-full flex flex-col items-center justify-center text-gray-500 px-6">
      <WelcomeCard />
      <div className="text-5xl mb-4" aria-hidden>🐾</div>
      <h2 className="text-lg text-gray-700 dark:text-gray-200 font-semibold mb-2">ClawAgents Desktop</h2>
      <p className="text-sm mb-6 text-center max-w-md">
        Point the agent at a project folder, or start a quick projectless chat.
      </p>
      <div className="text-xs text-gray-400 space-y-1 text-center max-w-md">
        <p>· Use <span className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">+ New project</span> in the sidebar to add a folder</p>
        <p>· Drop a <span className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">CLAUDE.md</span> in the folder to give the agent persistent context</p>
        <p>· Add API keys in <span className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">⚙ Settings</span> if you haven't already</p>
      </div>
      <div className="mt-6 w-full flex justify-center">
        <SetupReadinessPanel />
      </div>
    </div>
  ),
});
