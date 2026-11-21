// Client-side navigation from the dialog to the created goal (/goals/<id>) closes it: a slot keeps its last page until
// a route matches it. Only /goals/* is reachable from the open dialog (the page under a modal <dialog> is inert, closing
// goes back in history). A catch-all at the root of @modal would be added to every URL, and Next 16 strict route
// matching would drop pages of other route groups (/auth/*, /telegram, /onboarding) as incomplete routes.
export default function NoModalOnGoalPages() {
  return null;
}
