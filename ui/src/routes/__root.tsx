import { Outlet, createRootRoute } from "@tanstack/react-router";
import { SidebarLayout } from "../layouts/SidebarLayout";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { ToastStack } from "../components/ToastStack";

export const Route = createRootRoute({
  component: () => (
    <div className="flex flex-col h-full">
      <ConnectionBanner />
      <div className="flex-1 min-h-0">
        <SidebarLayout>
          <Outlet />
        </SidebarLayout>
      </div>
      <ToastStack />
    </div>
  ),
});
