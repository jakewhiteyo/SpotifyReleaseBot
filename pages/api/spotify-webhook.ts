import { NextApiRequest, NextApiResponse } from "next";
import { TwitterApi } from "twitter-api-v2";

const twitterClient = new TwitterApi({
  appKey: process.env.X_API_KEY!,
  appSecret: process.env.X_API_KEY_SECRET!,
  accessToken: process.env.X_API_ACCESS_TOKEN!,
  accessSecret: process.env.X_API_ACCESS_TOKEN_SECRET!,
});

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req;

  switch (method) {
    case "POST":
      return handlePost(req, res);
    default:
      return res.status(405).json({ message: "Method not allowed" });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const { body } = req;
  console.log("Webhook received", body);

  try {
    const { event, releases } = body;

    if (!releases || releases.length === 0) {
      return res.status(400).json({ message: "No releases in payload" });
    }

    const header = "🎵 New Release Detected\n\n";
    const footer = "\n\nPowered by Spotify Webhooks";

    // Send one tweet per release
    const tweetIds: string[] = [];

    for (let i = 0; i < releases.length; i++) {
      const release = releases[i];
      const artists =
        release.artists?.map((a: any) => a.name).join(", ") || "Unknown Artist";
      const releaseType = release.album_type || release.type;

      // Build tweet text for this release
      const tweetText = `${header}${release.name} - ${artists} (${releaseType})${footer}`;

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
