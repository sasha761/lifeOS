import type { ReactNode } from "react";
import { LIFE_DOMAINS } from "@lifeos/domain";
import { SiteNav } from "@/components/site-nav";

// Plain data only: the client header must not pull the domain package into the browser bundle.
const navDomains = LIFE_DOMAINS.map((domain) => ({ key: domain.key, label: domain.name.ru, url: domain.url }));

export default function WebLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      {/* Static links: /dashboard and /settings check the session themselves and redirect guests to sign-in. */}
      <header>
        <SiteNav domains={navDomains} />
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1180px] min-w-0 px-4 pt-6 pb-12 sm:px-6 lg:pt-10 lg:pb-16">
        {children}
      </main>
    </div>
  );
}
