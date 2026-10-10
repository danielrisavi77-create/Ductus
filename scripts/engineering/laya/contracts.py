"""Bounded, advisory-only development routing contracts (stdlib only)."""
from dataclasses import dataclass, fields
import hashlib
import json
import math
import re
from types import MappingProxyType
from typing import Mapping

LABELS = ("domain_contracts", "editor_ui", "sync_storage", "backend_auth",
          "ci_tooling", "documentation", "unknown_mixed")
DOMAINS = LABELS[:-1]
REQUEST_FIELDS = frozenset(("schema_version", "project_id", "project_task_id",
                           "source_commit", "language", "purpose", "summary", "paths", "labels"))
REQUEST_ERRORS = frozenset(("request_fields", "request_text", "request_value", "request_paths"))
TECHNICAL_REASONS = frozenset(("backend_malformed", "backend_usage_unverified", "backend_error", "backend_timeout"))


class ContractError(ValueError):
    """Stable safe code only; never include untrusted keys, values or exceptions."""


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                    separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()


def exact_fields(raw: object, expected: frozenset[str], code: str) -> dict:
    if type(raw) is not dict or len(raw) != len(expected):
        raise ContractError(code)
    if any(type(key) is not str or len(key) > 64 or key not in expected for key in raw):
        raise ContractError(code)
    return raw


def text(value: object, limit: int, code: str = "request_text") -> str:
    if type(value) is not str or len(value) > limit or not value.strip():
        raise ContractError(code)
    try:
        if len(value.encode("utf-8")) > limit:
            raise ContractError(code)
    except UnicodeError:
        raise ContractError(code) from None
    return value


def hex_hash(value: object, width: int) -> bool:
    return type(value) is str and len(value) == width and re.fullmatch(r"[0-9a-f]+", value) is not None


@dataclass(frozen=True)
class RouteRequest:
    schema_version: str
    project_id: str
    project_task_id: str
    source_commit: str
    language: str
    purpose: str
    summary: str
    paths: tuple[str, ...]
    labels: tuple[str, ...]

    def to_dict(self) -> dict:
        return {field.name: list(getattr(self, field.name)) if field.name in ("paths", "labels")
                else getattr(self, field.name) for field in fields(self)}


def validate_request(raw: object) -> RouteRequest:
    # Revalidate even directly constructed dataclasses; they are not a trust boundary.
    if type(raw) is RouteRequest:
        if any(type(getattr(raw, key)) is not tuple or len(getattr(raw, key)) > 128
               for key in ("paths", "labels")):
            raise ContractError("request_fields")
        raw = raw.to_dict()
    raw = exact_fields(raw, REQUEST_FIELDS, "request_fields")
    for key, limit in (("schema_version", 64), ("project_id", 64), ("project_task_id", 128),
                       ("source_commit", 40), ("language", 16), ("purpose", 64), ("summary", 4096)):
        text(raw[key], limit)
    if (raw["schema_version"] != "ductura.dev_route.v1" or raw["project_id"] != "Ductus"
            or raw["purpose"] != "ductura.dev_route" or raw["language"] not in ("hr", "en", "mixed")
            or not hex_hash(raw["source_commit"], 40)):
        raise ContractError("request_value")
    for key, limit in (("paths", 1024), ("labels", 256)):
        values = raw[key]
        if type(values) is not list or len(values) > 128:
            raise ContractError("request_fields")
        for value in values:
            text(value, limit)
            if key == "paths" and ("\\" in value or ":" in value
                    or any(ord(char) < 32 or ord(char) == 127 for char in value)
                    or any(part in ("", ".", "..") for part in value.split("/"))):
                raise ContractError("request_paths")
    return RouteRequest(**{**raw, "paths": tuple(raw["paths"]), "labels": tuple(raw["labels"])})


@dataclass(frozen=True)
class RoutePolicy:
    model_enabled: bool = False
    confidence_threshold: float | None = None
    calibration_status: str = "not_evaluated"

    def __post_init__(self):
        if (type(self.model_enabled) is not bool or self.calibration_status != "not_evaluated"
                or (self.confidence_threshold is not None and not probability(self.confidence_threshold))
                or (self.model_enabled and self.confidence_threshold is None)):
            raise ContractError("policy_invalid")

    @property
    def policy_hash(self) -> str:
        return digest({"version": "ductura.dev_route.policy.v1", "model_enabled": self.model_enabled,
                       "confidence_threshold": self.confidence_threshold,
                       "calibration_status": self.calibration_status, "max_final_input_tokens": 512})


def probability(value: object) -> bool:
    return type(value) in (int, float) and 0 <= value <= 1 and math.isfinite(value)


