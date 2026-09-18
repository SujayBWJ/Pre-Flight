import { getGeminiApiKey } from "../config/env.js";
import { canonicalProfileSchema, type CanonicalProfile } from "../domain/schemas.js";

export interface IntentExtractor {
  extract(message: string): Promise<{ profile: CanonicalProfile; source: "live_ai" | "deterministic_demo_fallback" }>;
}

function parseMonetaryValue(value: string, unit?: string): number {
  const amount = Number(value.replace(/,/g, ""));
  const normalizedUnit = unit?.toLowerCase();
  if (normalizedUnit === "lakh" || normalizedUnit === "lac" || normalizedUnit === "l") return amount * 100000;
  if (normalizedUnit === "k" || normalizedUnit === "thousand") return amount * 1000;
  return amount;
}

const moneyToken = "(?:₹|rs\\.?\\s*)?([\\d,]+(?:\\.\\d+)?)\\s*(lakh|lac|l|k|thousand)?(?:\\s*rupees?|\\s*inr)?";

function findMoney(message: string, labels: string): number | null {
  const match = message.match(new RegExp(`(?:${labels})\\b[^\\d₹]*${moneyToken}`, "i"));
  return match ? parseMonetaryValue(match[1] ?? "0", match[2]) : null;
}

function normalizeProfileFromMessage(profile: CanonicalProfile, message: string): CanonicalProfile {
  const loanAmount = findMoney(message, "loan(?:\\s+amount)?|borrow|need");
  const income = findMoney(message, "earn|income|salary");
  const emi = findMoney(message, "emi|obligation");
  const lower = message.toLowerCase();
  const explicitEmployment = lower.includes("self-employed") || lower.includes("self employed")
    ? "self_employed"
    : lower.includes("salar")
      ? "salaried"
      : lower.includes("other")
        ? "other"
        : profile.employment.type;
  return canonicalProfileSchema.parse({
    ...profile,
    loan_amount: loanAmount ?? profile.loan_amount,
    income: { ...profile.income, gross_monthly: income ?? profile.income.gross_monthly },
    existing_emi: emi ?? profile.existing_emi,
    employment: { ...profile.employment, type: explicitEmployment }
  });
}

export class DemoIntentExtractor implements IntentExtractor {
  async extract(message: string) {
    const lower = message.toLowerCase();
    const years = lower.match(/(\d+)\s*years?/);
    const months = lower.match(/(\d+)\s*months?/);
    const loanAmount = findMoney(lower, "loan(?:\\s+amount)?|borrow|need");
    const grossIncome = findMoney(lower, "earn|income|salary");
    const existingEmi = findMoney(lower, "emi|obligation");

    const profile = canonicalProfileSchema.parse({
      product: "personal_loan",
      loan_amount: loanAmount,
      tenure_months: months ? Number(months[1]) : years ? Number(years[1]) * 12 : null,
      income: { gross_monthly: grossIncome, net_monthly: null },
      employment: { type: lower.includes("salar") ? "salaried" : null, employer: null },
      existing_emi: existingEmi,
      purpose: null
    });
    return { profile: normalizeProfileFromMessage(profile, message), source: "deterministic_demo_fallback" as const };
  }
}

export class GeminiIntentExtractor implements IntentExtractor {
  constructor(private readonly apiKey: string) {}

  async extract(message: string) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${this.apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Extract only the personal-loan fields defined by the response schema from this user message. Unknown values must be null. Do not infer values, add fields, or return explanations. Message: ${message}` }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              product: { type: "STRING", enum: ["personal_loan"] },
              loan_amount: { type: "NUMBER", nullable: true },
              tenure_months: { type: "INTEGER", nullable: true },
              income: {
                type: "OBJECT",
                properties: {
                  gross_monthly: { type: "NUMBER", nullable: true },
                  net_monthly: { type: "NUMBER", nullable: true }
                },
                required: ["gross_monthly", "net_monthly"]
              },
              employment: {
                type: "OBJECT",
                properties: {
                  type: { type: "STRING", enum: ["salaried", "self_employed", "other"], nullable: true },
                  employer: { type: "STRING", nullable: true }
                },
                required: ["type", "employer"]
              },
              existing_emi: { type: "NUMBER", nullable: true },
              purpose: { type: "STRING", nullable: true }
            },
            required: ["product", "loan_amount", "tenure_months", "income", "employment", "existing_emi", "purpose"]
          }
        }
      })
    });
    if (!response.ok) throw new Error(`Gemini intent extraction failed with ${response.status}`);
    const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini returned no intent content");
    const profile = canonicalProfileSchema.parse(JSON.parse(text.replace(/^```json\s*|\s*```$/g, "")));
    return { profile: normalizeProfileFromMessage(profile, message), source: "live_ai" as const };
  }
}

export function createIntentExtractor(): IntentExtractor {
  const apiKey = getGeminiApiKey();
  return apiKey ? new GeminiIntentExtractor(apiKey) : new DemoIntentExtractor();
}