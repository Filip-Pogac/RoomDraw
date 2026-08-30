import posthog from "posthog-js";

// Everything funnels through this module so the rest of the app never has to
// care whether PostHog is configured - without a key we simply no-op.
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "";
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";

export type AnalyticsEvent =
  | "room_created"
  | "room_joined"
  | "room_multiplayer_reached"
  | "guess_attempted"
  | "game_played"
  | "round_started";

export type AnalyticsProps = Record<string, string | number | boolean | null | undefined>;

let started = false;

export function isAnalyticsConfigured() {
  return Boolean(POSTHOG_KEY);
}

export function initAnalytics() {
  if (started || typeof window === "undefined" || !isAnalyticsConfigured()) {
    return;
  }

  started = true;

  try {
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      // Pins the SDK's behaviour snapshot so a future posthog-js upgrade cannot
      // silently change how pageviews and autocapture behave.
      defaults: "2026-08-30",
      // The whole game lives on one route, so history-change pageviews are
      // enough to count visits without double counting the in-app views.
      capture_pageview: "history_change",
      person_profiles: "always",
    });
  } catch {
    // Analytics must never take the game down with it.
    started = false;
  }
}

export function track(event: AnalyticsEvent, props?: AnalyticsProps) {
  if (typeof window === "undefined" || !isAnalyticsConfigured()) {
    return;
  }

  try {
    posthog.capture(event, props);
  } catch {
    // Ignore - a dropped event is never worth an error in the room.
  }
}
