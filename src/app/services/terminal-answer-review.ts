import { auditCurrentFundAnswer } from "../../runtime/evidence/fund-answer-evidence.ts";
import { auditCurrentFactorAnswer } from "../../runtime/evidence/factor-answer-evidence.ts";
import { auditCurrentPortfolioAnswer } from "../../runtime/evidence/portfolio-answer-evidence.ts";
import { auditCurrentRiskAnswer } from "../../runtime/evidence/risk-answer-evidence.ts";
import { auditCurrentNewsAnswer } from "../../runtime/evidence/news-answer-evidence.ts";
import { knownNewsPriceBasisViolations } from "../../runtime/evidence/news-answer-claims.ts";
import { newsAnswerCitationKeys } from "../../research/news-citations.ts";
import { hasRiskMetricLabel, RISK_ANSWER_VIOLATION_LABELS } from "../../runtime/evidence/risk-answer-claims.ts";
import { performanceMethodClaimViolations } from "../../runtime/evidence/performance-method-claims.ts";
import { portfolioWeightClaimViolations } from "../../runtime/evidence/portfolio-weight-claims.ts";
import { comparisonExcessClaimViolations } from "../../runtime/evidence/comparison-answer-methods.ts";
import { auditCurrentAnnualAnswer } from "../../runtime/evidence/annual-answer-evidence.ts";
import { hasExplicitFactorLatestClaim, knownFactorAnswerViolations } from "../../runtime/evidence/factor-answer-claims.ts";
import type { QuantAgentSession } from "../../agent/src/session-contracts.ts";

export interface TerminalAnswerReview { message: string; status: string }

/** Existing terminal answer checks; neither a view nor HTTP transport owns their result. */
export async function reviewTerminalAnswer(answer: string, agent: Pick<QuantAgentSession, "getResearchState"> | null): Promise<TerminalAnswerReview | undefined> {
  return new AnswerReview(agent).review(answer);
}

class AnswerReview {
  private message = "";
  private status = "";
  constructor(private readonly agent: Pick<QuantAgentSession, "getResearchState"> | null) {}
  async review(answer: string): Promise<TerminalAnswerReview | undefined> {
    const flagged = this.flagContradictoryPerformanceMethod(answer)
      || await this.flagContradictoryWeightSum(answer)
      || await this.flagContradictoryAnnualAnswer(answer)
      || await this.flagContradictoryFundAnswer(answer) || await this.flagUnsupportedFactorAnswer(answer)
      || await this.flagContradictoryRiskAnswer(answer)
      || await this.flagUnsupportedNewsAnswer(answer)
      || await this.flagContradictoryPortfolioAnswer(answer);
    return flagged ? { message: this.message, status: this.status } : undefined;
  }
  private flagContradictoryPerformanceMethod(answer: string): boolean {
    const violations = performanceMethodClaimViolations(answer);
    if (!violations.length) return false;
    const detail = violations.map(code => code === "wrong-drawdown-period-method"
      ? "最大回撤是累计峰谷跌幅，不是单期收益"
      : "Sharpe 取决于平均超额收益与收益标准差，零回撤不能解释高 Sharpe").join("；");
    this.message = `绩效口径回答需要复核：${detail}。`;
    this.status = `Performance answer needs review · ${detail}`;
    return true;
  }

  private async flagContradictoryWeightSum(answer: string): Promise<boolean> {
    if (!this.agent || !/[+＋]/u.test(answer) || !/[%％]/u.test(answer)) return false;
    try {
      const request = (await this.agent.getResearchState()).requests.at(-1)?.text ?? "";
      if (!portfolioWeightClaimViolations(answer, request).length) return false;
      const detail = "列出的标的权重之和与用户提供的组合权重不一致";
      this.message = `组合权重回答需要复核：${detail}。`;
      this.status = `Portfolio weights need review · ${detail}`;
      return true;
    } catch { return false; } // No matched supplied weights means no numerical claim can be checked.
  }

