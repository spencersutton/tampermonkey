"""Item identity shared by history matching and persisted item-type labels."""

from collections import defaultdict
from collections.abc import Iterable
from typing import Any


def brand_model_key(item: dict[str, Any]) -> tuple[str, str] | None:
    brand = " ".join((item.get("brand") or "").lower().split())
    model = " ".join((item.get("model") or "").lower().split())
    return (brand, model) if brand and model else None


class ItemTypeIndex:
    """Prefer known identities; use exact titles if either side lacks an identity."""

    def __init__(self, records: Iterable[dict[str, Any]]) -> None:
        self.by_identity: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
        self.by_title: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for record in records:
            if identity := brand_model_key(record):
                self.by_identity[identity].append(record)
            self.by_title[record["title"]].append(record)

    def match(self, item: dict[str, Any]) -> dict[str, Any] | None:
        identity = brand_model_key(item)
        candidates = [record for record in self.by_title.get(item["title"], ()) if not identity or not brand_model_key(record)]
        if identity:
            candidates.extend(self.by_identity.get(identity, ()))

        # Manual edits supersede earlier edits; automatic labels prefer complete identities.
        def priority(r: dict[str, Any]) -> tuple[Any, ...]:
            return (
                r["manual"],
                r["at"] if r["manual"] else 0,
                bool(identity and brand_model_key(r) == identity),
                r["at"],
                r["title"],
                r["type"],
            )

        return max(candidates, key=priority, default=None)
