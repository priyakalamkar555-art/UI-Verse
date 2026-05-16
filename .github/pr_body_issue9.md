# feat(ci): reproducible cached container builds for all tooling (Issue #1269)

## Summary
- Adds a reproducible CI container for the repo’s tooling using a pinned Playwright base image.
- Builds the tooling image with GitHub Actions cache (`type=gha`) so repeated runs reuse layers instead of rebuilding from scratch.
- Runs the repo’s validation and test commands inside the container for consistent, environment-stable results.

## What I changed
- Added `Dockerfile.ci`
  - Uses `mcr.microsoft.com/playwright:v1.40.0-jammy` as the base image.
  - Pins the CI runtime and installs project dependencies during image build.
- Added `.dockerignore`
  - Excludes generated artifacts and local caches to keep the build reproducible and fast.
- Added `.github/workflows/container-tooling.yml`
  - Builds the CI image with Buildx and GitHub Actions cache.
  - Runs lint, link validation, accessibility audit, image verification, CSP verification, perf checks, and Playwright suites inside the container.

## Why
- Makes tooling runs reproducible across local and CI environments.
- Avoids drift between developer machines and GitHub Actions by standardizing on one pinned container image.
- Caching significantly reduces build time on repeated pushes and pull requests.

## Verification
- Confirmed the workflow and Dockerfile content in the workspace.
- Ran `git diff --check` to catch patch/whitespace issues.
- The container workflow is wired to run the repo’s existing tooling commands:
  - `npm run lint:html`
  - `npm run lint:css`
  - `npm run lint:js`
  - `npm run link-check`
  - `npm run audit:a11y`
  - `npm run images:verify`
  - `npm run security:csp:verify`
  - `npm run perf:ci`
  - `npm run test:e2e:accessibility`
  - `npm run test:visual`

## Notes
- The workflow uses image caching only (`type=gha`), so it remains reproducible and does not depend on a published registry image.
- If desired, a later follow-up can promote the built image to a reusable GHCR artifact for even faster downstream jobs.
