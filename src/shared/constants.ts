// Constants shared by the app and the server.

// Durations in milliseconds.
export const MINUTE = Temporal.Duration.from({ minutes: 1 }).total('milliseconds');
export const HOUR = Temporal.Duration.from({ hours: 1 }).total('milliseconds');
export const DAY = Temporal.Duration.from({ days: 1 }).total('milliseconds');

// Where the real auction site and its image CDN live.
export const SITE = 'https://triangleliquidators.com';
export const CDN = 'https://cdn.triangleliquidators.com';

// Full catalog pulls default to every 5 minutes and are never allowed more often than every minute.
export const DEFAULT_SYNC_MINUTES = 5;
export const MIN_SYNC_MINUTES = 1;

// Grid cards show titles in full unless they run past this many lines.
export const DEFAULT_TITLE_LINES = 6;

// The site's fee to move a won lot to your pickup location. Its closed-lot lists don't report it.
export const TRANSFER_FEE = 5;
