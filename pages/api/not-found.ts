import type { NextApiRequest, NextApiResponse } from "next";

type ErrorResponse = {
  error: string;
  message: string;
};

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<ErrorResponse>
) {
  res.status(404).json({
    error: "Not Found",
    message: "This endpoint serves API routes only. Please use /api/* endpoints.",
  });
}
