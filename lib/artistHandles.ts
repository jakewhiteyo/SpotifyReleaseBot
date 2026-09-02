import { ApiResponseError, type TwitterApi } from "twitter-api-v2";
import overridesJson from "./handleOverrides.json";

export type ArtistInput = { id: string; name: string };
export type HandleSource = "override" | "wikidata" | "musicbrainz" | "none" | "blocked";
export type ResolvedArtist = {
  id: string;
  name: string;
  /** Verified X username, or null to fall back to the bare artist name. */
  handle: string | null;
  source: HandleSource;
};

type Override = { name?: string; handle: string | null };
const overrides: Record<string, Override> = Object.fromEntries(
  Object.entries(overridesJson as Record<string, unknown>).filter(
    ([key, value]) => !key.startsWith("_") && value !== null && typeof value === "object"
  )
) as Record<string, Override>;

const USER_AGENT =
  "SpotifyReleaseBot/1.0 (https://github.com/jakewhiteyo/SpotifyReleaseBot; jake@switchbase.com)";
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const SPOTIFY_ID_RE = /^[A-Za-z0-9]{22}$/;
// Strict on purpose: a loose (twitter|x)\.com pattern also matched music.yandex.com.
const X_URL_RE = /^https?:\/\/(www\.)?(twitter|x)\.com\/([A-Za-z0-9_]{1,15})\/?$/;
const REQUEST_TIMEOUT_MS = 3000;
// Wikidata answers 429 above ~1 req/s and MusicBrainz asks for max 1 req/s.
const MIN_GAP_MS = 1100;

// Per-host politeness gap. Module state lives for the serverless instance; resetting is harmless.
const lastCallAt: Record<string, number> = {};

async function throttled<T>(
  host: string,
  deadline: number,
  fn: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const wait = Math.max(0, (lastCallAt[host] ?? 0) + MIN_GAP_MS - Date.now());
  if (Date.now() + wait >= deadline) throw new Error("budget-exhausted");
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt[host] = Date.now();
  const ms = Math.max(1, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now()));
  return fn(AbortSignal.timeout(ms));
}

class HttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

async function getJson(url: string, headers: Record<string, string>, signal: AbortSignal) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, ...headers }, signal });
  if (!res.ok) throw new HttpError(res.status);
  return res.json();
}

/** One throttled request, retried once on a 5xx (both sources return transient 502/503s). */
async function getJsonWithRetry(
  host: string,
  url: string,
  headers: Record<string, string>,
  deadline: number
) {
  try {
    return await throttled(host, deadline, (signal) => getJson(url, headers, signal));
  } catch (error) {
    if (error instanceof HttpError && error.status >= 500) {
      return throttled(host, deadline, (signal) => getJson(url, headers, signal));
    }
    throw error;
  }
}

/** Wikidata: item with Spotify artist ID (P1902) -> X username (P2002). */
export async function lookupWikidata(
  spotifyId: string,
  deadline = Date.now() + 8000
): Promise<string | null> {
  if (!SPOTIFY_ID_RE.test(spotifyId)) return null;
  const query = `SELECT ?h WHERE { ?i wdt:P1902 "${spotifyId}" . ?i wdt:P2002 ?h } LIMIT 1`;
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
  const json = await getJsonWithRetry(
    "wikidata",
    url,
    { Accept: "application/sparql-results+json" },
    deadline
  );
  const handle = json?.results?.bindings?.[0]?.h?.value;
  return typeof handle === "string" && HANDLE_RE.test(handle) ? handle : null;
}

/** MusicBrainz: Spotify artist URL -> artist MBID -> url-rels -> twitter/x link. */
export async function lookupMusicBrainz(
  spotifyId: string,
  deadline = Date.now() + 8000
): Promise<string | null> {
  if (!SPOTIFY_ID_RE.test(spotifyId)) return null;
  const resource = encodeURIComponent(`https://open.spotify.com/artist/${spotifyId}`);
  const urlEntity = await getJsonWithRetry(
    "musicbrainz",
    `https://musicbrainz.org/ws/2/url?resource=${resource}&inc=artist-rels&fmt=json`,
    { Accept: "application/json" },
    deadline
  );
  const mbid: string | undefined = urlEntity?.relations?.find((r: any) => r?.artist?.id)?.artist?.id;
  if (!mbid) return null;
  const artist = await getJsonWithRetry(
    "musicbrainz",
    `https://musicbrainz.org/ws/2/artist/${encodeURIComponent(mbid)}?inc=url-rels&fmt=json`,
    { Accept: "application/json" },
    deadline
  );
  for (const rel of artist?.relations ?? []) {
    const match = X_URL_RE.exec(rel?.url?.resource ?? "");
    if (match) return match[3];
  }
  return null;
}

/**
 * Confirms the username exists on X and returns its canonical casing.
 * X answers HTTP 200 with `errors[]` and no `data` for an unknown user, so an
 * exception is not the only failure path.
 */
export async function verifyHandle(client: TwitterApi, handle: string): Promise<string | null> {
  try {
    const res = await client.v2.userByUsername(handle);
    if (res.data?.username) return res.data.username;
    console.warn(`[handles] X has no user @${handle}:`, JSON.stringify(res.errors ?? null));
    return null;
  } catch (error) {
    if (error instanceof ApiResponseError) {
      console.error(
        `[handles] X API error verifying @${handle}: status=${error.code} body=${JSON.stringify(error.data)}`
      );
    } else {
      console.error(`[handles] request error verifying @${handle}:`, error);
    }
    return null;
  }
}

