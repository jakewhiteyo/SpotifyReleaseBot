/**
 * Sends a signed test webhook to a running instance of the bot.
 *
 *   DRY_RUN=1 npm run dev            # terminal 1
 *   npm run test:webhook             # terminal 2 -> http://localhost:3000
 *   npm run test:webhook -- https://spotify-release-x-bot.vercel.app   # careful: posts for real unless DRY_RUN is set there
 *
 * Signs `${timestamp}.${body}` with SPOTIFY_WEBHOOKS_SECRET exactly like the platform does.
 */
import { loadEnvConfig } from "@next/env";
import crypto from "crypto";

loadEnvConfig(process.cwd());

const base = process.argv[2] ?? "http://localhost:3000";
const secret = process.env.SPOTIFY_WEBHOOKS_SECRET;
if (!secret) {
  console.error("SPOTIFY_WEBHOOKS_SECRET missing from env");
  process.exit(1);
}

const payload = {
  content: "**New music released** (test)",
  event: {
    id: `test_${Date.now()}`,
    triggeredAt: new Date().toISOString(),
    subscriptionId: "test",
    type: "artist_release",
  },
  releases: [
    {
      id: "test-release",
      name: "Test Release (dry run)",
      type: "album",
      spotify_id: "0ETFjACtuP2ADo6LFhL6HN",
      href: "https://open.spotify.com/album/0ETFjACtuP2ADo6LFhL6HN",
      release_date: "2026-09-01",
      album_type: "single",
      images: [{ url: "https://i.scdn.co/image/ab67616d0000b273f7b7d8e7a1e2a6a2d3b8e0b1", height: 640, width: 640 }],
      artists: [
        // Skepta: on both Wikidata and MusicBrainz
        { id: "2p1fiYHYiXz9qi0JJyxBzN", name: "Skepta", href: "https://open.spotify.com/artist/2p1fiYHYiXz9qi0JJyxBzN" },
        // Not a real id: exercises the no-handle path
        { id: "0000000000000000000000", name: "Unknown Artist", href: "https://open.spotify.com/artist/0000000000000000000000" },
      ],
      total_tracks: 1,
    },
  ],
};

const body = JSON.stringify(payload);
const timestamp = Math.floor(Date.now() / 1000).toString();
const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

fetch(`${base.replace(/\/$/, "")}/api/spotify-webhook`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-webhook-timestamp": timestamp,
    "x-webhook-signature": `sha256=${signature}`,
  },
  body,
})
  .then(async (res) => {
    console.log(`${res.status} ${res.statusText}`);
    console.log(await res.text());
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
