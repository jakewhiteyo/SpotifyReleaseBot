import type { NextApiRequest, NextApiResponse } from "next";

type Data = {
  message: string;
  timestamp: string;
};

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  res.status(200).json({
    message: "Hello from your Spotify Release Bot API!",
    timestamp: new Date().toISOString(),
  });
}
