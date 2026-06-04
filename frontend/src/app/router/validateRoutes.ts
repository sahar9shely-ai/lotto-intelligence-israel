import { appPaths } from "../routes/paths";

const requiredRoutes = [
  appPaths.dashboard,
  appPaths.draws,
  appPaths.frequency,
  appPaths.strongNumber,
  appPaths.pairs,
  appPaths.snapshots,
  appPaths.health,
] as const;

const deduped = new Set(requiredRoutes);

if (deduped.size !== requiredRoutes.length) {
  throw new Error("Route validation failed: duplicate route paths found.");
}

export function validateRoutes() {
  return {
    status: "ok",
    routeCount: requiredRoutes.length,
    routes: requiredRoutes,
  };
}