export type Prediction = {
  id: string;
  /** undefined = no override entry, null = tagging blocked. */
  override: string | null | undefined;
  wikidata: string | null | "error";
  musicbrainz: string | null | "error";
  /** First candidate in priority order, before any X verification. */
  predicted: string | null;
  /** Handle verified against X, or null if verification was skipped or failed. */
  verified: string | null;
  source: HandleSource;
};

/**
 * Runs every source for one artist id and reports what each said. Meant for the
 * test script; the webhook path uses resolveArtistHandles, which stops early.
 * Pass a null client to skip X verification (free).
 */
export async function predictHandle(
  spotifyId: string,
  client: TwitterApi | null,
  budgetMs = 15000
): Promise<Prediction> {
  const deadline = Date.now() + budgetMs;
  const override = overrides[spotifyId]?.handle;
  const safe = async (fn: () => Promise<string | null>): Promise<string | null | "error"> => {
    try {
      return await fn();
    } catch (e: any) {
      console.warn(
        `[handles] lookup failed for ${spotifyId}: ${e?.name === "TimeoutError" ? "timeout" : e?.message}`
      );
      return "error";
    }
  };
  if (override === null) {
    return { id: spotifyId, override, wikidata: null, musicbrainz: null, predicted: null, verified: null, source: "blocked" };
  }
  const wikidata = await safe(() => lookupWikidata(spotifyId, deadline));
  const musicbrainz = await safe(() => lookupMusicBrainz(spotifyId, deadline));

  const ordered: Array<[HandleSource, unknown]> = [
    ["override", override],
    ["wikidata", wikidata],
    ["musicbrainz", musicbrainz],
  ];
  const candidates = ordered.filter(
    ([, h]) => typeof h === "string" && h !== "error"
  ) as Array<[HandleSource, string]>;
  const predicted = candidates[0]?.[1] ?? null;
  const base = { id: spotifyId, override, wikidata, musicbrainz, predicted };

  if (!client) return { ...base, verified: null, source: candidates[0]?.[0] ?? "none" };

  const tried = new Set<string>();
  for (const [source, handle] of candidates) {
    if (tried.has(handle.toLowerCase())) continue;
    tried.add(handle.toLowerCase());
    const verified = await verifyHandle(client, handle);
    if (verified) return { ...base, verified, source };
  }
  return { ...base, verified: null, source: "none" };
}

async function resolveOne(client: TwitterApi, artist: ArtistInput, deadline: number): Promise<ResolvedArtist> {
  const base = { id: artist.id, name: artist.name };
  if (!SPOTIFY_ID_RE.test(artist.id)) return { ...base, handle: null, source: "none" };

  const override = overrides[artist.id];
  if (override !== undefined) {
    if (override.handle === null) return { ...base, handle: null, source: "blocked" };
    const verified = await verifyHandle(client, override.handle);
    if (verified) return { ...base, handle: verified, source: "override" };
    console.error(
      `[handles] OVERRIDE FAILED verification for ${artist.name} (${artist.id}) -> @${override.handle}; trying lookups`
    );
  }

  const sources: Array<[HandleSource, (id: string, d: number) => Promise<string | null>]> = [
    ["wikidata", lookupWikidata],
    ["musicbrainz", lookupMusicBrainz],
  ];
  const tried = new Set<string>();
  for (const [source, lookup] of sources) {
    if (Date.now() >= deadline) {
      console.warn(`[handles] budget exhausted before ${source} for ${artist.name}`);
      break;
    }
    let candidate: string | null = null;
    try {
      candidate = await lookup(artist.id, deadline);
    } catch (e: any) {
      console.warn(
        `[handles] ${source} failed for ${artist.name} (${artist.id}): ${e?.name === "TimeoutError" ? "timeout" : e?.message}`
      );
    }
    if (!candidate || tried.has(candidate.toLowerCase())) continue;
    tried.add(candidate.toLowerCase());
    const verified = await verifyHandle(client, candidate);
    if (verified) return { ...base, handle: verified, source };
    console.warn(`[handles] ${source} candidate @${candidate} for ${artist.name} not verified; trying next source`);
  }
  return { ...base, handle: null, source: "none" };
}

/** Resolves handles for one release's artists under a shared time budget. Never throws. */
export async function resolveArtistHandles(
  client: TwitterApi,
  artists: ArtistInput[],
  budgetMs = Number(process.env.HANDLE_LOOKUP_BUDGET_MS ?? 8000)
): Promise<ResolvedArtist[]> {
  const deadline = Date.now() + budgetMs;
  const out: ResolvedArtist[] = [];
  for (const artist of artists) {
    const started = Date.now();
    let resolved: ResolvedArtist;
    try {
      resolved = await resolveOne(client, artist, deadline);
    } catch (error) {
      console.error(`[handles] resolver threw for ${artist.name}; using bare name`, error);
      resolved = { id: artist.id, name: artist.name, handle: null, source: "none" };
    }
    console.log(`[handles] ${JSON.stringify({ ...resolved, ms: Date.now() - started })}`);
    out.push(resolved);
  }
  return out;
}
