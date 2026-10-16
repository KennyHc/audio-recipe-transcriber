import { lazy } from "react";
import type { Route } from "@/lib/router";

// Every page is its own chunk, so the first load carries only the shell (header, sign-in
// landing) plus the page being opened — not the library, the recipe editor, cook mode, the
// publish dialog, settings, admin… (page-weight pass before the launch).
//
// No static import of @/backend here: main.tsx imports this module first and calls
// preloadRoute() for the URL being opened, so that page's chunk downloads in parallel with the
// runtime (Firebase in the cloud build) instead of after it.

const loaders = {
  library: () => import("./Library"),
  job: () => import("./JobPage"),
  settings: () => import("./Settings"),
  privacy: () => import("./Privacy"),
  terms: () => import("./Terms"),
  explore: () => import("./Explore"),
  admin: () => import("./Admin"),
  list: () => import("./ShoppingList"),
  public: () => import("./PublicRecipePage"),
  creator: () => import("./CreatorPage"),
} satisfies Record<Route["name"], () => Promise<unknown>>;

/** Starts downloading a route's page chunk (no-op on failure; lazy() retries on render). */
export function preloadRoute(name: Route["name"]): void {
  loaders[name]().catch(() => undefined);
}

export const Library = lazy(() => loaders.library().then((m) => ({ default: m.Library })));
export const JobPage = lazy(() => loaders.job().then((m) => ({ default: m.JobPage })));
export const Settings = lazy(() => loaders.settings().then((m) => ({ default: m.Settings })));
export const Privacy = lazy(() => loaders.privacy().then((m) => ({ default: m.Privacy })));
export const Terms = lazy(() => loaders.terms().then((m) => ({ default: m.Terms })));
export const Explore = lazy(() => loaders.explore().then((m) => ({ default: m.Explore })));
export const Admin = lazy(() => loaders.admin().then((m) => ({ default: m.Admin })));
export const ShoppingList = lazy(() => loaders.list().then((m) => ({ default: m.ShoppingList })));
export const PublicRecipePage = lazy(() => loaders.public().then((m) => ({ default: m.PublicRecipePage })));
export const CreatorPage = lazy(() => loaders.creator().then((m) => ({ default: m.CreatorPage })));
