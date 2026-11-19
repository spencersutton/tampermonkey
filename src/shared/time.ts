// Durations in milliseconds, shared by the app and the server.
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** How recently a tab must have been in use for the server to keep pulling the catalog on its own. */
export const ACTIVE_WINDOW = 10 * MINUTE;
