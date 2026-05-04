# `hostaway-proxy` route table refactor — deferred

**Status:** identified, scoped, not started.

## What it would change

The current `hostaway-proxy-patched.ts` is a single 1,700-line `Deno.serve` handler with 80+ actions chained in `if (action === "...") { ... }` blocks. Adding a new action means scrolling, copy-pasting boilerplate (auth, error handling, CORS), and visually picking a spot.

Refactor target: a routing object.

```ts
const routes: Record<string, (ctx: ReqCtx) => Promise<Response>> = {
  getAllData:        handleGetAllData,
  getAssignments:    handleGetAssignments,
  assignCleaner:     handleAssignCleaner,
  // ...80 more...
};

const handler = routes[action];
return handler ? handler(ctx) : jsonResp({ error: "unknown action" }, 404);
```

Each handler stays tiny and testable. The shared concerns (CORS, auth, JSON parsing, error envelope) move into a single `withMiddleware()` wrapper.

## Why deferred

1. **Blast radius**: every action runs through the same Supabase Edge Function. A regression in middleware extraction breaks all 80 endpoints simultaneously. The smoke suite covers the frontend, not the proxy.
2. **No user-visible benefit**: pure dev-quality. Nothing observable on prod.
3. **Right after a multi-assign refactor**: we just changed `assignCleaner` semantics across 3 modes. Better to let that bake before another invasive proxy change.

## Suggested approach when picked up

1. Add a `tests/proxy.spec.ts` integration suite that hits each action with happy-path input — at least 1 test per action — before touching the file.
2. Extract handlers in batches of 5–10, with a smoke run after each batch.
3. Once everything's a handler, the `if/else` chain can be deleted.

Estimate: 4 hours including tests, more if any handler has subtle behaviour we trip over.

## Adjacent improvements that fit cleanly with this work

- Type-only `ReqCtx` interface for handler signature
- Per-action JSON schema validation (Zod)
- A `routes/` subdir that the deploy script bundles into `index.ts`
- Per-action structured logging (action name + duration + error)
