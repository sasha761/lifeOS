"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut() {
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      // Deletes the server-side session row; the old cookie stops working immediately.
      const { error } = await authClient.signOut();
      if (error) throw new Error("sign-out failed");
      router.replace("/auth/sign-in");
      router.refresh();
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  return (
    <div className="grid gap-2">
      <button type="button" onClick={signOut} disabled={pending} className="action-link-secondary action-compact disabled:cursor-wait disabled:opacity-70">
        <LogOut aria-hidden="true" className="size-4" /> {pending ? "Выходим…" : "Выйти"}
      </button>
      {failed && <p role="alert" className="text-sm text-destructive">Не удалось выйти. Попробуйте ещё раз.</p>}
    </div>
  );
}
