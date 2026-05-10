import { createRoute } from "@tanstack/react-router";
import { Route as RootRoute } from "./__root";
import { ChatSurface } from "../components/ChatSurface";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/chat/$cid",
  component: function StandaloneChat() {
    const { cid } = Route.useParams();
    return <ChatSurface projectId={null} chatId={cid} />;
  },
});
