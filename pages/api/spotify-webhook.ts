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

    const releaseDate = new Date(releases[0].release_date).toLocaleDateString(
      "en-US",
      {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }
    );

    const header = `New Spotify Releases Detected! (${releaseDate})\n\n`;
    const footer = `\n\nPowered by Spotify Webhooks`;
    const maxLength = 280;

    // Build release lines
    const releaseLines = releases.map((release: any, index: number) => {
      const artists =
        release.artists?.map((a: any) => a.name).join(", ") || "Unknown Artist";
      const releaseType = release.album_type || release.type;
      return `${index + 1}. ${release.name} - ${artists} (${releaseType})`;
    });

    // Split releases into multiple tweets if needed
    const tweetTexts: string[] = [];
    let currentTweet = header;
    let isFirstTweet = true;

    for (let i = 0; i < releaseLines.length; i++) {
      const line = releaseLines[i] + "\n";
      const potentialTweet =
        currentTweet + line + (i === releaseLines.length - 1 ? footer : "");

      if (potentialTweet.length > maxLength) {
        // Current tweet is full, save it and start a new one
        if (isFirstTweet) {
          tweetTexts.push(currentTweet.trim() + footer);
          isFirstTweet = false;
          currentTweet = line;
        } else {
          tweetTexts.push(currentTweet.trim() + footer);
          currentTweet = line;
        }
      } else {
        currentTweet += line;
      }
    }

    // Add the last tweet
    if (currentTweet.trim()) {
      if (!currentTweet.includes(footer)) {
        currentTweet += footer;
      }
      tweetTexts.push(currentTweet.trim());
    }

    // Upload images (max 4) - only for first tweet
    const mediaIds: string[] = [];
    const maxImages = Math.min(releases.length, 4);

    for (let i = 0; i < maxImages; i++) {
      const release = releases[i];
      if (release.images && release.images.length > 0) {
        const imageUrl = release.images[0].url;

        try {
          const imageResponse = await fetch(imageUrl);
          const imageBuffer = await imageResponse.arrayBuffer();

          const mediaId = await twitterClient.v1.uploadMedia(
            Buffer.from(imageBuffer),
            { mimeType: "image/jpeg" }
          );
          mediaIds.push(mediaId);
        } catch (imageError) {
          console.error(
            `Error uploading image for release ${release.name}:`,
            imageError
          );
        }
      }
    }

    // Send tweets in a thread
    const tweetIds: string[] = [];
    let lastTweetId: string | undefined;

    for (let i = 0; i < tweetTexts.length; i++) {
      const tweetOptions: any = { text: tweetTexts[i] };

      // Add images only to the first tweet
      if (i === 0 && mediaIds.length > 0) {
        tweetOptions.media = { media_ids: mediaIds };
      }

      // Reply to previous tweet if this is not the first tweet
      if (lastTweetId) {
        tweetOptions.reply = { in_reply_to_tweet_id: lastTweetId };
      }

      const tweet = await twitterClient.v2.tweet(tweetOptions);
      console.log(`Tweet ${i + 1} sent:`, tweet);

      tweetIds.push(tweet.data.id);
      lastTweetId = tweet.data.id;
    }

    return res.status(200).json({
      message: "Tweet(s) sent",
      tweetIds: tweetIds,
      threadLength: tweetTexts.length,
      releasesCount: releases.length,
      imagesCount: mediaIds.length,
    });
  } catch (error) {
    console.error("Error sending tweet", error);
    return res.status(500).json({
      message: "Error sending tweet",
      error: (error as { message: string }).message,
    });
  }
}
