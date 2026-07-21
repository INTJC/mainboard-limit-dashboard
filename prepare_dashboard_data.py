#!/usr/bin/env python3
"""Convert the locally screened event table into dashboard assets.

The current screening output is based on 15-minute bars. When an existing
dashboard payload is supplied, this script preserves its minute-level event
timestamps and touch counts for unchanged date/code pairs, while treating the
local screened table as the source of truth for membership and classification.
"""

from __future__ import annotations

import argparse
import base64
import csv
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any

import pyarrow.parquet as pq


ROOT = Path(__file__).resolve().parent
BOARD_ORDER = ["沪市主板", "深市主板", "创业板", "科创板", "北交所"]
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
MINUTE_COLUMNS = ["code", "trade_time", "open", "high", "low", "close", "vol", "amount"]
VOLUME_UNIT = 100
AMOUNT_UNIT = 1_000


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成观察台事件索引和分钟行情分片")
    parser.add_argument(
        "--source",
        type=Path,
        default=ROOT.parent / "limit_up_output" / "all_limit_up_events.csv",
        help="本地筛选后的事件 CSV",
    )
    parser.add_argument(
        "--existing-events",
        type=Path,
        help="可选的旧 events.json，用于保留未变化事件的精确分钟字段",
    )
    parser.add_argument(
        "--data-root",
        type=Path,
        default=ROOT.parent / "data",
        help="按年份保存行情 Parquet 的根目录",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "public" / "data" / "events.json",
    )
    parser.add_argument(
        "--minute-output",
        type=Path,
        default=ROOT / "public" / "data" / "minutes",
    )
    parser.add_argument(
        "--event-shard-output",
        type=Path,
        default=ROOT / "public" / "data" / "events",
        help="按月拆分的事件数据目录",
    )
    return parser.parse_args()


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.lower() == "nan" else text


def clean_number(value: Any) -> int | float | None:
    text = clean_text(value)
    if not text:
        return None
    parsed = float(text)
    if not math.isfinite(parsed):
        return None
    return int(parsed) if parsed.is_integer() else parsed


