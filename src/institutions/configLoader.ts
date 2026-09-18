import hdfcConfig from "../../config/hdfc.json" with { type: "json" };
import sbiConfig from "../../config/sbi.json" with { type: "json" };
import idfcConfig from "../../config/idfc.json" with { type: "json" };
import { institutionConfigSchema, type InstitutionConfig } from "../domain/schemas.js";

const configs = [hdfcConfig, sbiConfig, idfcConfig].map((config) =>
  institutionConfigSchema.parse(config)
);

export function getInstitutionConfig(institution: string): InstitutionConfig {
  const config = configs.find((candidate) => candidate.institution === institution);
  if (!config) {
    throw new Error(`Unknown institution configuration: ${institution}`);
  }
  return config;
}

export function listInstitutionConfigs(): InstitutionConfig[] {
  return [...configs];
}