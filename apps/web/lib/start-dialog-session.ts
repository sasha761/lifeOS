/**
 * «✕» of the first-visit popup (LFS-220): closed until the next sign-in, within the browser session. This flag is the only
 * thing the browser keeps; the setup status itself lives on the server. «Выйти» forgets it.
 */
const KEY = "lifeos:start-dialog-closed";

export function startDialogClosed(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === "1";
  } catch {
    // Storage blocked (privacy mode, disabled cookies): the popup simply shows again.
    return false;
  }
}

export function closeStartDialog(): void {
  try {
    window.sessionStorage.setItem(KEY, "1");
  } catch {
    // Storage blocked: «✕» still closes the popup on this page; it returns on the next visit.
  }
}

export function forgetStartDialog(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Storage blocked: nothing was stored.
  }
}
