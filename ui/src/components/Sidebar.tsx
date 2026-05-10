import { useEffect, useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { useProjects } from "../stores/projects";
import { useChats } from "../stores/chats";
import { NewProjectModal } from "./NewProjectModal";

export function Sidebar() {
  const projects = useProjects((s) => s.projects);
  const refreshProjects = useProjects((s) => s.refresh);
  const client = useProjects((s) => s.client);
  const setChatList = useChats((s) => s.setChatList);
  const byProject = useChats((s) => s.byProject);
  const projectless = useChats((s) => s.projectless);
  const router = useRouter();

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showNewProject, setShowNewProject] = useState(false);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  async function toggleProject(projectId: string) {
    setExpanded((e) => ({ ...e, [projectId]: !e[projectId] }));
    if (!byProject[projectId] && client) {
      const chats = await client.listProjectChats(projectId);
      setChatList(projectId, chats);
    }
  }

  async function newChat(projectId: string) {
    if (!client) return;
    const created = await client.createProjectChat(projectId, { title: "New chat" });
    const chats = await client.listProjectChats(projectId);
    setChatList(projectId, chats);
    router.navigate({ to: "/project/$id/chat/$cid", params: { id: projectId, cid: created.chat_id } });
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-gray-200">
        <button
          className="w-full px-3 py-1.5 bg-gray-900 text-white text-sm rounded-md hover:bg-gray-700"
          onClick={() => setShowNewProject(true)}
        >
          + New project
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <div className="text-xs uppercase tracking-wide text-gray-500 px-2 py-1">Projects</div>
        {projects.map((p) => {
          const isOpen = expanded[p.id];
          const chats = byProject[p.id] ?? [];
          return (
            <div key={p.id}>
              <button
                className="w-full text-left px-2 py-1 hover:bg-gray-100 rounded text-sm"
                onClick={() => toggleProject(p.id)}
              >
                {isOpen ? "▾" : "▸"} 📁 {p.name}
              </button>
              {isOpen && (
                <div className="ml-4">
                  <button
                    className="w-full text-left px-2 py-1 text-xs text-gray-500 hover:text-gray-800"
                    onClick={() => newChat(p.id)}
                  >
                    + new chat
                  </button>
                  {chats.map((c) => (
                    <Link
                      key={c.id}
                      to="/project/$id/chat/$cid"
                      params={{ id: p.id, cid: c.id }}
                      className="block px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 rounded truncate"
                      activeProps={{ className: "block px-2 py-1 text-sm bg-gray-200 rounded truncate" }}
                    >
                      {c.title}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <div className="text-xs uppercase tracking-wide text-gray-500 px-2 py-1 mt-3">Chats</div>
        {projectless.map((c) => (
          <Link
            key={c.id}
            to="/chat/$cid"
            params={{ cid: c.id }}
            className="block px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 rounded truncate"
            activeProps={{ className: "block px-2 py-1 text-sm bg-gray-200 rounded truncate" }}
          >
            {c.title}
          </Link>
        ))}
      </div>

      <div className="p-2 border-t border-gray-200">
        <Link
          to="/settings"
          className="block px-2 py-1 text-sm text-gray-600 hover:text-gray-800"
        >
          ⚙️ Settings
        </Link>
      </div>

      {showNewProject && <NewProjectModal onClose={() => setShowNewProject(false)} />}
    </div>
  );
}
