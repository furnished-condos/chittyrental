# Immediate Improvement Plan

This document outlines quick, high-value improvements to make ChittyRental easier to develop, test, and operate.

## Developer Experience
- **Add lint/type checks to CI**: Run ESLint, TypeScript, and formatting checks for `client/`, `frontend/`, `server/`, and shared packages to catch regressions early.
- **Clarify local env setup**: Add `.env.example` entries for major integrations (DoorLoop, Wave, HubSpot, M365, Mercury) so newcomers know which variables are required.
- **Strengthen module boundaries**: Document the service/controller/data split in `server/` and shared schema usage so new features follow the intended layering.

## Testing & Quality
- **Increase automated coverage**: Prioritize critical flows (auth, property lifecycle, payments/invoices) with integration tests hitting `server/routes` against a test database.
- **Frontend smoke tests**: Add Playwright/Cypress smoke tests for primary dashboards and protected routing in `client/`/`frontend/`.
- **Contract tests for integrations**: Capture stubs and schema expectations for third-party APIs in `shared/` so connectors can be validated offline.

## Documentation
- **Single entrypoint doc**: Link `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, and API integration notes from README for faster onboarding.
- **API map**: Auto-generate or hand-curate a route map for `server/routes` with owners and example requests.
- **Data model catalog**: Publish key entities from Drizzle schemas and Zod validators in `shared/` to align frontend/backoffice expectations.

## Operations & Reliability
- **Health and metrics**: Expose health checks for dependencies (DB, integrations) and basic telemetry from the backend service.
- **Secrets hygiene**: Ensure API keys and tokens live in env vars only; add scanners/pre-commit hooks to prevent accidental commits.
- **Deployment clarity**: Document build/start steps for dev, staging, and production (frontend + backend), including database migration routines.
