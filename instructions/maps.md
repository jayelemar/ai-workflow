Version: 1.0
Last Updated: 2026-06-30

# Maps Instructions

## Purpose

Guide MapTiler, MapLibre, geofence, attendance, and employee-location map changes.

## Applies To

- `src/components/shared/maps/`, map usages in attendance, dashboard, and settings components, map tests, and map-related environment variables.

## Rules

- Route all provider configuration through `getMapProviderConfig` and `getMapSearchAdapter`; do not read MapTiler environment variables directly in map surfaces.
- Keep MapTiler-specific behavior inside `providers/maptiler/`; keep provider-neutral types, shell, overlays, markers, and utilities in `src/components/shared/maps/`.
- Preserve fallback behavior for missing provider config: attendance surfaces must fail closed with retry guidance, while other surfaces can show empty/manual-coordinate states.
- Preserve map render-state callbacks for attendance and geofence workflows that must know whether the map loaded, failed, or retried.
- Keep geofence circles, employee markers, manual coordinates, search, drag-center, radius preview, and attribution wired through provider capabilities.
- Keep style URL construction centralized in `buildMapTilerStyleUrl`; support explicit style URLs before API-key/style-id defaults.
- Keep debug map snapshots development-only.

## Placement

- Put provider-neutral components in `src/components/shared/maps/`.
- Put MapTiler adapters and utilities in `src/components/shared/maps/providers/maptiler/`.
- Put attendance-specific map composition in attendance components or hooks.
- Put settings geofence editor composition in `src/features/settings/components/office-geofence*`.

## Validation

- Run `src/components/shared/maps/**/*.test.tsx` tests for provider config, rendering, search, geofence, and adapter changes.
- Run attendance or settings component tests when map render state controls attendance actions or office geofence editing.
- Run `pnpm e2e` for browser-only map workflows that depend on Playwright env variables, canvas rendering, or user interaction.
- Run `pnpm typecheck` after changing provider types, map props, or geofence/coordinate contracts.

## Anti-Patterns

- Reading `NEXT_PUBLIC_MAPTILER_*` directly from a map component instead of the registry.
- Adding MapTiler-specific props to provider-neutral components without updating provider types.
- Treating an unconfigured attendance map as usable for clock actions.
- Dropping attribution, retry, or empty-state handling when replacing map surfaces.
