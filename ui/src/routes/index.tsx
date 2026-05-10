import { createRoute } from "@tanstack/react-router";
import { Route as RootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/",
  component: () => (
    <div className="flex h-full items-center justify-center text-gray-500 text-sm">
      Pick a project from the sidebar, or create a new one.
    </div>
  ),
});
