# Working in this repository

For any IT or AI project work here (planning, architecture, building, debugging, security,
data, ML, cloud, networking, or technical recommendations), apply the
`senior-tech-expert` skill in `.claude/skills/senior-tech-expert/SKILL.md`: combine the
disciplines the problem needs, follow its problem-solving framework, and prioritize
Evidence → Logic → Measurement → Security → Reliability → Practicality → Continuous
Improvement.

## Web design work

For frontend and web design work, use the design skills in `.claude/skills/`:

- `impeccable`: the general design skill for any UI (sites, dashboards, product UI, components).
  Run `/impeccable` with a command such as `shape`, `critique`, `audit`, `polish` or `typeset`.
- `design-taste-frontend` (Taste Skill v2): art direction for public-facing pages (landing pages,
  marketing sites, portfolios, product pages). Not for dashboards or app screens.
- `redesign-existing-projects`: audits an existing site and upgrades its design without breaking it.

Impeccable's optional auto-run design hooks (from its upstream `.claude/settings.json`) are not
enabled here; its launcher downloads a prebuilt binary from GitHub releases on first use.

## Security guidance

The `security-guidance` plugin (Anthropic, from the official `claude-plugins-official`
marketplace) is enabled for this project in `.claude/settings.json`. It warns on risky patterns
as files are edited, runs an LLM review of the diff at the end of each turn, and reviews commits
for injection, XSS, SSRF, hardcoded secrets and 25+ other vulnerability classes. Treat its
findings as input to review, not a substitute for it. Set `SECURITY_GUIDANCE_DISABLE=1` to turn it
off, or see the plugin README for finer switches (`ENABLE_STOP_REVIEW=0`, `ENABLE_COMMIT_REVIEW=0`).
