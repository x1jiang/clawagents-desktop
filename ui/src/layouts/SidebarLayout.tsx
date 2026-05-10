import type { ReactNode } from "react";

export function SidebarLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full">
      <aside className="w-64 border-r border-gray-200 bg-gray-50">{/* sidebar in Task 6 */}</aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
