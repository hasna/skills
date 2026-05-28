import express from "express";

export const CONFIG = {
  port: parseInt(process.env.PORT || "3852"),
  apiKey: process.env.MCP_BROWSE_API_KEY || "",
  browserUseApiKey: process.env.BROWSER_USE_API_KEY || "",
};

// Validate API key middleware
export function validateApiKey(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  if (!CONFIG.apiKey) {
    return next();
  }
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: "Unauthorized - missing Authorization header" });
  }
  const [type, key] = authHeader.split(" ");
  if (type !== "Bearer" || key !== CONFIG.apiKey) {
    return res.status(401).json({ error: "Unauthorized - invalid API key" });
  }
  next();
}
