import type { ReactNode } from "react";
import { Brand } from "@/components/brand";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header>
        <div className="mx-auto flex h-14 max-w-[1180px] items-center px-4 sm:px-6">
          <Brand />
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-md px-4 py-8 sm:px-5 sm:py-14">
        {children}
      </main>
    </div>
  );
}
