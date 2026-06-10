/**
 * Comparison orchestration — ties together auto-classification and group comparison.
 * Coordinates data fetching, classification, and comparison artifact generation.
 */

import { classifySymbols, type ClassificationRule, type SymbolProfile } from "./auto-classify.ts";
import { synthesizeEqualWeightNav, groupRiskFromNav, totalReturn, type GroupComparisonResult } from "./group-comparison.ts";
import { saveComparison, generateComparisonId } from "../storage/comparison.ts";

export interface ComparisonConfig {
  name: string;
  rules: ClassificationRule[];
}

export interface ComparisonContext {
  fetchSymbolProfile: (code: string) => Promise<SymbolProfile | null>;
  fetchSymbolReturns: (code: string) => Promise<Map<string, number>>;
}

/**
 * Run a full comparison pipeline:
 * 1. Fetch profiles for all symbols
 * 2. Classify into groups based on rules
 * 3. Calculate NAV and risk metrics for each group
 * 4. Save comparison artifact
 */
export async function runComparison(
  symbolCodes: string[],
  config: ComparisonConfig,
  context: ComparisonContext,
): Promise<string> {
  // 1. Fetch profiles
  const profiles: SymbolProfile[] = [];
  for (const code of symbolCodes) {
    const profile = await context.fetchSymbolProfile(code);
    if (profile) profiles.push(profile);
  }

  if (profiles.length === 0) {
    throw new Error("No valid symbols to compare");
  }

  // 2. Classify into groups
  const classifications = classifySymbols(profiles, config.rules);
  if (classifications.length === 0) {
    throw new Error("No groups matched the classification rules");
  }

  // 3. Calculate NAV and risk for each group
  const results: GroupComparisonResult[] = [];
  for (const classification of classifications) {
    const symbolReturns = new Map<string, Map<string, number>>();
    for (const code of classification.symbolCodes) {
      const returns = await context.fetchSymbolReturns(code);
      symbolReturns.set(code, returns);
    }

    const navSeries = synthesizeEqualWeightNav(symbolReturns);
    const risk = groupRiskFromNav(navSeries);
    const ret = totalReturn(navSeries);

    if (risk) {
      results.push({
        groupId: classification.groupId,
        groupName: classification.groupName,
        symbolCount: classification.symbolCodes.length,
        risk,
        totalReturn: ret,
        navSeries,
      });
    }
  }

  if (results.length === 0) {
    throw new Error("No groups had sufficient data for comparison");
  }

  // 4. Save artifact
  const artifact = {
    id: generateComparisonId(),
    createdAt: new Date().toISOString(),
    groups: results,
  };
  saveComparison(artifact);

  return artifact.id;
}
