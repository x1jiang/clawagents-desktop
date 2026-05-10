import { createRoute } from "@tanstack/react-router";
import { Route as RootRoute } from "./__root";
import { ChatSurface } from "../components/ChatSurface";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/project/$id/chat/$cid",
  component: function ProjectChat() {
    const { id, cid } = Route.useParams();
    return <ChatSurface projectId={id} chatId={cid} />;
  },
});
