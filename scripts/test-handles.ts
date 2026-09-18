/**
 * Predict the X handle for one or more Spotify artist ids.
 *
 *   npm run test:handles -- <spotifyArtistId> [more ids...]
 *   npm run test:handles -- https://open.spotify.com/artist/<id>
 *
 * Only calls Wikidata and MusicBrainz; no X API credits are used. Also runs a
 * quick self-check of the tweet length guard.
 */
import { predictHandle } from "../lib/artistHandles";
import { buildTweetText, weightedLength } from "../lib/tweetText";

function parseArgs(argv: string[]): string[] {
  const ids: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith("--")) continue;
    const fromUrl = /open\.spotify\.com\/artist\/([A-Za-z0-9]{22})/.exec(arg);
    ids.push(fromUrl ? fromUrl[1] : arg.replace(/^spotify:artist:/, ""));
  }
  return ids;
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
  const ids = parseArgs(process.argv.slice(2));
  if (ids.length === 0) {
    console.error("usage: npm run test:handles -- <spotifyArtistId | artist url> ...");
    process.exit(1);
  }
  for (const id of ids) {
    const started = Date.now();
    const p = await predictHandle(id);
    console.log(
      `\n${id}\n  prediction : ${p.predicted ? "@" + p.predicted : "(none)"}` +
        `\n  source     : ${p.source}` +
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
