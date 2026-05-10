import { createRoute } from "@tanstack/react-router";
import { Route as RootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/settings",
  component: function Settings() {
    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold text-gray-800">Settings</h1>
        <p className="text-sm text-gray-500 mt-4">Settings — implemented in a later task.</p>
      </div>
    );
  },
});
