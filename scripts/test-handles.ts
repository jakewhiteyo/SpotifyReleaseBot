/**
 * Predict the X handle for one or more Spotify artist ids.
 *
 *   npm run test:handles -- <spotifyArtistId> [more ids...]
 *   npm run test:handles -- --no-verify <spotifyArtistId>   # skip the X API ($0.01 per verification)
 *   npm run test:handles -- --url https://open.spotify.com/artist/<id>
 *
 * Reads X credentials from .env / .env.local like the app does. Also runs a
 * quick self-check of the tweet length guard.
 */
import { loadEnvConfig } from "@next/env";
import { TwitterApi } from "twitter-api-v2";
import { predictHandle } from "../lib/artistHandles";
import { buildTweetText, weightedLength } from "../lib/tweetText";

loadEnvConfig(process.cwd());

function parseArgs(argv: string[]) {
  const ids: string[] = [];
  let verify = true;
  for (const arg of argv) {
    if (arg === "--no-verify") verify = false;
    else if (arg === "--url") continue;
    else {
      const fromUrl = /open\.spotify\.com\/artist\/([A-Za-z0-9]{22})/.exec(arg);
      ids.push(fromUrl ? fromUrl[1] : arg.replace(/^spotify:artist:/, ""));
    }
  }
  return { ids, verify };
}

function selfCheckTweetText() {
  const artists = [
    { id: "a", name: "A Very Long Featured Artist Name", handle: "averylonghandle", source: "wikidata" as const },
    { id: "b", name: "Another Long Collaborator Name", handle: "anotherhandle1", source: "wikidata" as const },
    { id: "c", name: "Third Artist With A Long Name", handle: "thirdhandle123", source: "musicbrainz" as const },
    { id: "d", name: "Fourth Artist Who Is Also Here", handle: "fourthhandle12", source: "override" as const },
  ];
  const name = "An Extremely Long Release Title That Goes On And On (Deluxe Edition) [Remastered 2026]";
  const text = buildTweetText(name, artists, "album", "https://open.spotify.com/album/0123456789abcdefghijkl");
  const len = weightedLength(text);
  if (len > 280) throw new Error(`tweet length guard failed: ${len} > 280`);
  console.log(`tweet length guard ok (${len}/280 weighted chars)`);
}

async function main() {
  selfCheckTweetText();
  const { ids, verify } = parseArgs(process.argv.slice(2));
  if (ids.length === 0) {
    console.error("usage: npm run test:handles -- [--no-verify] <spotifyArtistId | artist url> ...");
    process.exit(1);
  }
  let client: TwitterApi | null = null;
  if (verify) {
    const { X_API_KEY, X_API_KEY_SECRET, X_API_ACCESS_TOKEN, X_API_ACCESS_TOKEN_SECRET } = process.env;
    if (!X_API_KEY || !X_API_KEY_SECRET || !X_API_ACCESS_TOKEN || !X_API_ACCESS_TOKEN_SECRET) {
      console.error("X credentials missing from env; rerun with --no-verify or set X_API_* in .env");
      process.exit(1);
    }
    client = new TwitterApi({
      appKey: X_API_KEY,
      appSecret: X_API_KEY_SECRET,
      accessToken: X_API_ACCESS_TOKEN,
      accessSecret: X_API_ACCESS_TOKEN_SECRET,
    });
  }
  for (const id of ids) {
    const started = Date.now();
    const p = await predictHandle(id, client);
    const answer = p.verified ?? p.predicted;
    console.log(
      `\n${id}\n  prediction : ${answer ? "@" + answer : "(none)"}` +
        `\n  source     : ${p.source}` +
        `\n  verified   : ${client ? (p.verified ? "yes" : "no") : "skipped"}` +
        `\n  override   : ${p.override === undefined ? "-" : p.override === null ? "BLOCKED" : "@" + p.override}` +
        `\n  wikidata   : ${p.wikidata === "error" ? "error" : p.wikidata ? "@" + p.wikidata : "-"}` +
        `\n  musicbrainz: ${p.musicbrainz === "error" ? "error" : p.musicbrainz ? "@" + p.musicbrainz : "-"}` +
        `\n  took       : ${Date.now() - started}ms`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
