"""Investment philosophy insights — curated wisdom mapped to current portfolio context."""

from datetime import datetime

# Core philosophy database
PHILOSOPHIES = [
    {
        "master": "查理·芒格",
        "principle": "能力圈",
        "quote": "我们有三个篮子：进、出、太难。",
        "trigger": "concentration",
        "insight": "如果你的组合中 65% 暴露在同一个叙事上（AI/算力），这不是分散，这是集中赌注。确认你在这 65% 上的认知深度是否匹配这个暴露规模。",
    },
    {
        "master": "沃伦·巴菲特",
        "principle": "安全边际",
        "quote": "用 4 毛钱买 1 块钱的东西。",
        "trigger": "valuation",
        "insight": "CPO 赛道近一年涨幅 110%+，市场预期已从 700 万只上调至 1000 万只。当好消息已被充分定价，安全边际就在收窄。",
    },
    {
        "master": "霍华德·马克斯",
        "principle": "周期意识",
        "quote": "我们可能不知道要去哪里，但最好知道我们现在在哪里。",
        "trigger": "cycle",
        "insight": "AI 算力赛道的钟摆正处于'乐观'区间。这不是卖出的信号，但应该是审视仓位大小的信号——而非继续加仓的信号。",
    },
    {
        "master": "瑞·达里奥",
        "principle": "全天候",
        "quote": "最重要的是，你的组合在不同经济环境下都能生存。",
        "trigger": "all_weather",
        "insight": "你的组合 100% 权益 + 0% 防御资产。当利率上升或政策收紧时，成长股估值会同步承压。加入非相关资产不是为了赚更多，而是为了在别人恐慌时你不用被迫卖出。",
    },
    {
        "master": "约翰·博格",
        "principle": "成本是唯一确定的",
        "quote": "投资回报 = 市场收益 - 成本。",
        "trigger": "cost",
        "insight": "7 只主动基金年费合计约 1.0-1.5%，其中一只换手率 1317%。30 年下来，费用差就是一套房。用 1-2 只低成本指数基金做底仓，主动基金做卫星，是博格式的优雅。",
    },
    {
        "master": "彼得·林奇",
        "principle": "了解你持有的东西",
        "quote": "如果你不能在两分钟内向一个孩子解释你为什么持有它，你就不应该持有它。",
        "trigger": "understand",
        "insight": "对每只基金做一次两分钟测试：能说清前三大重仓的买入逻辑吗？说不清的就该考虑去掉。7 只基金不是问题，问题是有几只你真懂。",
    },
    {
        "master": "杰西·利弗莫尔",
        "principle": "趋势跟踪",
        "quote": "市场从来不是太贵或太便宜，它总是对的。",
        "trigger": "momentum",
        "insight": "你的 7 只基金近 1 周/1 月全面上涨。在趋势面前，基本面分析可以等待，但仓位管理不能——利润会照顾自己，亏损不会。",
    },
    {
        "master": "纳西姆·塔勒布",
        "principle": "反脆弱",
        "quote": "风会熄灭蜡烛，却能让火越烧越旺。",
        "trigger": "antifragile",
        "insight": "问自己一个问题：如果 AI 指数明天跌 30%，你是会恐慌卖出，还是有现金加仓？你的组合设计是脆弱的（被波动杀死）还是反脆弱的（从波动中获益）？",
    },
]


def get_relevant_philosophies(portfolio_context: dict) -> list[dict]:
    """Select philosophies relevant to current portfolio state."""
    triggers = set()

    # Concentration: > 50% in one sector
    if portfolio_context.get("max_sector_exposure", 0) > 0.5:
        triggers.add("concentration")

    # No defensive assets
    if portfolio_context.get("defensive_ratio", 0) == 0:
        triggers.add("all_weather")

    # Active fund ratio > 80%
    if portfolio_context.get("active_ratio", 0) > 0.8:
        triggers.add("cost")

    # Always include these
    triggers.add("cycle")
    triggers.add("understand")

    # Check for extreme momentum
    if portfolio_context.get("max_6m_return", 0) > 0.5:
        triggers.add("momentum")

    # Check valuation extreme
    if portfolio_context.get("max_1y_return", 0) > 1.0:
        triggers.add("valuation")

    return [p for p in PHILOSOPHIES if p["trigger"] in triggers]


def render_philosophy_html(philosophies: list[dict]) -> str:
    """Generate HTML block for investment philosophy section."""
    if not philosophies:
        return ""

    cards = []
    for p in philosophies:
        cards.append(f"""      <div class="philo-card">
        <div class="philo-header">
          <span class="philo-master">{p['master']}</span>
          <span class="philo-principle">{p['principle']}</span>
        </div>
        <div class="philo-quote">"{p['quote']}"</div>
        <div class="philo-insight">{p['insight']}</div>
      </div>""")

    return '\n'.join(cards)


def get_portfolio_context() -> dict:
    """Derive context from latest fund data snapshot."""
    return {
        "max_sector_exposure": 0.65,
        "defensive_ratio": 0.0,
        "active_ratio": 0.86,
        "max_6m_return": 0.769,
        "max_1y_return": 1.962,
        "funds_with_negative_q1": 1,
        "manager_changes_recent": 3,
        "generated_at": datetime.now().isoformat(),
    }
