#!/usr/bin/env python3
"""在既有观察台事件样本上补充分钟级封板路径分类。

分类口径：
- 封板 / 未开板封住：收盘封板，首次分钟收盘封板后没有后续分钟最低价低于涨停价。
- 封板 / 开板后回封：收盘封板，首次分钟收盘封板后有后续分钟最低价低于涨停价。
- 开板 / 封板后开板：收盘未封板，但盘中至少有一分钟收盘封板。
- 开板 / 触板未封：收盘未封板，盘中没有一分钟收盘封板。

分钟 OHLC 无法判断同一分钟内部的成交先后，因此只使用首次收盘封板后的后续分钟
判断“中途开板”，避免对同一分钟的价格路径作过度推断。
"""

from __future__ import annotations

import argparse
import base64
import json
from collections import Counter, defaultdict
from pathlib import Path

import pyarrow.parquet as pq


PATH_FIELD = "path_classification"
NEVER_OPENED = "未开板封住"
RESEALED = "开板后回封"
SEALED_THEN_OPENED = "封板后开板"
TOUCHED_NOT_SEALED = "触板未封"
PATH_LABELS = [NEVER_OPENED, RESEALED, SEALED_THEN_OPENED, TOUCHED_NOT_SEALED]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--shard-dir", type=Path, required=True)
    parser.add_argument("--minute-root", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    return parser.parse_args()


def read_events(manifest: dict, shard_dir: Path) -> list[dict]:
    fields = manifest["fields"]
    events: list[dict] = []
    for shard in manifest["shards"]:
        source = shard_dir / Path(shard["path"]).name
        rows = json.loads(source.read_text(encoding="utf-8"))
        if len(rows) != shard["event_count"]:
            raise ValueError(f"{source} 的事件数与清单不一致")
        events.extend(dict(zip(fields, row, strict=True)) for row in rows)
    if len(events) != manifest["event_count"]:
        raise ValueError("事件总数与清单不一致")
    return events


def classify_paths(events: list[dict], minute_root: Path) -> Counter:
    by_date: dict[str, list[dict]] = defaultdict(list)
    for event in events:
        by_date[event["date"]].append(event)

    counts: Counter = Counter()
    for position, (date, day_events) in enumerate(sorted(by_date.items()), start=1):
        sealed_events = {
            event["code"]: event
            for event in day_events
            if event["classification"] == "封板"
        }
        for event in day_events:
            if event["classification"] == "开板":
                path = (
                    SEALED_THEN_OPENED
                    if str(event.get("first_close_at_limit_time") or "").strip()
                    else TOUCHED_NOT_SEALED
                )
                event[PATH_FIELD] = path
                counts[path] += 1

        if sealed_events:
            source = minute_root / date[:4] / f"{date}.parquet"
            if not source.exists():
                raise FileNotFoundError(f"缺少分钟数据：{source}")
            table = pq.read_table(
                source,
                columns=["code", "trade_time", "low"],
                filters=[("code", "in", sorted(sealed_events))],
                use_threads=True,
            )
            frame = table.to_pandas()
            frame["code"] = frame["code"].astype(str).str.upper()
            frame["trade_time"] = frame["trade_time"].astype(str)
            minute_by_code = {
                code: stock_frame
                for code, stock_frame in frame.groupby("code", sort=False, observed=True)
            }
            for code, event in sealed_events.items():
                first_sealed = str(event.get("first_close_at_limit_time") or "")
                if not first_sealed:
                    raise ValueError(f"{date} {code} 收盘封板但缺少首次封板分钟")
                stock_frame = minute_by_code.get(code)
                if stock_frame is None:
                    raise ValueError(f"{date} {code} 缺少分钟行情")
                later = stock_frame[stock_frame["trade_time"] > first_sealed]
                limit_cents = round(float(event["limit_price"]) * 100)
                opened_after_seal = (
                    (later["low"].astype(float).mul(100).round() < limit_cents).any()
                )
                path = RESEALED if opened_after_seal else NEVER_OPENED
                event[PATH_FIELD] = path
                counts[path] += 1

        if position % 50 == 0 or position == len(by_date):
            print(f"已处理 {position}/{len(by_date)} 个交易日", flush=True)

    missing = [event for event in events if PATH_FIELD not in event]
    if missing:
        raise ValueError(f"仍有 {len(missing)} 条事件未分类")
    return counts


def write_payload(
    manifest: dict,
    events: list[dict],
    output_root: Path,
) -> None:
    label_index = {label: index for index, label in enumerate(PATH_LABELS)}
    packed = bytearray((len(events) + 3) // 4)
    for event_index, event in enumerate(events):
        packed[event_index // 4] |= (
            label_index[event[PATH_FIELD]] << ((event_index % 4) * 2)
        )

    enriched_manifest = {
        **manifest,
        "path_labels": PATH_LABELS,
        "path_codes": base64.b64encode(packed).decode("ascii"),
        "path_classification": {
            "encoding": "每条事件2位，按事件分片顺序每字节打包4条",
            "minute_rule": "首次收盘封板后的后续分钟最低价低于涨停价，判定为曾开板",
            "same_minute_sequence": "分钟OHLC无法判断同一分钟内部先后，不计入中途开板",
        },
    }
    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / "events.json").write_text(
        json.dumps(enriched_manifest, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def main() -> None:
    args = parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    events = read_events(manifest, args.shard_dir)
    counts = classify_paths(events, args.minute_root)
    write_payload(manifest, events, args.output_root)
    print("四分类统计：")
    for label in [NEVER_OPENED, RESEALED, SEALED_THEN_OPENED, TOUCHED_NOT_SEALED]:
        print(f"  {label}: {counts[label]:,}")
    print(f"  合计: {sum(counts.values()):,}")


if __name__ == "__main__":
    main()
