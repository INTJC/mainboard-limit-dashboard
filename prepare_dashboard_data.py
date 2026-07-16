#!/usr/bin/env python3
"""将触板事件 CSV 转换为网页使用的紧凑 JSON。"""

from __future__ import annotations

import csv
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parent / "limit_up_output" / "all_limit_up_events.csv"
OUTPUT = ROOT / "public" / "data" / "events.json"

TEXT_FIELDS = [
    "date",
    "code",
    "board",
    "classification",
    "first_touch_time",
    "last_touch_time",
    "first_close_at_limit_time",
    "reference_source",
    "reference_quality",
]
NUMBER_FIELDS = [
    "reference_close",
    "limit_price",
    "daily_open",
    "daily_high",
    "daily_low",
    "daily_close",
    "touch_minutes",
    "close_at_limit_minutes",
    "total_volume",
    "total_amount",
]


def number(value: str):
    if value == "":
        return None
    parsed = float(value)
    return int(parsed) if parsed.is_integer() else parsed


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(f"找不到触板事件文件：{SOURCE}")

    fields = TEXT_FIELDS + NUMBER_FIELDS
    events = []
    with SOURCE.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            text_values = [row.get(field, "") for field in TEXT_FIELDS]
            number_values = [number(row.get(field, "")) for field in NUMBER_FIELDS]
            events.append(text_values + number_values)

    date_index = fields.index("date")
    dates = sorted({event[date_index] for event in events})
    payload = {
        "generated_from": str(SOURCE.name),
        "event_count": len(events),
        "dates": dates,
        "fields": fields,
        "events": events,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"已生成 {OUTPUT}：{len(events):,} 条事件，{len(dates)} 个交易日")


if __name__ == "__main__":
    main()
