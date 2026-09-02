import { NextApiRequest, NextApiResponse } from "next";
import { ApiResponseError, TwitterApi } from "twitter-api-v2";
import crypto from "crypto";
import { buffer } from "micro";
import { resolveArtistHandles, type ResolvedArtist } from "../../lib/artistHandles";
import { buildTweetText } from "../../lib/tweetText";

const twitterClient = new TwitterApi({
  appKey: process.env.X_API_KEY!,
  appSecret: process.env.X_API_KEY_SECRET!,
  accessToken: process.env.X_API_ACCESS_TOKEN!,
  accessSecret: process.env.X_API_ACCESS_TOKEN_SECRET!,
});

// Disable body parsing to get raw body for signature verification.
// maxDuration covers the artist handle lookups (bounded per release by HANDLE_LOOKUP_BUDGET_MS).
export const config = {
  api: {
    bodyParser: false,
  },
  maxDuration: 60,
};

function verifyWebhookSignature(
  payload: string,
  signature: string,
  timestamp: string
): boolean {
  try {
    // Extract the signature value (remove 'sha256=' prefix)
    const sigValue = signature.replace("sha256=", "");

    // Reconstruct the signed payload with timestamp (same as sender does)
    const signedPayload = `${timestamp}.${payload}`;

    // Generate HMAC-SHA256 using the secret
    const expectedSig = crypto
      .createHmac("sha256", process.env.SPOTIFY_WEBHOOKS_SECRET!)
      .update(signedPayload)
      .digest("hex");

    // Compare signatures (constant-time comparison would be ideal in production)
    if (expectedSig === sigValue) {
      return true;
    }

    return false;
  } catch (error) {
    console.error("Error verifying webhook signature:", error);
    return false;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { method } = req;

  switch (method) {
    case "POST":
      return handlePost(req, res);
    default:
      return res.status(405).json({ message: "Method not allowed" });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Get raw body first - BEFORE accessing any headers or body
    const rawBody = await buffer(req);
    const bodyString = rawBody.toString("utf8");

    // Get signature and timestamp from headers
    const signature = req.headers["x-webhook-signature"] as string;
    const timestamp = req.headers["x-webhook-timestamp"] as string;

    if (!signature) {
      console.error("No signature provided in webhook");
      return res.status(401).json({ message: "No signature provided" });
    }

    if (!timestamp) {
      console.error("No timestamp provided in webhook");
      return res.status(401).json({ message: "No timestamp provided" });
    }

    if (!verifyWebhookSignature(bodyString, signature, timestamp)) {
      console.error("Invalid webhook signature");
      return res.status(401).json({ message: "Invalid signature" });
    }

    // Parse body AFTER verification
    const body = JSON.parse(bodyString);
    const { event, releases } = body;

    if (!releases || releases.length === 0) {
      return res.status(400).json({ message: "No releases in payload" });
    }

    const dryRun = process.env.DRY_RUN === "1";

    // Send one tweet per release
    const tweetIds: string[] = [];

    for (let i = 0; i < releases.length; i++) {
      const release = releases[i];
      const releaseType = release.album_type || release.type;

      // Look up and verify X handles so the artists get @-mentioned when possible
      const artistInputs = (release.artists ?? []).map((a: any) => ({
        id: String(a?.id ?? ""),
        name: String(a?.name ?? ""),
      }));
      let resolvedArtists: ResolvedArtist[];
      try {
        resolvedArtists = await resolveArtistHandles(twitterClient, artistInputs);
      } catch (handleError) {
        console.error("[handles] resolver threw; using bare names", handleError);
        resolvedArtists = artistInputs.map((a: { id: string; name: string }) => ({
          ...a,
          handle: null,
          source: "none" as const,
        }));
      }

      // Build tweet text for this release (includes the Spotify link and footer)
      const spotifyLink = `https://open.spotify.com/album/${release.id}`;
      const tweetText = buildTweetText(release.name, resolvedArtists, releaseType, spotifyLink);

      if (dryRun) {
        console.log(`[dry-run] tweet ${i + 1}:\n${tweetText}`);
        tweetIds.push("dry-run");
        continue;
      }

      // Upload image for this release
      let mediaId: string | undefined;
      if (release.images && release.images.length > 0) {
        const imageUrl = release.images[0].url;

        try {
          const imageResponse = await fetch(imageUrl);
          const imageBuffer = await imageResponse.arrayBuffer();

          mediaId = await twitterClient.v1.uploadMedia(
            Buffer.from(imageBuffer),
            { mimeType: "image/jpeg" }
          );
        } catch (imageError) {
          console.error(
            `Error uploading image for release ${release.name}:`,
            imageError
          );
        }
      }

      // Send tweet for this release
      const tweetOptions: any = { text: tweetText };

      if (mediaId) {
        tweetOptions.media = { media_ids: [mediaId] };
      }

      const tweet = await twitterClient.v2.tweet(tweetOptions);
      console.log(`Tweet ${i + 1} sent:`, tweet);

      tweetIds.push(tweet.data.id);
    }

    return res.status(200).json({
      message: dryRun ? "Dry run, nothing posted" : "Tweet(s) sent",
      tweetIds: tweetIds,
      releasesCount: releases.length,
      dryRun,
    });
  } catch (error) {
    if (error instanceof ApiResponseError) {
      console.error(
        `X API error: status=${error.code} body=${JSON.stringify(error.data)}`
      );
    }
    console.error("Error processing webhook", error);
    return res.status(500).json({
      message: "Error processing webhook",
      error: (error as { message: string }).message,
    });
  }
}
