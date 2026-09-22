// Backend base URL. The core serves `/core/*` endpoints; the web client runs
// on a different origin (:4200 vs :3000) and relies on core's permissive CORS
// in local dev. NOTE: `localhost` inside a container is the container itself —
// when running under docker compose or across the LAN, point SERVER_URL at
// `host.docker.internal` or the host's LAN address instead.
export const SERVER_URL = 'http://localhost:3000';

// Core endpoint paths (relative). Compose as `${SERVER_URL}${*_ENDPOINT}...`.
export const CONVERSATION_ENDPOINT = '/core/conversation';
export const SESSIONS_ENDPOINT = '/core/sessions';
export const APPROVALS_ENDPOINT = '/core/approvals';
export const CLARIFICATIONS_ENDPOINT = '/core/clarifications';
export const MEMORY_CANDIDATES_ENDPOINT = '/core/memory-candidates';
export const SKILLS_ENDPOINT = '/core/skills';
