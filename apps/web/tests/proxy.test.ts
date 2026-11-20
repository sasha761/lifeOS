import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../proxy.ts";

const request = (path: string, cookie?: string) => new NextRequest(`http://lifeos.test${path}`, { headers: cookie ? { cookie } : {} });
const rewrite = (path: string) => proxy(request(path)).headers.get("x-middleware-rewrite");

describe("proxy (LFS-201 guard, LFS-213 sphere keys)", () => {
  it("passes the six registry spheres to the page and rewrites any other key to a real 404", () => {
    for (const key of ["languages", "finance", "work", "projects", "skills", "health"]) {
      const response = proxy(request(`/domains/${key}`));
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("location")).toBeNull();
    }
    for (const key of ["seventh", "Languages", "constructor", "__proto__", "finance%20"]) {
      expect(new URL(rewrite(`/domains/${key}`)!).pathname).toBe("/domains/_unknown/_");
    }
  });
  it("leaves other /domains paths to routing and never sends a sphere guest to sign-in", () => {
    for (const path of ["/domains", "/domains/finance/unknown", "/domains/finance/"]) {
      const response = proxy(request(path));
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    }
  });
  it("still redirects a guest without a session cookie from protected pages", () => {
    const response = proxy(request("/goals/new"));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/auth/sign-in");
    expect(proxy(request("/goals", "lifeos.session_token=value")).headers.get("x-middleware-next")).toBe("1");
  });
  it("redirects a guest from the onboarding wizard and keeps the way back (LFS-219)", async () => {
    const response = proxy(request("/onboarding"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/auth/sign-in");
    expect(location.searchParams.get("next")).toBe("/onboarding");
    const { config } = await import("../proxy.ts");
    expect(config.matcher).toContain("/onboarding/:path*");
  });
});
