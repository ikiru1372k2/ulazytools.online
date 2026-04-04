import type { ReactNode } from "react";

import AppNav from "@/components/nav/AppNav";

type ToolsLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function ToolsLayout({ children }: ToolsLayoutProps) {
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10 sm:px-10">
      <header className="mb-8">
        <AppNav currentPath="/tools" />
      </header>

      <div className="flex-1">{children}</div>
    </div>
  );
}
