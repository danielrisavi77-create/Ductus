"""Rules-first advisory adapter. Resource/process ownership belongs to the controller."""
from typing import Protocol
from .baseline import RulesPolicy, route_by_rules
from .contracts import (ContractError, RoutePolicy, RouteRequest, RouteResult, digest,
                        model_outcome, validate_probabilities, validate_request, validate_result, validate_usage)


class LayaBackend(Protocol):
    def score(self, request: RouteRequest) -> object:
        """Return answers.dev_route plus independently proven final token/truncation usage."""
        ...


def _object(raw: object, limit: int = 16) -> dict:
    if type(raw) is not dict or len(raw) > limit:
        raise ContractError("backend_malformed")
    return raw


def route_task(request: RouteRequest, policy: RoutePolicy, backend: LayaBackend) -> RouteResult:
    rules = RulesPolicy()
    provenance = {"input_hash": None, "source_commit": None,
                  "rules_hash": rules.rules_hash, "policy_hash": policy.policy_hash}

    def finish(status: str, reason: str, candidate=None, source="none", **evidence) -> RouteResult:
        result = RouteResult(status=status, reason_code=reason, candidate=candidate,
                            recommended_domain=candidate if status == "accepted" else None,
                            source=source, **provenance, **evidence)
        return validate_result(result.to_dict(), policy)

    try:
        request = validate_request(request)
    except ContractError as error:
        return finish("invalid", str(error))
    provenance.update(input_hash=digest(request.to_dict()), source_commit=request.source_commit)
    decision = route_by_rules(request, rules)
    if decision.reason_code == "rules_clear":
        return finish("accepted", "rules_clear", decision.candidate, "rules")
    if not policy.model_enabled:
        return finish("abstained", "model_disabled", "unknown_mixed")
    try:
        output = backend.score(request)
    except TimeoutError:
        # This records a backend-reported timeout; it cannot terminate a running CPU call.
        return finish("abstained", "backend_timeout")
    except Exception:
        return finish("abstained", "backend_error")
    try:
        output = _object(output)
        answer = _object(_object(output.get("answers")).get("dev_route"))
        candidate, confidence = answer.get("choice"), answer.get("answer_confidence")
        probabilities = validate_probabilities(answer.get("probabilities"), candidate, confidence)
        usage = output.get("usage")
        if type(usage) is not dict or len(usage) > 16:
            raise ContractError("backend_usage_unverified")
        tokens, truncated = usage.get("final_input_tokens"), usage.get("truncated")
        validate_usage(tokens, truncated)
    except ContractError as error:
        return finish("abstained", str(error))
    status, reason = model_outcome(candidate, confidence, policy)
    return finish(status, reason, candidate, "model", probabilities=probabilities,
                  answer_confidence=confidence, final_input_tokens=tokens, truncated=truncated)
