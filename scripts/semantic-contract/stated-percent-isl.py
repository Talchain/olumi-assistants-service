"""Read the actual PLoT payload with the pinned ISL validator and science consumer.

No HTTP, database or deployed-service claim is made by this adapter fixture.
Run only through stated-percent.ts, which verifies the supplied source heads.
"""

import json
import sys

sys.path.insert(0, sys.argv[1])

from src.models.robustness_v2 import RobustnessRequestV2  # noqa: E402
from src.services.robustness_analyzer_v2 import (  # noqa: E402
    FactorSampler,
    RobustnessAnalyzerV2,
    resolve_factor_central_value,
)
from src.utils.rng import SeededRNG  # noqa: E402

payload = json.load(sys.stdin)
request = RobustnessRequestV2.model_validate(payload["request"])
target_id = payload["target_id"]
nodes = {node.id: node for node in request.graph.nodes}
uncertainties = {item.node_id: item for item in request.parameter_uncertainties or []}
target = nodes[target_id]
uncertainty = uncertainties.get(target_id)
central = resolve_factor_central_value(target, uncertainty)
sampler = FactorSampler(request.graph.nodes, request.parameter_uncertainties, SeededRNG(41))
draws = [sampler.sample_factor_values()[target_id] for _ in range(4096)]
result = {
    "id": target.id,
    "observed_state": target.observed_state.model_dump(exclude_none=True),
    "central_value": central.value,
    "central_source": central.source,
    "sample_mean": sum(draws) / len(draws),
    "sample_count": len(draws),
    "parameter_uncertainty": uncertainty.model_dump(exclude_none=True) if uncertainty else None,
}
if payload.get("complete_analysis"):
    response = RobustnessAnalyzerV2().analyze(request)
    result["analysis_response"] = response.model_dump(mode="json", exclude_none=True)
print(json.dumps(result))
