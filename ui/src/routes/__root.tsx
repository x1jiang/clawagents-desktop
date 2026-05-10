import { Outlet, createRootRoute } from "@tanstack/react-router";
import { SidebarLayout } from "../layouts/SidebarLayout";

export const Route = createRootRoute({
  component: () => (
    <SidebarLayout>
      <Outlet />
    </SidebarLayout>
  ),
});
