import type { ReactNode } from "react";
import { Brand } from "@/components/brand";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b bg-card">
        <div className="mx-auto flex min-h-20 max-w-360 items-center px-5 sm:px-8">
          <Brand />
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-md px-5 py-10 sm:py-16">
        {children}
      </main>
    </div>
  );
}
