import { createRoute, useNavigate } from "@tanstack/react-router";
import { Route as RootRoute } from "./__root";
import { SettingsModal } from "../components/SettingsModal";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/settings",
  component: function Settings() {
    const navigate = useNavigate();
    return <SettingsModal onClose={() => navigate({ to: "/" } as any)} />;
  },
});
