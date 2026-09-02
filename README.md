# Spotify Release Bot

A serverless Next.js application with TypeScript, optimized for Vercel deployment.

Receives release webhooks from [Spotify Webhooks](https://spotifywebhooks.com/docs) at
`/api/spotify-webhook`, verifies the signature, and posts one tweet per release on X.

## Artist @-mentions

For every artist on a release the bot tries to find their X handle and renders
`Name (@handle)` in the tweet. Lookup order:

1. `lib/handleOverrides.json` (manual map, see below)
2. Wikidata (Spotify artist ID property P1902 -> X username property P2002)
3. MusicBrainz (Spotify URL -> artist -> twitter/x link)

Every candidate is verified with the X API (`GET /2/users/by/username`, about
$0.01 per call on pay-per-use) before it is used. If nothing verifies, the bare
artist name is used. Lookups share a time budget per release
(`HANDLE_LOOKUP_BUDGET_MS`, default 8000) and any failure falls back to the bare
name; a lookup problem never blocks the tweet.

Each artist logs one line in Vercel like
`[handles] {"id":"...","name":"...","handle":"...","source":"wikidata","ms":1234}`.

### Overrides

`lib/handleOverrides.json` is keyed by Spotify artist id:

```json
{
  "3TVXtAsR1Inumwj472S9r4": { "name": "Drake", "handle": "Drake" },
  "0000000000000000000000": { "name": "Someone not to tag", "handle": null }
}
```

`handle: null` blocks tagging for that artist. A handle in the file skips the
lookups but is still verified against X. Keys starting with `_` are ignored.

## Environment variables

| Name | Purpose |
|---|---|
| `X_API_KEY`, `X_API_KEY_SECRET`, `X_API_ACCESS_TOKEN`, `X_API_ACCESS_TOKEN_SECRET` | OAuth 1.0a user context for posting and verifying handles |
| `SPOTIFY_WEBHOOKS_SECRET` | Signing secret of the Spotify Webhooks subscription |
| `HANDLE_LOOKUP_BUDGET_MS` | Optional. Per-release lookup budget, default 8000 |
| `DRY_RUN` | Optional. Set to `1` to log the tweet instead of posting it |

## Testing

Predict the X handle for one or more Spotify artist ids or artist URLs:

```
npm run test:handles -- 2p1fiYHYiXz9qi0JJyxBzN
npm run test:handles -- --no-verify https://open.spotify.com/artist/2p1fiYHYiXz9qi0JJyxBzN
```

`--no-verify` skips the X API call and costs nothing. The script also runs a
self-check of the 280-character tweet guard.

Send a signed test webhook to a local instance without posting:

```
DRY_RUN=1 npm run dev      # terminal 1
npm run test:webhook       # terminal 2
```

Pass a base URL as the first argument to target another instance. Without
`DRY_RUN` on that instance the bot will post for real.
