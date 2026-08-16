import { ReactNode } from "react";
import { BottomNav } from "./BottomNav";

export function MobileShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex h-svh max-h-svh min-h-0 w-full max-w-[480px] shrink-0 flex-col overflow-hidden">
      {/* h-svh: stable mobile viewport; scroll region + BottomNav in-column avoids mobile fixed/portal clipping */}
      <div className="app-main-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-scroll px-4 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
        {children}
      </div>
      <BottomNav />
    </div>
  );
}