  private async flagContradictoryAnnualAnswer(answer: string): Promise<boolean> {
    if (!this.agent || !comparisonExcessClaimViolations(answer).length) return false;
    try {
      const audit = auditCurrentAnnualAnswer(await this.agent.getResearchState(), answer);
      if (audit.status === "not-annual" || !audit.violations.length) return false;
      const detail = "本年报超额收益是与基准的总收益百分点差，不是风险调整 alpha，表头应标为超额收益";
      this.message = `年报回答需要复核：${detail}。`;
      this.status = `Annual answer needs review · ${detail}`;
    } catch {
      this.message = "年报回答需要复核：当前无法读取研究证据。";
      this.status = "Annual answer needs review · evidence unavailable";
    }
    return true;
  }

  /** The final text stays visible; warn on a proven mismatch and avoid archiving it as an automatic report. */
  private async flagContradictoryFundAnswer(answer: string): Promise<boolean> {
    if (!this.agent || !/(?:Principal\s+return|本金收益率|Time[- ]weighted\s+return|时间加权收益率|Maximum\s+drawdown|最大回撤|TWR)/iu.test(answer))
      return false;
    try {
      const audit = auditCurrentFundAnswer(await this.agent.getResearchState(), answer);
      if (audit.status === "not-fund") return false;
      if (audit.status === "audited" && !audit.violations.length) return false;
      const labels: Record<string, string> = {
        "wrong-verified-principal-return": "本金收益率",
        "wrong-verified-time-weighted-return": "时间加权收益率",
        "wrong-verified-twr-drawdown": "最大回撤",
        "wrong-fixed-principal-formula": "本金收益公式",
      };
      const detail = audit.status === "unavailable" ? "当前任务缺少可匹配的已核验基金指标"
        : audit.violations.map(code => code === "unaligned-direct-twr-comparison"
          ? "基金或基准直接比较缺少同句明确的区间、币种、费用与分红对齐前提"
          : `${labels[code] ?? code}与已核验工具结果不一致`).join("；");
      this.message = `基金回答需要复核：${detail}。请检查 fund_dca_backtest 的任务参数与原始指标。`;
      this.status = `Fund answer needs review · ${detail}`;
    } catch {
      this.message = "基金回答需要复核：当前无法读取研究证据。";
      this.status = "Fund answer needs review · evidence unavailable";
    }
    return true;
  }

  private async flagUnsupportedFactorAnswer(answer: string): Promise<boolean> {
    if (!this.agent || !knownFactorAnswerViolations(answer).length && !hasExplicitFactorLatestClaim(answer)
      && !/\b(?:momentum|reversal|volatility|rsi)\s*[(（]\s*\d+\s*[)）]/iu.test(answer)) return false;
    try {
      const audit = auditCurrentFactorAnswer(await this.agent.getResearchState(), answer);
      if (audit.status === "not-factor" || audit.status === "audited" && !audit.violations.length) return false;
      const detail = audit.status === "unavailable" ? "当前任务缺少可匹配的已核验因子证据"
        : audit.violations.map(code => code === "wrong-verified-factor-latest" ? "最新因子值与已核验工具结果不一致"
          : code === "ambiguous-verified-factor-latest" ? "多个因子结果需要标明因子名和周期才能匹配最新值"
          : code === "unsupported-factor-annualization-prohibition" ? "因子原值未年化；有明确观察频率与假设时可另行按平方根频率换算，不能笼统禁止年化"
          : code === "wrong-factor-close-observation-minimum" ? "N 期收益因子至少需要 N+1 个收盘价观察"
          : "历史因子分位未检验后续收益，不能据此断言均值回归").join("；");
      this.message = `因子回答需要复核：${detail}。请核对 compute_factor 的任务参数与原始指标。`;
      this.status = `Factor answer needs review · ${detail}`;
    } catch {
      this.message = "因子回答需要复核：当前无法读取研究证据。";
      this.status = "Factor answer needs review · evidence unavailable";
    }
    return true;
  }

