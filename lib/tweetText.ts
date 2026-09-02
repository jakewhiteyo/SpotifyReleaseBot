import type { ResolvedArtist } from "./artistHandles";

export const HEADER = "New Spotify Release Detected\n\n";
export const FOOTER = "\n\nPowered by Spotify Webhooks";
const URL_WEIGHT = 23; // X counts every link as 23 characters
const MAX_WEIGHTED = 280;

type Style = "full" | "handleOnly" | "bare";

export function formatArtists(artists: ResolvedArtist[], style: Style): string {
  const parts = artists.map((a) => {
    if (!a.handle || style === "bare") return a.name;
    return style === "full" ? `${a.name} (@${a.handle})` : `@${a.handle}`;
  });
  return parts.join(", ") || "Unknown Artist";
}

export function weightedLength(text: string): number {
  return text.replace(/https?:\/\/\S+/g, "x".repeat(URL_WEIGHT)).length;
}

/** Builds the tweet, degrading artist formatting and finally truncating the name to fit 280. */
export function buildTweetText(
  releaseName: string,
  artists: ResolvedArtist[],
  releaseType: string,
  url: string
): string {
  const compose = (name: string, style: Style) =>
    `${HEADER}${name} - ${formatArtists(artists, style)} (${releaseType})\n\n${url}${FOOTER}`;

  for (const style of ["full", "handleOnly", "bare"] as const) {
    const text = compose(releaseName, style);
    if (weightedLength(text) <= MAX_WEIGHTED) return text;
  }
  const fixed = weightedLength(compose("", "bare"));
  const room = Math.max(10, MAX_WEIGHTED - fixed - 1);
  return compose(`${releaseName.slice(0, room)}…`, "bare");
}
