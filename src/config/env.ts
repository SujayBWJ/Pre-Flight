import dotenv from "dotenv";

dotenv.config();

export function hasGeminiApiKey(): boolean {
  return process.env.NODE_ENV !== "test" && Boolean(process.env.GEMINI_API_KEY?.trim());
}

export function getGeminiApiKey(): string | undefined {
  if (!hasGeminiApiKey()) return undefined;
  return process.env.GEMINI_API_KEY?.trim();
}