def load_existing(
    path: Path | None,
) -> tuple[
    dict[tuple[str, str], dict[str, Any]],
    dict[str, set[str]],
]:
    if path is None or not path.exists():
        return {}, {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    fields = payload["fields"]
    records = {
        (str(record["date"]), str(record["code"]).upper()): record
        for values in payload["events"]
        for record in [dict(zip(fields, values))]
    }
    codes: dict[str, set[str]] = defaultdict(set)
    for date, code in records:
        codes[date].add(code)
    return records, codes


def first_present(row: dict[str, str], old: dict[str, Any], *names: str) -> str:
    for name in names:
        value = clean_text(row.get(name, ""))
        if value:
            return value
        value = clean_text(old.get(name, ""))
        if value:
            return value
    return ""


def build_events(
    source: Path,
    existing: dict[tuple[str, str], dict[str, Any]],
) -> tuple[list[list[Any]], dict[str, set[str]], int]:
    events: list[list[Any]] = []
    event_codes: dict[str, set[str]] = defaultdict(set)
    fallback_count = 0
    with source.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            date = clean_text(row["date"])
            code = clean_text(row["code"]).upper()
            old = existing.get((date, code), {})
            has_precise_source = bool(clean_text(row.get("first_touch_time", "")))
            has_precise_old = bool(clean_text(old.get("first_touch_time", "")))
            if not has_precise_source and not has_precise_old:
                fallback_count += 1

            record: dict[str, Any] = {
                "date": date,
                "code": code,
                "board": clean_text(row["board"]),
                "classification": clean_text(row["classification"]),
                "first_touch_time": first_present(
                    row, old, "first_touch_time", "first_touch_bar_time"
                ),
                "last_touch_time": first_present(
                    row, old, "last_touch_time", "last_touch_bar_time"
                ),
                "first_close_at_limit_time": first_present(
                    row,
                    old,
                    "first_close_at_limit_time",
                    "first_close_at_limit_bar_time",
                ),
                "reference_source": clean_text(row.get("reference_source", "")),
                "reference_quality": clean_text(row.get("reference_quality", "")),
            }
            for field in [
                "reference_close",
                "limit_price",
                "daily_open",
                "daily_high",
                "daily_low",
                "daily_close",
                "total_volume",
                "total_amount",
            ]:
                record[field] = clean_number(row.get(field, ""))

            record["touch_minutes"] = clean_number(row.get("touch_minutes", ""))
            if record["touch_minutes"] is None:
                record["touch_minutes"] = clean_number(old.get("touch_minutes"))
            if record["touch_minutes"] is None:
                record["touch_minutes"] = clean_number(row.get("touch_bar_count", ""))

            record["close_at_limit_minutes"] = clean_number(
                row.get("close_at_limit_minutes", "")
            )
            if record["close_at_limit_minutes"] is None:
                record["close_at_limit_minutes"] = clean_number(
                    old.get("close_at_limit_minutes")
                )
            if record["close_at_limit_minutes"] is None:
                record["close_at_limit_minutes"] = clean_number(
                    row.get("close_at_limit_bar_count", "")
                )

            events.append([record[field] for field in TEXT_FIELDS + NUMBER_FIELDS])
            event_codes[date].add(code)
    return events, event_codes, fallback_count


def minute_label(value: Any) -> str:
    text = str(value)
    return text[11:16] if len(text) >= 16 else text[:5]


def append_unsigned(target: bytearray, value: int) -> None:
    value = max(0, int(value))
    while value >= 0x80:
        target.append((value & 0x7F) | 0x80)
        value //= 0x80
    target.append(value)


def append_signed(target: bytearray, value: int) -> None:
    append_unsigned(target, value * 2 if value >= 0 else (-value * 2) - 1)


def minute_index(value: Any) -> int:
    label = minute_label(value)
    return int(label[:2]) * 60 + int(label[3:5])


def write_minute_payloads(
    data_root: Path,
    output_dir: Path,
    event_codes: dict[str, set[str]],
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for date, codes in sorted(event_codes.items()):
        source_path = data_root / date[:4] / f"{date}.parquet"
        table = pq.read_table(
            source_path,
            columns=MINUTE_COLUMNS,
            filters=[("code", "in", sorted(codes))],
            use_threads=True,
        )
        frame = table.to_pandas()
        frame["code"] = frame["code"].astype(str).str.upper()
        frame = frame[frame["code"].isin(codes)].sort_values(
            ["code", "trade_time"], kind="stable"
        )
        groups = list(frame.groupby("code", sort=True, observed=True))
        present = {code for code, _ in groups}
        if missing := sorted(codes - present):
            raise ValueError(f"{date} 缺少事件股票行情：{missing}")

        payload = bytearray(b"LUP2")
        append_unsigned(payload, len(groups))
        for code, stock_frame in groups:
            code_bytes = code.encode("ascii")
            payload.append(len(code_bytes))
            payload.extend(code_bytes)
            append_unsigned(payload, len(stock_frame))
            previous_minute = 0
            previous_close = 0
            for row in stock_frame.itertuples(index=False):
                current_minute = minute_index(row.trade_time)
                open_price = round(float(row.open) * 100)
                high_price = round(float(row.high) * 100)
                low_price = round(float(row.low) * 100)
                close_price = round(float(row.close) * 100)
                append_unsigned(payload, current_minute - previous_minute)
                append_signed(payload, open_price - previous_close)
                append_signed(payload, high_price - open_price)
                append_signed(payload, low_price - open_price)
                append_signed(payload, close_price - open_price)
                append_unsigned(payload, round(float(row.vol) / VOLUME_UNIT))
                append_unsigned(payload, round(float(row.amount) / AMOUNT_UNIT))
                previous_minute = current_minute
                previous_close = close_price
        (output_dir / f"{date}.bin").write_bytes(payload)


def main() -> None:
    args = parse_args()
    existing, existing_codes = load_existing(args.existing_events)
    events, event_codes, fallback_count = build_events(args.source, existing)
    fields = TEXT_FIELDS + NUMBER_FIELDS
    dates = sorted(event_codes)
    board_index = fields.index("board")
    observed_boards = {event[board_index] for event in events}
    boards = [board for board in BOARD_ORDER if board in observed_boards]
    boards.extend(sorted(observed_boards - set(boards)))
    args.event_shard_output.mkdir(parents=True, exist_ok=True)
    date_index = fields.index("date")
    half_month_events: dict[str, list[list[Any]]] = defaultdict(list)
    for event in events:
        date = str(event[date_index])
        half = "1" if int(date[6:8]) <= 15 else "2"
        half_month_events[f"{date[:6]}-{half}"].append(event)
    shards = []
    expected_shard_files = set()
    for period, period_events in sorted(half_month_events.items()):
        filename = f"{period}.json"
        expected_shard_files.add(filename)
        (args.event_shard_output / filename).write_text(
            json.dumps(period_events, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        shards.append(
            {
                "path": f"data/events/{filename}",
                "event_count": len(period_events),
            }
        )
    for stale_path in args.event_shard_output.glob("*.json"):
        if stale_path.name not in expected_shard_files:
            stale_path.unlink()

    base64_minute_dates = sorted(
        date
        for date, codes in event_codes.items()
        if codes - existing_codes.get(date, set())
    )
    payload = {
        "generated_from": args.source.name,
        "event_count": len(events),
        "dates": dates,
        "boards": boards,
        "fields": fields,
        "shards": shards,
        "base64_minute_dates": base64_minute_dates,
        "minute_precision_fallback_count": fallback_count,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    write_minute_payloads(args.data_root, args.minute_output, event_codes)
    base64_dir = args.minute_output.parent / "minutes-base64"
    base64_dir.mkdir(parents=True, exist_ok=True)
    expected_base64_files = {f"{date}.txt" for date in base64_minute_dates}
    for date in base64_minute_dates:
        encoded = base64.b64encode((args.minute_output / f"{date}.bin").read_bytes())
        (base64_dir / f"{date}.txt").write_bytes(encoded)
    for stale_path in base64_dir.glob("*.txt"):
        if stale_path.name not in expected_base64_files:
            stale_path.unlink()
    print(
        f"生成 {len(events):,} 条事件、{len(dates)} 个交易日；"
        f"新增事件中有 {fallback_count:,} 条使用 15 分钟时间标签。"
    )


if __name__ == "__main__":
    main()
