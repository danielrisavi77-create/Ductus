"""Small fixed, versioned rules. All credible signals accumulate before deciding."""
from dataclasses import dataclass
from .contracts import RouteRequest, digest, validate_request

PATH_RULES = (
    ("src/domain/document/", "domain_contracts"),
    ("src/domain/evidence/", "domain_contracts"),
    ("src/domain/forensics/", "domain_contracts"),
    ("src/domain/citation/", "domain_contracts"),
    ("src/domain/diff/", "domain_contracts"),
    ("src/domain/collaboration/", "domain_contracts"),
    ("src/editor/", "editor_ui"), ("src/components/", "editor_ui"),
    ("src/lib/i18n/", "editor_ui"),
    ("src/domain/sync/", "sync_storage"), ("src/domain/serverSync/", "sync_storage"),
    ("src/client/sync/", "sync_storage"), ("src/client/journal/", "sync_storage"),
    ("src/client/storage/", "sync_storage"), ("src/client/recovery/", "sync_storage"),
    ("src/server/", "backend_auth"), ("app/api/", "backend_auth"),
    (".github/workflows/", "ci_tooling"), ("scripts/", "ci_tooling"),
    ("infra/", "ci_tooling"), ("docs/", "documentation"),
)
EXACT_RULES = (("src/domain/json.ts", "domain_contracts"),
               ("src/domain/json.test.ts", "domain_contracts"),
               ("package.json", "ci_tooling"), ("pnpm-lock.yaml", "ci_tooling"),
               ("lefthook.yml", "ci_tooling"), ("compose.yaml", "ci_tooling"),
               ("eslint.config.mjs", "ci_tooling"), ("vitest.config.ts", "ci_tooling"),
               ("tsconfig.json", "ci_tooling"), ("playwright.config.ts", "ci_tooling"),
               ("README.md", "documentation"))
TEST_WRAPPERS = ("tests/unit/", "tests/property/", "tests/integration/", "tests/")


@dataclass(frozen=True)
class RulesPolicy:
    """No request-selected rules: this foundation exposes one fixed local table."""
    @property
    def version(self) -> str:
        return "ductura.dev_route.rules.v1"

    @property
    def rules_hash(self) -> str:
        return digest({"version": self.version, "prefixes": PATH_RULES, "exact": EXACT_RULES,
                       "test_wrappers": TEST_WRAPPERS, "labels": "exact_six_domain_names",
                       "decision": "one_distinct_signal_else_unknown"})


@dataclass(frozen=True)
class RuleDecision:
    candidate: str
    reason_code: str
    probabilities: None = None


def route_by_rules(request: RouteRequest, rules: RulesPolicy) -> RuleDecision:
    from .contracts import DOMAINS
    request = validate_request(request)
    signals = {label for label in request.labels if label in DOMAINS}
    for path in request.paths:
        for wrapper in TEST_WRAPPERS:
            if path.startswith(wrapper):
                # A test title alone has no domain. Only an explicit module path is evidence.
                remainder = path[len(wrapper):]
                path = remainder if remainder.startswith(("src/", "app/api/", "scripts/")) else ""
                break
        signals.update(category for prefix, category in PATH_RULES if path.startswith(prefix))
        signals.update(category for exact, category in EXACT_RULES if path == exact)
    if len(signals) == 1:
        return RuleDecision(next(iter(signals)), "rules_clear")
    return RuleDecision("unknown_mixed", "rules_conflict" if signals else "rules_no_signal")
