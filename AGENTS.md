# Repository Guidelines

## Project Structure & Module Organization
The repo splits into `backend/` and `frontend/`, with shared documentation in `README.md`. `backend/app.py` hosts the Flask API, while helper utilities live alongside it for quick iteration. Tests and fixtures sit in `backend/tests/`, including `sample_trajectory.json` for realistic payloads. React source code resides in `frontend/src/`, with assets served from `frontend/public/` and configuration captured in `frontend/package.json`.

## Build, Test, and Development Commands
Set up the backend environment with:
```bash
cd backend && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt
```
Run the API for local development: `python app.py`. Execute backend tests with `pytest backend/tests -q`. For the UI, install dependencies using `cd frontend && npm install`, start the dev server via `npm start`, run unit tests with `npm test -- --watchAll=false`, and create a production bundle using `npm run build`.

## Coding Style & Naming Conventions
Match the existing Python style: four-space indentation, descriptive snake_case names, and module-level loggers configured up front. Keep Flask routes thin and move helpers into well-named functions for reuse. In React, prefer function components, PascalCase filenames for components, and keep stateful logic in dedicated hooks within `src/`. The default `react-scripts` lint rules run automatically; resolve warnings before pushing.

## Testing Guidelines
Backend tests rely on Pytest fixtures that spin up a temporary Flask client; mirror the `test_*` naming pattern and cover new API branches. Frontend tests run through Jest and React Testing Library; add DOM-focused assertions to `App.test.js` or colocated `*.test.js` files. When modifying request shapes, refresh `sample_trajectory.json` to keep integration tests meaningful.

## Commit & Pull Request Guidelines
History favors concise, task-focused messages such as `gives support to new message format...`. Use present tense, keep the subject under 72 characters, and detail context in the body when needed. Pull requests should describe user-facing changes, note backend/frontend impacts, link tracking issues, and include screenshots or terminal output demonstrating tests for UI or API updates.

## Environment & Secrets
Create `backend/.env` with `OPENAI_API_KEY` before running the server and never commit the file. Verify `.gitignore` still excludes local artifacts like `venv/`, build output, and downloaded trajectories to prevent leaking sensitive data.
