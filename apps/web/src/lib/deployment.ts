/**
 * What this deployment can actually do.
 *
 * PDFShush ships in two shapes, and the difference is a build-time fact:
 *
 *  - **server** -- the SPA, the Express API, the BullMQ worker and Redis are
 *    deployed together. Accounts, workflow recipes, the public REST API, the
 *    MCP server and the managed-AI trial all work. This is the default, and
 *    every build made before 2026-11-13 is this shape.
 *
 *  - **frontend** -- the SPA alone, on a static host (Cloudflare Pages). The
 *    API, the worker and the queue are *not* deployed. Every tool still runs
 *    in the user's own browser -- that is the product's whole point -- but the
 *    server-backed features have nothing to talk to.
 *
 * The switch is the build variable `VITE_SERVER_API=off`.
 *
 * It is deliberately build-time rather than a runtime probe. A static host has
 * no `/api` to ask, so a probe would cost every deployment a failed request
 * before it knew what it could do -- and the answer would still be a guess:
 * "the API did not answer" and "there is no API" are the same observation. The
 * deployment knows which one it is, so the build records it.
 *
 * With the switch off the app does not pretend the server is missing. It says
 * so once, in plain language, and it removes the controls that could only
 * fail: no sign-in button, no account panel, no workflow runner, no managed-AI
 * trial, and an API console that documents the surface without pretending it
 * is reachable. What is left is the product's real claim -- 51 tools that run
 * locally, with no upload and no account.
 */

/** The two shapes a build can have. */
export type DeploymentShape = 'server' | 'frontend';

const configured = (import.meta.env.VITE_SERVER_API ?? '').trim().toLowerCase();

/** The shape this bundle was built for. */
export const deploymentShape: DeploymentShape = configured === 'off' ? 'frontend' : 'server';

/** True when the API, the worker and the queue are deployed alongside the SPA. */
export const serverDeployed = deploymentShape === 'server';

/** The error code a server-backed call reports when the server is not deployed. */
export const SERVER_UNAVAILABLE_CODE = 'server_unavailable';

/**
 * The one sentence every server-backed surface uses when it has to explain
 * itself. It is deliberately specific: "the server is not deployed here" is a
 * fact the visitor can act on, and it says what still works.
 */
export const SERVER_UNAVAILABLE_MESSAGE =
  'This deployment runs the tools in your browser only. The PDFShush server (API, worker and ' +
  'queue) is not deployed here, so accounts, workflow recipes, the REST API and the managed-AI ' +
  'trial are unavailable. Every tool on this site still runs locally, with no upload.';
