# Project Agent Instructions

## Protect the development server

- Treat the user's running development server, containers, volumes, and current process state as user-owned and preserve them.
- Do not run production builds or production deployment workflows unless the user explicitly asks for a production build or deployment in the current conversation.
- In particular, do not run `docker compose up --build`, `docker compose up --force-recreate`, `docker compose down`, or equivalent commands that rebuild, replace, stop, or recreate the running development services without explicit user approval.
- Do not replace development containers or processes with production images as a side effect of testing or verification.
- Prefer tests, linting, type checking, and other checks that do not alter the running server. When runtime verification is needed, use the project's existing development workflow and avoid restarting services whenever possible.
- Use `make dev` for the normal development stack. Its bind-mounted frontend and backend source directories provide live reload, so code-only changes do not require a rebuild or container recreation.
- Use `make dev-build` only when dependencies, Dockerfiles, or other image inputs changed, and obtain explicit approval first because it can rebuild or recreate development services.
- Before any command that could interrupt or change the running development environment, explain the expected impact and obtain explicit approval, even if the code change itself was already requested.
