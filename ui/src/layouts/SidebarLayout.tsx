import type { ReactNode } from "react";
import { Sidebar } from "../components/Sidebar";

export function SidebarLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full">
      <aside className="w-64 border-r border-gray-200 bg-gray-50 flex-shrink-0">
        <Sidebar />
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
