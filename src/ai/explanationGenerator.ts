import type { VerificationIssue } from "../domain/schemas.js";

export interface ExplanationGenerator {
  explain(issue: VerificationIssue): Promise<string>;
}

export class StructuredIssueExplanationGenerator implements ExplanationGenerator {
  async explain(issue: VerificationIssue) {
    return `The declared value for ${issue.canonical_field} is ${issue.declared_value}, while ${issue.evidence.source_label} on page ${issue.evidence.page} shows ${issue.documented_value}. Review the income definition or provide supporting evidence, then re-run the preparation check.`;
  }
}