  private async flagContradictoryRiskAnswer(answer: string): Promise<boolean> {
    if (!this.agent || !hasRiskMetricLabel(answer)) return false;
    try {
      const audit = auditCurrentRiskAnswer(await this.agent.getResearchState(), answer);
      if (audit.status === "not-risk" || audit.status === "audited" && !audit.violations.length) return false;
      const detail = audit.status === "unavailable" ? "当前任务缺少可匹配的已核验风险指标"
        : `${audit.violations.map(code => RISK_ANSWER_VIOLATION_LABELS[code] ?? code).join("、")}与已核验工具结果不一致`;
      this.message = `风险回答需要复核：${detail}。请检查 check_risk 的任务参数与原始指标。`;
      this.status = `Risk answer needs review · ${detail}`;
    } catch {
      this.message = "风险回答需要复核：当前无法读取研究证据。";
      this.status = "Risk answer needs review · evidence unavailable";
    }
    return true;
  }

  private async flagUnsupportedNewsAnswer(answer: string): Promise<boolean> {
    if (!this.agent || !newsAnswerCitationKeys(answer).length && !knownNewsPriceBasisViolations(answer, null).length) return false;
    try {
      const audit = auditCurrentNewsAnswer(await this.agent.getResearchState(), answer);
      if (audit.status === "not-news" || audit.status === "audited" && !audit.violations.length) return false;
      const detail = audit.status === "unavailable" ? "无法唯一匹配新闻结果或引用映射"
        : audit.violations.some(code => code.endsWith("news-citation")) ? "正文引用格式无效，或所引段落不在可引用证据中"
          : audit.violations.includes("unreported-condition-promoted-to-nonoccurrence") ? "原文未报告条件发生，不能据此断言条件未发生"
          : "价格复权口径断言缺少对应新闻快照支持";
      this.message = `新闻回答需要复核：${detail}。请检查 research_news 的原始正文引用与价格复权说明。`;
      this.status = `News answer needs review · ${detail}`;
    } catch {
      this.message = "新闻回答需要复核：当前无法读取研究证据。";
      this.status = "News answer needs review · evidence unavailable";
    }
    return true;
  }

  private async flagContradictoryPortfolioAnswer(answer: string): Promise<boolean> {
    if (!this.agent || !/(?:累计收益|总收益|总回报|total\s+return|最大回撤|max(?:imum)?\s+drawdown|\bTR\b|\bDD\b)/iu.test(answer)
      && !comparisonExcessClaimViolations(answer).length && !/(?:基准|benchmark|跑赢|跑输|outperformed|underperformed|matched|tied|\bbeat\b|\blagged\b)/iu.test(answer)) return false;
    try {
      const audit = auditCurrentPortfolioAnswer(await this.agent.getResearchState(), answer);
      if (audit.status === "not-portfolio" || audit.status === "audited" && !audit.violations.length) return false;
      const detail = audit.status === "unavailable" ? "当前任务缺少可匹配的已核验组合比较"
        : `${audit.violations.map(code => {
          if (code === "excess-return-labelled-alpha") return "超额收益标签";
          const group = code.includes("-a-") ? "组合 A" : "组合 B";
          if (code.endsWith("-benchmark-direction")) return `${group} 相对基准的收益方向`;
          return `${group} ${code.endsWith("-return") ? "累计收益" : "最大回撤"}`;
        }).join("、")}与已核验工具结果不一致`;
      this.message = `组合回答需要复核：${detail}。请检查 compare_portfolios 的任务参数与原始指标。`;
      this.status = `Portfolio answer needs review · ${detail}`;
    } catch {
      this.message = "组合回答需要复核：当前无法读取研究证据。";
      this.status = "Portfolio answer needs review · evidence unavailable";
    }
    return true;
  }

}
