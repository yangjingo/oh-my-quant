# Review Methods and Tradeoffs

Source review date: 2026-10-17. This page explains the method; it is not a mandatory checklist for every review. Dated observations are historical, not current repository status.

| Source | Useful idea | Local boundary |
| --- | --- | --- |
| [Anthropic: How the Claude Code team does code review](https://claude.dev/blog/solving-code-review-at-anthropic/) | Continuous verification, validated findings, low noise, revision-bound approval, and evaluation with both defective and clean examples | A company account does not establish this team's results; do not adopt unattended approval, agent voting, or automatic merging by implication |
| [Hacker News discussion](https://news.ycombinator.com/item?id=50122951) | jonahx questions whether generated explanations replace shared causal understanding; csallen offers counterarguments based on version control, tests, and readable code | Community disagreement is not experimental evidence; make state ownership, failure paths, and recovery inspectable locally |
| [Google: The Standard of Code Review](https://google.github.io/eng-practices/review/reviewer/standard.html) | Improve overall code health while allowing imperfect improvements to proceed | Separate preferences and optional improvements from correctness blockers |
| [Google: Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html) | Self-contained changes that are understandable and reversible, including necessary tests and consumers | No universal line threshold or directory-based splitting of one complete behavior |
| [Google: What to look for](https://google.github.io/eng-practices/review/reviewer/looking-for.html) | Context, complexity, actual behavior, and test quality | Prioritize module interfaces and state contracts |
| [Google: Review comments](https://google.github.io/eng-practices/review/reviewer/comments.html) | Explain reasons, distinguish required and optional changes, and discuss code rather than people | Give the smallest repair objective without imposing the reviewer's preferred implementation |
| [Google: Speed of reviews](https://google.github.io/eng-practices/review/reviewer/speed.html) | Timely responses that support team progress and focused work | No response SLA has been established here |
| [GitHub: Managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) | Test the latest base with preceding candidates; configure merge_group when using a queue | Availability depends on account and repository conditions. This review did not enable it; sequential base updates and checks can suffice for a small queue |

## Using Local Cases

At main `076b786` on 2026-10-17, PR #35 had no textual conflict; #28 and #27 conflicted with docs/README.md. PR #28 described an older verification revision; #27 exposed reproducible stale-snapshot overwrite and silent replacement of damaged files. The [Repo Ops article](../../../../docs/blog/agentic/vibe-repo-ops.md#review) holds the case evidence. These limited examples do not establish a team defect rate.

Include both defective changes and changes that should pass in regression samples. A large deletion of duplicated behavior should not be blocked solely by size; an existing CI failure needs classification before attribution. Valid findings, false positives, review rounds, and post-merge reversions can inform future evaluation, but this work established no baseline or demonstrated reduction in incidents.
