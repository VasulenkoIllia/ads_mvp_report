# Project Agent Operating Standard

This file is the primary operating standard for AI agents working in this repository.
If a global agent file exists, this project file overrides it for repository-specific behavior.

## Mission
Work predictably, safely, and with minimal unnecessary context usage.
Prefer maintainable implementation over fast but fragile changes.
Choose the lightest process and architecture level that safely fits the real project.

## Core rule
Do not impose heavy structure on simple projects.
Do not under-engineer projects that already have operational, data, or scaling risk.

## Standard execution flow
1. Understand the task and scan the relevant repository area first.
2. Determine the current project mode from repository evidence.
3. For any non-trivial task, create a short implementation plan.
4. Identify the exact files likely to change before editing.
5. Make focused changes with minimal blast radius.
6. Run relevant verification steps after changes.
7. Report what changed, what was verified, and any remaining risks.
8. Update docs when setup, behavior, contracts, or workflows changed.

## Default stack assumptions
Unless repository files clearly indicate otherwise, assume:
- TypeScript
- Node.js
- React, Vite, or Next.js
- PostgreSQL
- Docker / Docker Compose
- REST APIs, webhooks, and third-party integrations
- CI/CD pipelines
- Linux deployment targets

Always defer to actual repository files over assumptions.

## Project mode selection
Choose the lightest mode that safely matches the repository and task.

### Light mode
Use for:
- small integrations
- bots
- parsers
- scripts
- one-purpose services
- small internal tools
- MVP utilities
- short-lived or low-complexity backend tasks

Behavior in Light mode:
- prefer simple structure
- avoid introducing architecture layers without need
- do not assume CI/CD, Docker, monorepo, or complex deployment
- keep changes direct, readable, and easy to maintain
- use minimal sufficient verification

### Standard mode
Use for:
- backend services
- dashboards
- admin panels
- fullstack apps
- products with database usage
- projects with deployment needs
- medium-lifetime production systems

Behavior in Standard mode:
- prefer modular structure
- separate main concerns clearly
- treat database, API boundaries, env handling, and deployment discipline seriously
- use stronger verification than Light mode
- consider maintainability and future growth, but do not overbuild

### Pro mode
Use for:
- monorepos
- multi-service systems
- production-critical SaaS
- high-load or high-risk systems
- projects with complex infra, critical data, or frequent deployments
- systems with strong operational requirements

Behavior in Pro mode:
- enforce stronger architectural boundaries
- consider rollout, rollback, migration risk, observability, and operational safety
- treat CI/CD, infra, env separation, and failure recovery as first-class concerns
- run broader verification where practical

## How to determine project mode
Use repository evidence first.

Signals for Light mode:
- small file count
- one app/service
- little or no infra
- no database or only very light storage
- no CI config
- no Docker
- task is narrow and isolated

Signals for Standard mode:
- backend plus db
- frontend plus backend
- Docker present
- structured modules
- migrations or schema files
- deployed service or product code
- more than one major responsibility

Signals for Pro mode:
- monorepo layout
- multiple apps/packages/services
- CI/CD configs
- infra directories
- production scripts
- staging/prod separation
- multiple data flows or critical integrations
- explicit scalability or reliability requirements

## When to ask clarifying questions
Do not ask questions if repository evidence is sufficient.

Ask concise questions only when critical decisions are unclear, such as:
- Is this a small one-purpose integration or a long-lived product?
- Is Docker required now, optional later, or not needed?
- Is CI/CD required now or not part of the project yet?
- Is a database part of the planned scope?
- Is this expected to remain a single service or likely to grow?
- Is this production-facing or mainly internal/test usage?

If asking is needed:
- ask only the minimum useful questions
- avoid long questionnaires
- continue with the safest light assumption when possible

## Repository shape assumptions
This repository may be:
- backend-only
- frontend-only
- fullstack
- monorepo with multiple apps/packages/services
- automation or integration project
- internal dashboard or SaaS product

If the repository contains multiple apps or packages:
- identify boundaries first
- avoid mixing concerns between apps
- verify changes in the affected scope first, then widen verification if needed

## Architecture rules
- Prefer clear separation of concerns.
- Keep business logic out of controllers, routes, UI components, and handlers where possible.
- Prefer explicit contracts, typed DTOs, and predictable interfaces.
- Reuse existing patterns already established in the repository.
- Avoid introducing unnecessary abstractions, frameworks, or dependencies.
- For larger systems, prefer modular or hexagonal structure over tightly coupled code.
- Favor readability and operational predictability over clever architecture.
- In Light mode, do not add architecture layers without a clear need.
- In Standard and Pro modes, prefer boundaries that reduce long-term coupling.

## Backend rules
- Validate all external input.
- Use typed request and response contracts where practical.
- Handle errors explicitly and consistently.
- Make retries, idempotency, and timeout behavior explicit for external APIs.
- Treat background jobs, queues, webhooks, and cron logic as architecture concerns when they exist.
- Prefer service-layer organization over route-level logic dumping.
- Keep integration logic isolated from pure domain logic where practical.

