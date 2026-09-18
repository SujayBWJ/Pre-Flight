import { canonicalProfileSchema, type CanonicalProfile } from "../domain/schemas.js";

export interface IntentExtractor {
  extract(message: string): Promise<{ profile: CanonicalProfile; source: "live_ai" | "deterministic_demo_fallback" }>;
}

function parseAmount(value: string, isLakh: boolean): number {
  const amount = Number(value.replace(/,/g, ""));
  return isLakh ? amount * 100000 : amount;
}

export class DemoIntentExtractor implements IntentExtractor {
  async extract(message: string) {
    const lower = message.toLowerCase();
    const lakhMatch = lower.match(/(?:₹|rs\.?\s*)?([\d,]+(?:\.\d+)?)\s*(lakh|lac)/);
    const rupeeMatch = lower.match(/(?:₹|rs\.?\s*)?([\d,]+)\s*(?:rupees?|inr)/);
    const amountMatch = lakhMatch ?? rupeeMatch;
    const years = lower.match(/(\d+)\s*years?/);
    const months = lower.match(/(\d+)\s*months?/);
    const income = lower.match(/(?:earn|income|salary)[^\d₹]*₹?\s*([\d,]+)/);
    const emi = lower.match(/(?:emi|obligation)[^\d₹]*₹?\s*([\d,]+)/);

    const profile = canonicalProfileSchema.parse({
      product: "personal_loan",
      loan_amount: amountMatch ? parseAmount(amountMatch[1] ?? "0", Boolean(lakhMatch)) : null,
      tenure_months: months ? Number(months[1]) : years ? Number(years[1]) * 12 : null,
      income: { gross_monthly: income ? Number((income[1] ?? "0").replace(/,/g, "")) : null, net_monthly: null },
      employment: { type: lower.includes("salar") ? "salaried" : null, employer: null },
      existing_emi: emi ? Number((emi[1] ?? "0").replace(/,/g, "")) : null,
      purpose: null
    });
    return { profile, source: "deterministic_demo_fallback" as const };
  }
}

export class GeminiIntentExtractor implements IntentExtractor {
  constructor(private readonly apiKey: string) {}

  async extract(message: string) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Extract a personal-loan profile as JSON. Unknown values must be null. Do not infer values. Message: ${message}` }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });
    if (!response.ok) throw new Error(`Gemini intent extraction failed with ${response.status}`);
    const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini returned no intent content");
    const profile = canonicalProfileSchema.parse(JSON.parse(text.replace(/^```json\s*|\s*```$/g, "")));
    return { profile, source: "live_ai" as const };
  }
}

export function createIntentExtractor(): IntentExtractor {
  return process.env.GEMINI_API_KEY
    ? new GeminiIntentExtractor(process.env.GEMINI_API_KEY)
    : new DemoIntentExtractor();
}