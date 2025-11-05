import { NextApiRequest, NextApiResponse } from "next";
import { TwitterApi } from "twitter-api-v2";
import crypto from "crypto";
import { request } from "http";
import { buffer } from "micro";

const twitterClient = new TwitterApi({
  appKey: process.env.X_API_KEY!,
  appSecret: process.env.X_API_KEY_SECRET!,
  accessToken: process.env.X_API_ACCESS_TOKEN!,
  accessSecret: process.env.X_API_ACCESS_TOKEN_SECRET!,
});

// Disable body parsing to get raw body for signature verification
export const config = {
  api: {
    bodyParser: false,
  },
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

    const header = "New Spotify Release Detected\n\n";
    const footer = "\n\nPowered by Spotify Webhooks";

    // Send one tweet per release
    const tweetIds: string[] = [];

    for (let i = 0; i < releases.length; i++) {
      const release = releases[i];
      const artists =
        release.artists?.map((a: any) => a.name).join(", ") || "Unknown Artist";
      const releaseType = release.album_type || release.type;

      // Build tweet text for this release
      let tweetText = `${header}${release.name} - ${artists} (${releaseType})${footer}`;
      // Add a link to the release on Spotify
      const spotifyLink = `https://open.spotify.com/album/${release.id}`;
      tweetText += `\n\n${spotifyLink}`;

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
      message: "Tweet(s) sent",
      tweetIds: tweetIds,
      releasesCount: releases.length,
    });
  } catch (error) {
    console.error("Error processing webhook", error);
    return res.status(500).json({
      message: "Error processing webhook",
      error: (error as { message: string }).message,
    });
  }
}