## API and integration rules
- Treat all third-party integrations as unreliable boundaries.
- Document auth method, retry behavior, timeout policy, rate-limit handling, and failure modes when relevant.
- Verify webhook signature handling where relevant.
- Use idempotency protections for payment, delivery, sync, and callback flows when possible.
- Normalize external payloads before using them in domain logic.
- Avoid scattering vendor-specific logic across the codebase.
- Prefer adapter or service wrappers for external systems.

## Frontend rules
- Keep UI components focused and composable.
- Separate presentation, state, and side effects where reasonable.
- Avoid unnecessary client-side complexity.
- Respect SSR and SEO constraints when relevant.
- Prefer predictable form handling, loading states, and error states.
- Keep API state and UI state clearly separated.

## Database rules
- Treat schema changes and migrations as high risk.
- Prefer additive changes over destructive ones.
- Review indexes for hot paths, filters, joins, and ordering.
- Avoid hidden N+1 patterns and unbounded queries.
- For performance-sensitive work, inspect query shape before changing schema blindly.
- Call out lock risk, backfill risk, and rollback approach for important migrations.
- Prefer explicit migration notes when changing critical tables.
- In Light mode, avoid overdesigning the schema.
- In Standard and Pro modes, take migration and query safety more seriously.

## Docker and deployment rules
- Do not assume Docker or CI/CD unless repository evidence or project intent supports it.
- Prefer reproducible local and server environments where relevant.
- Keep environment variables explicit and documented.
- Use health checks where relevant.
- For deploy-related changes, consider rollback, startup ordering, and migration safety.
- Avoid changing infrastructure behavior silently.
- Call out required env changes, build changes, and runtime dependency changes.
- Distinguish clearly between dev, staging, and production assumptions when those environments exist.

## Server and operations rules
- Treat production-affecting scripts and infra changes as high risk.
- Prefer reversible changes.
- Consider logs, monitoring, restart behavior, and failure recovery.
- For background workers and schedulers, verify duplicate execution risk and shutdown behavior.
- For CI/CD changes, state what pipeline behavior changes and where rollout risk exists.
- Do not introduce operational complexity unless the project actually needs it.

## Security rules
- Never expose secrets in code, commits, logs, examples, or docs.
- Treat auth, permissions, input validation, file handling, and callbacks/webhooks as high risk.
- Flag risky shell commands before running them.
- Be careful with destructive operations, production scripts, and database mutations.
- Minimize secret access and never print env values unless explicitly required and safe.

## Testing and verification rules
Use the smallest relevant verification set first, then expand if needed.

Preferred order:
1. format
2. lint
3. typecheck
4. unit tests
5. integration tests
6. e2e tests
7. build

Rules:
- Do not claim success without saying what was actually verified.
- If something could not be run, say so explicitly.
- For bug fixes, prefer reproducing the bug before fixing it.
- For new features, add or update tests where practical.
- For risky refactors, run broader verification.
- For integration work, verify both happy path and failure handling when practical.

### Verification by mode
Light mode:
- run the minimum relevant checks
- avoid heavy verification if the project does not support it

Standard mode:
- run normal local verification for affected areas
- expand to build/tests when risk is moderate

Pro mode:
- run broader verification where practical
- treat build, integration, and deployment-sensitive checks as more important

## Documentation rules
Update docs when any of the following changes:
- setup
- environment variables
- API contract
- workflow
- deployment
- architecture expectations
- developer commands
- third-party integration behavior

## Git and change discipline
- Prefer small, reviewable commits.
- Avoid unrelated cleanup in the same change unless requested.
- Preserve backward compatibility unless the task requires otherwise.
- If changing generated code, mention the source generator or command used.
- If changing migrations, build tooling, CI, or deployment scripts, mention it explicitly in the summary.

## Token and context discipline
- Do not dump large files unless necessary.
- Read only relevant files for the task.
- Summarize findings compactly.
- Avoid repeating repository context that is already established.
- Split complex work into stages when useful.
- Prefer specialized agents or workflows over bloated single-thread reasoning.

## Preferred specialist usage
Use these specialists when appropriate:

- planner  
  Use for breaking features or refactors into execution steps.

- architect  
  Use for system design, module boundaries, and tradeoff analysis.

- explorer  
  Use for repository discovery and codebase orientation before editing unfamiliar areas.

- docs-researcher / documentation-lookup  
  Use when library behavior, external APIs, or official docs must be checked.

- reviewer / code-reviewer  
  Use after implementation to spot correctness and maintainability issues.

- security-reviewer / security-review  
  Use when auth, permissions, secrets, infra, payments, uploads, or external callbacks are involved.

- database-reviewer / postgres-patterns / database-migrations  
  Use for schema design, indexes, migrations, and query-risk review.

- e2e-runner / e2e-testing  
  Use for important UI flows, regressions, and full-path user scenarios.

- build-error-resolver  
  Use when lint, typecheck, tests, build, or CI is failing.

- doc-updater  
  Use when implementation changed setup, workflows, or contracts.

## Project planning standard
For larger tasks, use this sequence:
1. repository scan
2. choose mode
3. short plan
4. implementation
5. verification
6. review
7. docs update
8. concise final summary

## Output expectations
Final responses should usually include:
- what changed
- key files touched
- what was verified
- chosen project mode if relevant
- risks or follow-ups
- anything not completed

