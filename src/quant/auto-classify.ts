/**
 * Auto-classification — assign symbols to groups based on characteristics.
 * Pure functions for classification logic.
 */

import type { RiskMetrics } from "./risk.ts";

export interface SymbolProfile {
  code: string;
  name: string;
  sector?: string;
  riskMetrics?: RiskMetrics;
  characteristics?: Record<string, number>;
}

export interface ClassificationRule {
  groupName: string;
  predicate: (profile: SymbolProfile) => boolean;
}

export interface ClassificationResult {
  groupId: string;
  groupName: string;
  symbolCodes: string[];
}

/**
 * Classify symbols into groups based on rules.
 * A symbol can belong to multiple groups (multi-membership).
 */
export function classifySymbols(
  profiles: SymbolProfile[],
  rules: ClassificationRule[],
): ClassificationResult[] {
  const groups = new Map<string, string[]>();

  for (const rule of rules) {
    const matching = profiles.filter(rule.predicate).map((p) => p.code);
    if (matching.length > 0) {
      const groupId = `auto-${slugify(rule.groupName)}`;
      const existing = groups.get(groupId);
      if (existing) {
        for (const code of matching) {
          if (!existing.includes(code)) existing.push(code);
        }
      } else {
        groups.set(groupId, matching);
      }
    }
  }

  return [...groups.entries()].map(([groupId, symbolCodes]) => ({
    groupId,
    groupName: rules.find((r) => `auto-${slugify(r.groupName)}` === groupId)?.groupName ?? groupId,
    symbolCodes,
  }));
}

/**
 * Pre-built classification rules for common scenarios.
 */
export function volatilityRule(profile: SymbolProfile, threshold: number): ClassificationRule {
  return {
    groupName: profile.riskMetrics && profile.riskMetrics.annualVol > threshold ? "高波动" : "低波动",
    predicate: (p) => p.riskMetrics !== undefined && p.riskMetrics.annualVol > threshold,
  };
}

export function drawdownRule(profile: SymbolProfile, threshold: number): ClassificationRule {
  return {
    groupName: "最大回撤超标",
    predicate: (p) => p.riskMetrics !== undefined && p.riskMetrics.maxDrawdown < threshold,
  };
}

export function sectorRule(sector: string): ClassificationRule {
  return {
    groupName: sector,
    predicate: (p) => p.sector === sector,
  };
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9一-龥]+/g, "-").replace(/^-|-$/g, "");
}
