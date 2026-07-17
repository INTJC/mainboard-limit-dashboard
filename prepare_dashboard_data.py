#!/usr/bin/env python3
"""将触板事件和对应分钟行情转换为网页使用的紧凑 JSON。"""

from __future__ import annotations

import csv
import json
from collections import defaultdict
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
BOARD_ORDER = ["沪市主板", "深市主板", "创业板", "科创板", "北交所"]
VOLUME_UNIT = 100
AMOUNT_UNIT = 1_000


def number(value: str):
    if value == "":
        return None
    parsed = float(value)
    return int(parsed) if parsed.is_integer() else parsed


def minute_label(value) -> str:
    text = str(value)
    if len(text) >= 16:
        return text[11:16]
    return text[:5]


def append_unsigned(target: bytearray, value: int) -> None:
    """写入 JavaScript 可安全解码的无符号 varint。"""
    value = max(0, int(value))
    while value >= 0x80:
        target.append((value & 0x7F) | 0x80)
        value //= 0x80
    target.append(value)


def append_signed(target: bytearray, value: int) -> None:
    """使用 ZigZag 编码写入有符号整数。"""
    encoded = value * 2 if value >= 0 else (-value * 2) - 1
    append_unsigned(target, encoded)


def minute_index(value) -> int:
    label = minute_label(value)
    return int(label[:2]) * 60 + int(label[3:5])


def price_cents(value) -> int:
    return int(round(float(value) * 100))


def scaled_nonnegative(value, unit: int) -> int:
    parsed = float(value)
    return max(0, int(round(parsed / unit)))


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

        stock_groups = list(frame.groupby("code", sort=True, observed=True))
        payload = bytearray(b"LUP2")
        append_unsigned(payload, len(stock_groups))
        present_codes = set()
        for code, stock_frame in stock_groups:
            code_bytes = code.encode("ascii")
            if len(code_bytes) > 255:
                raise ValueError(f"股票代码过长，无法编码：{code}")
            payload.append(len(code_bytes))
            payload.extend(code_bytes)
            append_unsigned(payload, len(stock_frame))
            previous_minute = 0
            previous_close = 0
            for row in stock_frame.itertuples(index=False):
                current_minute = minute_index(row.trade_time)
                open_price = price_cents(row.open)
                high_price = price_cents(row.high)
                low_price = price_cents(row.low)
                close_price = price_cents(row.close)
                append_unsigned(payload, current_minute - previous_minute)
                append_signed(payload, open_price - previous_close)
                append_signed(payload, high_price - open_price)
                append_signed(payload, low_price - open_price)
                append_signed(payload, close_price - open_price)
                append_unsigned(payload, scaled_nonnegative(row.vol, VOLUME_UNIT))
                append_unsigned(payload, scaled_nonnegative(row.amount, AMOUNT_UNIT))
                previous_minute = current_minute
                previous_close = close_price
            present_codes.add(code)
            total_points += len(stock_frame)

        missing_codes = sorted(codes - present_codes)
        if missing_codes:
            raise ValueError(f"{date} 缺少触板股票分钟行情：{missing_codes}")

        (MINUTE_OUTPUT / f"{date}.bin").write_bytes(payload)
        total_stocks += len(stock_groups)

    expected_files = {f"{date}.bin" for date in event_codes}
    for stale_path in MINUTE_OUTPUT.iterdir():
        if stale_path.suffix not in {".json", ".bin"}:
            continue
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
    board_index = fields.index("board")
    dates = sorted({event[date_index] for event in events})
    observed_boards = {event[board_index] for event in events}
    boards = [board for board in BOARD_ORDER if board in observed_boards]
    boards.extend(sorted(observed_boards - set(boards)))
    payload = {
        "generated_from": str(SOURCE.name),
        "event_count": len(events),
        "dates": dates,
        "boards": boards,
        "fields": fields,
        "events": events,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        f"已生成 {OUTPUT}：{len(events):,} 条事件，{len(dates)} 个交易日，"
        f"{len(boards)} 个板块"
    )
    write_minute_payloads(event_codes)


if __name__ == "__main__":
    main()
