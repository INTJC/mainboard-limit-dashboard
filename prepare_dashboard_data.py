#!/usr/bin/env python3
"""将触板事件和对应分钟行情转换为网页使用的紧凑 JSON。"""

from __future__ import annotations

import csv
import json
from collections import defaultdict
from math import isfinite
from pathlib import Path

import pyarrow.parquet as pq


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parent / "limit_up_output" / "all_limit_up_events.csv"
OUTPUT = ROOT / "public" / "data" / "events.json"
DATA_ROOT = ROOT.parent
MINUTE_OUTPUT = ROOT / "public" / "data" / "minutes"

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
MINUTE_FIELDS = ["time", "open", "high", "low", "close", "volume", "amount"]


def number(value: str):
    if value == "":
        return None
    parsed = float(value)
    return int(parsed) if parsed.is_integer() else parsed


def compact_number(value, *, price: bool = False):
    """把 Arrow/Pandas 标量转换成紧凑且可被 JSON 正确表示的数字。"""
    if value is None:
        return None
    parsed = float(value)
    if not isfinite(parsed):
        return None
    if price:
        return round(parsed, 2)
    return int(parsed) if parsed.is_integer() else round(parsed, 4)


def minute_label(value) -> str:
    text = str(value)
    if len(text) >= 16:
        return text[11:16]
    return text[:5]


def write_minute_payloads(event_codes: dict[str, set[str]]) -> None:
    """按交易日切分触板股票分钟行情，前端只加载当前日期文件。"""
    MINUTE_OUTPUT.mkdir(parents=True, exist_ok=True)
    total_stocks = 0
    total_points = 0

    for date, codes in sorted(event_codes.items()):
        source_path = DATA_ROOT / date[:4] / f"{date}.parquet"
        if not source_path.exists():
            raise FileNotFoundError(f"找不到 {date} 的分钟行情：{source_path}")

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

        stocks = []
        for code, stock_frame in frame.groupby("code", sort=True, observed=True):
            points = [
                [
                    minute_label(row.trade_time),
                    compact_number(row.open, price=True),
                    compact_number(row.high, price=True),
                    compact_number(row.low, price=True),
                    compact_number(row.close, price=True),
                    compact_number(row.vol),
                    compact_number(row.amount),
                ]
                for row in stock_frame.itertuples(index=False)
            ]
            stocks.append([code, points])
            total_points += len(points)

        missing_codes = sorted(codes - {stock[0] for stock in stocks})
        if missing_codes:
            raise ValueError(f"{date} 缺少触板股票分钟行情：{missing_codes}")

        payload = {
            "date": date,
            "point_fields": MINUTE_FIELDS,
            "stock_count": len(stocks),
            "stocks": stocks,
        }
        (MINUTE_OUTPUT / f"{date}.json").write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        total_stocks += len(stocks)

    expected_files = {f"{date}.json" for date in event_codes}
    for stale_path in MINUTE_OUTPUT.glob("*.json"):
        if stale_path.name not in expected_files:
            stale_path.unlink()

    print(
        f"已生成 {len(event_codes)} 个分钟行情分片："
        f"{total_stocks:,} 只股票，{total_points:,} 条分钟记录"
    )


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(f"找不到触板事件文件：{SOURCE}")

    fields = TEXT_FIELDS + NUMBER_FIELDS
    events = []
    event_codes: dict[str, set[str]] = defaultdict(set)
    with SOURCE.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            text_values = [row.get(field, "") for field in TEXT_FIELDS]
            number_values = [number(row.get(field, "")) for field in NUMBER_FIELDS]
            events.append(text_values + number_values)
            event_codes[row["date"]].add(row["code"].upper())

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
    write_minute_payloads(event_codes)


if __name__ == "__main__":
    main()
