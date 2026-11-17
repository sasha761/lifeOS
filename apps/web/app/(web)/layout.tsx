import { LIFE_DOMAINS } from "@lifeos/domain";
import { SiteNav } from "@/components/site-nav";

// Plain data only: the client header must not pull the domain package into the browser bundle.
const navDomains = LIFE_DOMAINS.map((domain) => ({ key: domain.key, label: domain.name.ru, url: domain.url }));

/** `modal` is the `@modal` slot: «Новая цель» opened from a link appears over the current page (LFS-212). */
export default function WebLayout({ children, modal }: LayoutProps<"/">) {
  return (
    <div className="min-h-dvh">
      {/* Static links: /dashboard and /settings check the session themselves and redirect guests to sign-in. */}
      <header>
        <SiteNav domains={navDomains} />
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[calc(1180px+3rem)] min-w-0 px-4 pt-4 pb-12 sm:px-6 lg:pb-16">
        {children}
      </main>
      {modal}
    </div>
  );
}