def validate_probabilities(raw: object, choice: object, confidence: object) -> Mapping[str, float]:
    raw = exact_fields(raw, frozenset(LABELS), "backend_malformed")
    if (type(choice) is not str or choice not in LABELS or not probability(confidence)
            or any(not probability(value) for value in raw.values())):
        raise ContractError("backend_malformed")
    if (abs(math.fsum(raw.values()) - 1) > 0.001
            or abs(raw[choice] - confidence) > 1e-9 or raw[choice] != max(raw.values())):
        raise ContractError("backend_malformed")
    return MappingProxyType({label: float(raw[label]) for label in LABELS})


def validate_usage(tokens: object, truncated: object) -> None:
    if type(tokens) is not int or not 1 <= tokens <= 512 or truncated is not False:
        raise ContractError("backend_usage_unverified")


def model_outcome(candidate: str, confidence: float, policy: RoutePolicy) -> tuple[str, str]:
    if candidate == "unknown_mixed":
        return "abstained", "model_unknown"
    if confidence < policy.confidence_threshold:
        return "abstained", "model_low_confidence"
    return "accepted", "model_accepted"


@dataclass(frozen=True)
class RouteResult:
    status: str
    reason_code: str
    candidate: str | None
    recommended_domain: str | None
    source: str
    input_hash: str | None
    source_commit: str | None
    rules_hash: str
    policy_hash: str
    advisory: bool = True
    probabilities: Mapping[str, float] | None = None
    answer_confidence: float | None = None
    final_input_tokens: int | None = None
    truncated: bool | None = None
    calibration_status: str = "not_evaluated"
    checkpoint_hash: str | None = None
    measurement_hash: str | None = None

    def to_dict(self) -> dict:
        return {field.name: dict(self.probabilities) if field.name == "probabilities"
                and self.probabilities is not None else getattr(self, field.name) for field in fields(self)}


def validate_result(raw: object, policy: RoutePolicy) -> RouteResult:
    """Validate normalized results, including cross-field semantic invariants."""
    from .baseline import RulesPolicy
    raw = exact_fields(raw, frozenset(field.name for field in fields(RouteResult)), "result_fields")
    if (raw["advisory"] is not True or type(raw["status"]) is not str
            or raw["status"] not in ("accepted", "abstained", "invalid")
            or type(raw["source"]) is not str or raw["source"] not in ("rules", "model", "none")
            or type(raw["reason_code"]) is not str
            or (raw["candidate"] is not None and (type(raw["candidate"]) is not str or raw["candidate"] not in LABELS))
            or raw["calibration_status"] != policy.calibration_status
            or raw["checkpoint_hash"] is not None or raw["measurement_hash"] is not None
            or raw["rules_hash"] != RulesPolicy().rules_hash or raw["policy_hash"] != policy.policy_hash):
        raise ContractError("result_invalid")
    invalid = raw["status"] == "invalid"
    if invalid:
        if raw["input_hash"] is not None or raw["source_commit"] is not None:
            raise ContractError("result_provenance")
    elif not hex_hash(raw["input_hash"], 64) or not hex_hash(raw["source_commit"], 40):
        raise ContractError("result_provenance")
    candidate, status, reason, source = (raw[key] for key in ("candidate", "status", "reason_code", "source"))
    recommended = candidate if status == "accepted" and candidate in DOMAINS else None
    if raw["recommended_domain"] != recommended or (status == "accepted" and recommended is None):
        raise ContractError("result_recommendation")
    probabilities = None
    if source == "model":
        if not policy.model_enabled or invalid:
            raise ContractError("result_invalid")
        probabilities = validate_probabilities(raw["probabilities"], candidate, raw["answer_confidence"])
        validate_usage(raw["final_input_tokens"], raw["truncated"])
        if (status, reason) != model_outcome(candidate, raw["answer_confidence"], policy):
            raise ContractError("result_invalid")
    else:
        if any(raw[key] is not None for key in ("probabilities", "answer_confidence", "final_input_tokens", "truncated")):
            raise ContractError("result_invalid")
        if source == "rules":
            valid = status == "accepted" and reason == "rules_clear" and candidate in DOMAINS
        elif invalid:
            valid = reason in REQUEST_ERRORS and candidate is None
        elif reason == "model_disabled":
            valid = status == "abstained" and candidate == "unknown_mixed" and not policy.model_enabled
        else:
            valid = status == "abstained" and reason in TECHNICAL_REASONS and candidate is None
        if not valid:
            raise ContractError("result_invalid")
    return RouteResult(**{**raw, "probabilities": probabilities})
