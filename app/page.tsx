"use client";

import { type CSSProperties, useEffect, useMemo, useState } from "react";

type Classification = "封板" | "开板";
type PathClassification =
  | "未开板封住"
  | "开板后回封"
  | "封板后开板"
  | "触板未封";
type BoardFilter = "全部板块" | string;

type LimitEvent = {
  date: string;
  code: string;
  board: string;
  classification: Classification;
  path_classification: PathClassification;
  first_touch_time: string;
  last_touch_time: string;
  first_close_at_limit_time: string;
  reference_source: string;
  reference_quality: string;
  reference_close: number;
  limit_price: number;
  daily_open: number;
  daily_high: number;
  daily_low: number;
  daily_close: number;
  touch_minutes: number;
  close_at_limit_minutes: number | null;
  total_volume: number;
  total_amount: number;
};

type CompactPayload = {
  event_count: number;
  dates: string[];
  boards: string[];
  fields: (keyof LimitEvent)[];
  events?: Array<Array<string | number | null>>;
  shards?: Array<{ path: string; event_count: number }>;
  base64_minute_dates?: string[];
  path_labels?: PathClassification[];
  path_codes?: string;
};

type MinutePoint = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
};

const PAGE_SIZE = 18;
const DATA_BASE =
  process.env.NEXT_PUBLIC_DATA_BASE ??
  "https://intjc.github.io/mainboard-limit-dashboard";
const SEALED = "#2f6ea3";
const OPENED = "#e0785c";
const NEVER_OPENED = "#2f6ea3";
const RESEALED = "#83b5d5";
const SEALED_THEN_OPENED = "#d7684b";
const TOUCHED_NOT_SEALED = "#efb3a3";
const TRADING_MINUTES = 242;
const BOARD_LIMIT_RATE: Record<string, string> = {
  沪市主板: "10%",
  深市主板: "10%",
  创业板: "20%",
  科创板: "20%",
  北交所: "30%",
};

function inflatePayload(payload: CompactPayload): LimitEvent[] {
  const pathBytes = payload.path_codes
    ? Uint8Array.from(atob(payload.path_codes), (character) => character.charCodeAt(0))
    : new Uint8Array();
  const pathLabels = payload.path_labels ?? [];
  return (payload.events ?? []).map((values, eventIndex) => {
    const record = Object.fromEntries(
      payload.fields.map((field, index) => [field, values[index]]),
    ) as LimitEvent;
    if (!record.path_classification) {
      const packedCode =
        pathBytes.length > (eventIndex >> 2)
          ? (pathBytes[eventIndex >> 2] >> ((eventIndex & 3) * 2)) & 3
          : -1;
      record.path_classification =
        pathLabels[packedCode] ??
        (record.classification === "封板"
          ? "未开板封住"
          : record.first_close_at_limit_time
            ? "封板后开板"
            : "触板未封");
    }
    return record;
  });
}

function inflateMinutePayload(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder();
  let offset = 0;

  const readByte = () => bytes[offset++];
  const readUnsigned = () => {
    let value = 0;
    let multiplier = 1;
    while (offset < bytes.length) {
      const byte = readByte();
      value += (byte & 0x7f) * multiplier;
      if ((byte & 0x80) === 0) return value;
      multiplier *= 128;
    }
    throw new Error("分钟行情文件不完整");
  };
  const readSigned = () => {
    const value = readUnsigned();
    return value % 2 === 0 ? value / 2 : -((value + 1) / 2);
  };
  const magic = decoder.decode(bytes.subarray(0, 4));
  if (magic !== "LUP2") throw new Error("分钟行情文件格式不受支持");
  offset = 4;

  const stocks = new Map<string, MinutePoint[]>();
  const stockCount = readUnsigned();
  for (let stockIndex = 0; stockIndex < stockCount; stockIndex += 1) {
    const codeLength = readByte();
    const code = decoder.decode(bytes.subarray(offset, offset + codeLength));
    offset += codeLength;
    const pointCount = readUnsigned();
    const points: MinutePoint[] = [];
    let absoluteMinute = 0;
    let previousClose = 0;
    for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
      absoluteMinute += readUnsigned();
      const open = previousClose + readSigned();
      const high = open + readSigned();
      const low = open + readSigned();
      const close = open + readSigned();
      const volume = readUnsigned() * 100;
      const amount = readUnsigned() * 1000;
      points.push({
        time: `${String(Math.floor(absoluteMinute / 60)).padStart(2, "0")}:${String(absoluteMinute % 60).padStart(2, "0")}`,
        open: open / 100,
        high: high / 100,
        low: low / 100,
        close: close / 100,
        volume,
        amount,
      });
      previousClose = close;
    }
    stocks.set(code, points);
  }
  return stocks;
}

function decodeBase64Buffer(encoded: string) {
  const binary = atob(encoded.trim());
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function dateInputValue(date: string) {
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

function compactDate(value: string) {
  return value.replaceAll("-", "");
}

function displayDate(date: string) {
  const parsed = new Date(`${dateInputValue(date)}T00:00:00+08:00`);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "Asia/Shanghai",
  }).format(parsed);
}

function timeOnly(timestamp: string) {
  return timestamp ? timestamp.slice(11, 16) : "—";
}

function formatPrice(value: number | null) {
  return value == null ? "—" : value.toFixed(2);
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

function timeIndex(timestamp: string) {
  const hour = Number(timestamp.slice(11, 13));
  const minute = Number(timestamp.slice(14, 16));
  const absolute = hour * 60 + minute;
  return absolute < 13 * 60 ? absolute - 570 : 121 + (absolute - 780);
}

function minuteTimeIndex(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  const absolute = hour * 60 + minute;
  return absolute < 13 * 60 ? absolute - 570 : 121 + (absolute - 780);
}

function buildCumulative(events: LimitEvent[], type: Classification) {
  const increments = Array.from({ length: TRADING_MINUTES }, () => 0);
  for (const event of events) {
    if (event.classification !== type) continue;
    const index = Math.max(0, Math.min(241, timeIndex(event.first_touch_time)));
    increments[index] += 1;
  }
  let running = 0;
  return increments.map((increment) => {
    running += increment;
    return running;
  });
}

function tradingMinuteLabel(index: number) {
  const absolute = index <= 120 ? 570 + index : 780 + index - 121;
  return `${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

function trailingAverage(values: number[], windowLength: number) {
  const prefixSums = [0];
  for (const value of values) {
    prefixSums.push(prefixSums[prefixSums.length - 1] + value);
  }
  return values.map((_, index) => {
    const start = Math.max(0, index - windowLength + 1);
    const sum = Math.max(0, prefixSums[index + 1] - prefixSums[start]);
    return sum / (index - start + 1);
  });
}

function sealedShare(sealed: number, opened: number) {
  const total = sealed + opened;
  if (total <= Number.EPSILON) return null;
  return Math.min(1, Math.max(0, sealed / total));
}

type RangeObservation = {
  sealed: number[];
  opened: number[];
  sealedRate: Array<number | null>;
  openedRate: Array<number | null>;
  neverOpened: number[];
  resealed: number[];
  sealedThenOpened: number[];
  touchedNotSealed: number[];
  neverOpenedRate: Array<number | null>;
  resealedRate: Array<number | null>;
  sealedThenOpenedRate: Array<number | null>;
  touchedNotSealedRate: Array<number | null>;
  averageDailySealed: number;
  averageDailyOpened: number;
  averageMinuteSealed: number;
  averageMinuteOpened: number;
  overallSealedRate: number;
  overallOpenedRate: number;
  neverOpenedCount: number;
  resealedCount: number;
  sealedThenOpenedCount: number;
  touchedNotSealedCount: number;
  overallNeverOpenedRate: number;
  overallResealedRate: number;
  overallSealedThenOpenedRate: number;
  overallTouchedNotSealedRate: number;
  eventCount: number;
  tradingDayCount: number;
};

function buildRangeObservation(
  events: LimitEvent[],
  rangeDates: string[],
  selectedBoards: string[],
  windowLength: number,
): RangeObservation {
  const dateSet = new Set(rangeDates);
  const boardSet = new Set(selectedBoards);
  const scoped = events.filter(
    (event) => dateSet.has(event.date) && boardSet.has(event.board),
  );
  const sealedSums = Array.from({ length: TRADING_MINUTES }, () => 0);
  const openedSums = Array.from({ length: TRADING_MINUTES }, () => 0);
  const neverOpenedSums = Array.from({ length: TRADING_MINUTES }, () => 0);
  const resealedSums = Array.from({ length: TRADING_MINUTES }, () => 0);
  const sealedThenOpenedSums = Array.from({ length: TRADING_MINUTES }, () => 0);
  const touchedNotSealedSums = Array.from({ length: TRADING_MINUTES }, () => 0);
  for (const event of scoped) {
    const index = Math.max(
      0,
      Math.min(TRADING_MINUTES - 1, timeIndex(event.first_touch_time)),
    );
    if (event.classification === "封板") sealedSums[index] += 1;
    else openedSums[index] += 1;
    if (event.path_classification === "未开板封住") neverOpenedSums[index] += 1;
    else if (event.path_classification === "开板后回封") resealedSums[index] += 1;
    else if (event.path_classification === "封板后开板") sealedThenOpenedSums[index] += 1;
    else touchedNotSealedSums[index] += 1;
  }

  const dayCount = Math.max(1, rangeDates.length);
  const sealedPerMinute = sealedSums.map((value) => value / dayCount);
  const openedPerMinute = openedSums.map((value) => value / dayCount);
  const sealed = trailingAverage(sealedPerMinute, windowLength);
  const opened = trailingAverage(openedPerMinute, windowLength);
  const averagePath = (values: number[]) =>
    trailingAverage(values.map((value) => value / dayCount), windowLength);
  const neverOpened = averagePath(neverOpenedSums);
  const resealed = averagePath(resealedSums);
  const sealedThenOpened = averagePath(sealedThenOpenedSums);
  const touchedNotSealed = averagePath(touchedNotSealedSums);
  const sealedRate = sealed.map((value, index) => sealedShare(value, opened[index]));
  const openedRate = sealedRate.map((rate) => (rate == null ? null : 1 - rate));
  const neverOpenedRate = neverOpened.map((value, index) =>
    sealedShare(value, resealed[index]),
  );
  const resealedRate = neverOpenedRate.map((rate) =>
    rate == null ? null : 1 - rate,
  );
  const sealedThenOpenedRate = sealedThenOpened.map((value, index) =>
    sealedShare(value, touchedNotSealed[index]),
  );
  const touchedNotSealedRate = sealedThenOpenedRate.map((rate) =>
    rate == null ? null : 1 - rate,
  );
  const sealedTotal = scoped.filter((event) => event.classification === "封板").length;
  const openedTotal = scoped.length - sealedTotal;
  const neverOpenedCount = scoped.filter(
    (event) => event.path_classification === "未开板封住",
  ).length;
  const resealedCount = scoped.filter(
    (event) => event.path_classification === "开板后回封",
  ).length;
  const sealedThenOpenedCount = scoped.filter(
    (event) => event.path_classification === "封板后开板",
  ).length;
  const touchedNotSealedCount = scoped.filter(
    (event) => event.path_classification === "触板未封",
  ).length;
  const total = Math.max(1, scoped.length);
  const sealedDenominator = Math.max(1, sealedTotal);
  const openedDenominator = Math.max(1, openedTotal);
  const averageDailySealed = sealedTotal / dayCount;
  const averageDailyOpened = openedTotal / dayCount;

  return {
    sealed,
    opened,
    sealedRate,
    openedRate,
    neverOpened,
    resealed,
    sealedThenOpened,
    touchedNotSealed,
    neverOpenedRate,
    resealedRate,
    sealedThenOpenedRate,
    touchedNotSealedRate,
    averageDailySealed,
    averageDailyOpened,
    averageMinuteSealed: averageDailySealed / TRADING_MINUTES,
    averageMinuteOpened: averageDailyOpened / TRADING_MINUTES,
    overallSealedRate: sealedTotal / total,
    overallOpenedRate: openedTotal / total,
    neverOpenedCount,
    resealedCount,
    sealedThenOpenedCount,
    touchedNotSealedCount,
    overallNeverOpenedRate: neverOpenedCount / sealedDenominator,
    overallResealedRate: resealedCount / sealedDenominator,
    overallSealedThenOpenedRate: sealedThenOpenedCount / openedDenominator,
    overallTouchedNotSealedRate: touchedNotSealedCount / openedDenominator,
    eventCount: scoped.length,
    tradingDayCount: rangeDates.length,
  };
}

function CumulativeChart({ events, scope }: { events: LimitEvent[]; scope: string }) {
  const sealed = useMemo(() => buildCumulative(events, "封板"), [events]);
  const opened = useMemo(() => buildCumulative(events, "开板"), [events]);
  const maxValue = Math.max(1, sealed.at(-1) ?? 0, opened.at(-1) ?? 0);
  const width = 920;
  const height = 330;
  const margin = { left: 52, right: 22, top: 24, bottom: 46 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const x = (index: number) => margin.left + (index / 241) * innerWidth;
  const y = (value: number) => margin.top + innerHeight - (value / maxValue) * innerHeight;

  const stepPath = (values: number[]) => {
    let path = `M ${x(0)} ${y(0)}`;
    let previous = 0;
    values.forEach((value, index) => {
      if (value !== previous) {
        path += ` H ${x(index)} V ${y(value)}`;
        previous = value;
      }
    });
    path += ` H ${x(241)}`;
    return path;
  };

  const yTicks = Array.from(new Set([0, Math.round(maxValue / 2), maxValue]));
  const xTicks = [
    [0, "09:30"],
    [30, "10:00"],
    [60, "10:30"],
    [90, "11:00"],
    [120, "11:30"],
    [121, "13:00"],
    [151, "13:30"],
    [181, "14:00"],
    [211, "14:30"],
    [241, "15:00"],
  ] as const;

  return (
    <div className="chart-wrap">
      <svg
        className="curve-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${scope}当日封板与开板股票按真实首次触板时间计算的累计曲线`}
      >
        <title>{scope}当日累计触板曲线</title>
        <desc>横轴是实际交易时刻，纵轴是筛选范围内的累计触板股票数量。</desc>
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              className="chart-grid"
              x1={margin.left}
              x2={width - margin.right}
              y1={y(tick)}
              y2={y(tick)}
            />
            <text className="chart-tick" x={margin.left - 10} y={y(tick) + 4} textAnchor="end">
              {tick}
            </text>
          </g>
        ))}
        <line className="session-divider" x1={x(120.5)} x2={x(120.5)} y1={margin.top} y2={height - margin.bottom} />
        <text className="lunch-label" x={x(120.5)} y={margin.top + 12} textAnchor="middle">午间</text>
        {xTicks.map(([index, label]) => (
          <text
            key={label}
            className="chart-tick chart-time"
            x={x(index)}
            y={height - 18}
            textAnchor={index === 0 ? "start" : index === 241 ? "end" : "middle"}
          >
            {index === 120 || index === 121 ? (index === 120 ? "11:30" : "13:00") : label}
          </text>
        ))}
        <path className="curve curve-sealed" d={stepPath(sealed)} />
        <path className="curve curve-opened" d={stepPath(opened)} />
        <circle className="curve-end curve-end-sealed" cx={x(241)} cy={y(sealed.at(-1) ?? 0)} r="4" />
        <circle className="curve-end curve-end-opened" cx={x(241)} cy={y(opened.at(-1) ?? 0)} r="4" />
      </svg>
    </div>
  );
}

function RangeObservationChart({
  mode,
  observation,
}: {
  mode: "count" | "rate";
  observation: RangeObservation;
}) {
  const [activeIndex, setActiveIndex] = useState(TRADING_MINUTES - 1);
  const width = 760;
  const height = 360;
  const margin = { left: 54, right: 28, top: 28, bottom: 50 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const sealed = mode === "count" ? observation.sealed : observation.sealedRate;
  const opened = mode === "count" ? observation.opened : observation.openedRate;
  const referenceSealed =
    mode === "count" ? observation.averageMinuteSealed : observation.overallSealedRate;
  const referenceOpened =
    mode === "count" ? observation.averageMinuteOpened : observation.overallOpenedRate;
  const numericValues = [...sealed, ...opened].filter(
    (value): value is number => value != null && Number.isFinite(value),
  );
  const maxValue =
    mode === "rate"
      ? 1
      : Math.max(1, referenceSealed, referenceOpened, ...numericValues) * 1.08;
  const x = (index: number) => margin.left + (index / (TRADING_MINUTES - 1)) * innerWidth;
  const y = (value: number) => margin.top + innerHeight - (value / maxValue) * innerHeight;
  const path = (values: Array<number | null>) => {
    let drawing = false;
    return values
      .map((value, index) => {
        if (value == null) {
          drawing = false;
          return "";
        }
        const command = drawing ? "L" : "M";
        drawing = true;
        return `${command} ${x(index)} ${y(value)}`;
      })
      .join(" ");
  };
  const yTicks =
    mode === "rate"
      ? [0, 0.25, 0.5, 0.75, 1]
      : Array.from(new Set([0, maxValue / 2, maxValue]));
  const xTicks = [0, 30, 60, 90, 120, 121, 151, 181, 211, 241];
  const activeSealed = sealed[activeIndex];
  const activeOpened = opened[activeIndex];

  const updateActiveIndex = (clientX: number, svg: SVGSVGElement) => {
    const bounds = svg.getBoundingClientRect();
    const chartX = ((clientX - bounds.left) / bounds.width) * width;
    const index = Math.round(
      ((chartX - margin.left) / innerWidth) * (TRADING_MINUTES - 1),
    );
    setActiveIndex(Math.max(0, Math.min(TRADING_MINUTES - 1, index)));
  };
  const formatValue = (value: number | null | undefined) => {
    if (value == null) return "—";
    return mode === "rate"
      ? formatPercent(value)
      : value < 1
        ? value.toFixed(2)
        : value.toFixed(1);
  };

  return (
    <div className="range-chart-wrap">
      <svg
        className="range-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={mode === "count" ? "区间每分钟日均封板与开板数量曲线" : "区间每分钟封板与开板占比曲线"}
        onPointerMove={(event) => updateActiveIndex(event.clientX, event.currentTarget)}
        onPointerLeave={() => setActiveIndex(TRADING_MINUTES - 1)}
      >
        <title>{mode === "count" ? "区间每分钟日均数量" : "区间每分钟占比"}</title>
        <desc>每个点只统计对应分钟滑动窗口内的事件；实线为窗口平均，虚线为所选日期范围的全日每分钟均值或总体占比参考。</desc>
        {yTicks.map((tick) => (
          <g key={tick}>
            <line className="range-grid" x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />
            <text className="range-axis-label" x={margin.left - 10} y={y(tick) + 4} textAnchor="end">
              {mode === "rate" ? `${Math.round(tick * 100)}%` : tick.toFixed(tick < 10 ? 1 : 0)}
            </text>
          </g>
        ))}
        <line className="range-lunch-line" x1={x(120.5)} x2={x(120.5)} y1={margin.top} y2={height - margin.bottom} />
        {xTicks.map((index) => (
          <text
            key={index}
            className="range-axis-label range-time-label"
            x={x(index)}
            y={height - 20}
            textAnchor={index === 0 ? "start" : index === TRADING_MINUTES - 1 ? "end" : "middle"}
          >
            {tradingMinuteLabel(index)}
          </text>
        ))}
        <line className="range-reference range-reference-sealed" x1={margin.left} x2={width - margin.right} y1={y(referenceSealed)} y2={y(referenceSealed)} />
        <line className="range-reference range-reference-opened" x1={margin.left} x2={width - margin.right} y1={y(referenceOpened)} y2={y(referenceOpened)} />
        <path className="range-line range-line-sealed" d={path(sealed)} />
        <path className="range-line range-line-opened" d={path(opened)} />
        <g className="range-cursor">
          <line x1={x(activeIndex)} x2={x(activeIndex)} y1={margin.top} y2={height - margin.bottom} />
          {activeSealed != null && <circle className="range-point-sealed" cx={x(activeIndex)} cy={y(activeSealed)} r="4" />}
          {activeOpened != null && <circle className="range-point-opened" cx={x(activeIndex)} cy={y(activeOpened)} r="4" />}
        </g>
      </svg>
      <div className="range-readout" aria-live="polite">
        <strong>{tradingMinuteLabel(activeIndex)}</strong>
        <span className="sealed-value">封板 {mode === "count" ? "日均 " : ""}{formatValue(activeSealed)}</span>
        <span className="opened-value">开板 {mode === "count" ? "日均 " : ""}{formatValue(activeOpened)}</span>
      </div>
    </div>
  );
}

function PathStackedChart({
  kind,
  observation,
}: {
  kind: "sealed" | "opened";
  observation: RangeObservation;
}) {
  const [activeIndex, setActiveIndex] = useState(TRADING_MINUTES - 1);
  const width = 760;
  const height = 360;
  const margin = { left: 54, right: 28, top: 28, bottom: 50 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const barWidth = innerWidth / TRADING_MINUTES;
  const first =
    kind === "sealed"
      ? observation.neverOpenedRate
      : observation.sealedThenOpenedRate;
  const second =
    kind === "sealed"
      ? observation.resealedRate
      : observation.touchedNotSealedRate;
  const firstLabel = kind === "sealed" ? "未开板封住" : "封板后开板";
  const secondLabel = kind === "sealed" ? "开板后回封" : "触板未封";
  const firstColor = kind === "sealed" ? NEVER_OPENED : SEALED_THEN_OPENED;
  const secondColor = kind === "sealed" ? RESEALED : TOUCHED_NOT_SEALED;
  const overallFirst =
    kind === "sealed"
      ? observation.overallNeverOpenedRate
      : observation.overallSealedThenOpenedRate;
  const x = (index: number) => margin.left + index * barWidth;
  const y = (value: number) => margin.top + innerHeight - value * innerHeight;
  const xTicks = [0, 30, 60, 90, 120, 121, 151, 181, 211, 241];
  const activeFirst = first[activeIndex];
  const activeSecond = second[activeIndex];

  const updateActiveIndex = (clientX: number, svg: SVGSVGElement) => {
    const bounds = svg.getBoundingClientRect();
    const chartX = ((clientX - bounds.left) / bounds.width) * width;
    const index = Math.floor((chartX - margin.left) / barWidth);
    setActiveIndex(Math.max(0, Math.min(TRADING_MINUTES - 1, index)));
  };

  return (
    <div className="range-chart-wrap">
      <svg
        className="range-chart path-stacked-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${kind === "sealed" ? "封板" : "开板"}路径每分钟比例堆叠图`}
        onPointerMove={(event) => updateActiveIndex(event.clientX, event.currentTarget)}
        onPointerLeave={() => setActiveIndex(TRADING_MINUTES - 1)}
      >
        <title>{kind === "sealed" ? "封板路径构成" : "开板路径构成"}</title>
        <desc>每个交易分钟按当前滑动窗口计算两类路径在对应封板或开板事件中的构成，两类比例之和为百分之百。</desc>
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
          <g key={tick}>
            <line className="range-grid" x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />
            <text className="range-axis-label" x={margin.left - 10} y={y(tick) + 4} textAnchor="end">
              {Math.round(tick * 100)}%
            </text>
          </g>
        ))}
        {first.map((firstRate, index) => {
          if (firstRate == null || second[index] == null) return null;
          return (
            <g key={index}>
              <rect
                x={x(index)}
                y={y(firstRate)}
                width={barWidth + 0.35}
                height={innerHeight * firstRate}
                fill={firstColor}
              />
              <rect
                x={x(index)}
                y={margin.top}
                width={barWidth + 0.35}
                height={innerHeight * (second[index] ?? 0)}
                fill={secondColor}
              />
            </g>
          );
        })}
        <line
          className="path-reference"
          x1={margin.left}
          x2={width - margin.right}
          y1={y(overallFirst)}
          y2={y(overallFirst)}
        />
        <line className="range-lunch-line" x1={x(121)} x2={x(121)} y1={margin.top} y2={height - margin.bottom} />
        {xTicks.map((index) => (
          <text
            key={index}
            className="range-axis-label range-time-label"
            x={x(index)}
            y={height - 20}
            textAnchor={index === 0 ? "start" : index === TRADING_MINUTES - 1 ? "end" : "middle"}
          >
            {tradingMinuteLabel(index)}
          </text>
        ))}
        <line
          className="path-cursor"
          x1={x(activeIndex) + barWidth / 2}
          x2={x(activeIndex) + barWidth / 2}
          y1={margin.top}
          y2={height - margin.bottom}
        />
      </svg>
      <div className="range-readout path-readout" aria-live="polite">
        <strong>{tradingMinuteLabel(activeIndex)}</strong>
        <span style={{ color: firstColor }}>{firstLabel} {activeFirst == null ? "—" : formatPercent(activeFirst)}</span>
        <span style={{ color: kind === "sealed" ? "#5d91b5" : "#c77d69" }}>{secondLabel} {activeSecond == null ? "—" : formatPercent(activeSecond)}</span>
      </div>
    </div>
  );
}

function StockIntradayChart({ event, points }: { event: LimitEvent; points: MinutePoint[] }) {
  const [activeIndex, setActiveIndex] = useState(Math.max(0, points.length - 1));
  const width = 1120;
  const height = 650;
  const margin = { left: 68, right: 24 };
  const innerWidth = width - margin.left - margin.right;
  const priceTop = 28;
  const priceHeight = 300;
  const volumeTop = 388;
  const volumeHeight = 82;
  const amountTop = 525;
  const amountHeight = 82;

  useEffect(() => setActiveIndex(Math.max(0, points.length - 1)), [points]);

  const priceValues = points.flatMap((point) => [point.low, point.high]);
  priceValues.push(event.reference_close, event.limit_price);
  const rawMin = Math.min(...priceValues);
  const rawMax = Math.max(...priceValues);
  const pricePadding = Math.max(0.01, (rawMax - rawMin) * 0.06);
  const priceMin = rawMin - pricePadding;
  const priceMax = rawMax + pricePadding;
  const maxVolume = Math.max(1, ...points.map((point) => point.volume));
  const maxAmount = Math.max(1, ...points.map((point) => point.amount));
  const x = (time: string) => margin.left + (minuteTimeIndex(time) / 241) * innerWidth;
  const yPrice = (value: number) =>
    priceTop + priceHeight - ((value - priceMin) / (priceMax - priceMin)) * priceHeight;
  const yVolume = (value: number) => volumeTop + volumeHeight - (value / maxVolume) * volumeHeight;
  const yAmount = (value: number) => amountTop + amountHeight - (value / maxAmount) * amountHeight;
  const linePath = (value: (point: MinutePoint) => number, y: (value: number) => number) =>
    points.map((point, index) => `${index ? "L" : "M"} ${x(point.time)} ${y(value(point))}`).join(" ");
  const areaPath = (value: (point: MinutePoint) => number, y: (value: number) => number, baseline: number) => {
    if (!points.length) return "";
    return `${linePath(value, y)} L ${x(points.at(-1)!.time)} ${baseline} L ${x(points[0].time)} ${baseline} Z`;
  };
  const priceTicks = [priceMin, (priceMin + priceMax) / 2, priceMax];
  const timeTicks = ["09:30", "10:00", "10:30", "11:00", "11:30", "13:00", "13:30", "14:00", "14:30", "15:00"];
  const firstTouch = timeOnly(event.first_touch_time);
  const touchPoint = points.find((point) => point.time === firstTouch);
  const activePoint = points[Math.min(activeIndex, points.length - 1)] ?? points[0];

  const updateActivePoint = (clientX: number, svg: SVGSVGElement) => {
    const bounds = svg.getBoundingClientRect();
    const chartX = ((clientX - bounds.left) / bounds.width) * width;
    let nearest = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    points.forEach((point, index) => {
      const distance = Math.abs(x(point.time) - chartX);
      if (distance < nearestDistance) {
        nearest = index;
        nearestDistance = distance;
      }
    });
    setActiveIndex(nearest);
  };

  return (
    <div className="stock-chart-wrap">
      <div className="stock-chart-legend" aria-label="价格图例">
        <span><i className="legend-close" />收盘价</span>
        <span><i className="legend-high" />最高价</span>
        <span><i className="legend-low" />最低价</span>
        <span><i className="legend-limit" />涨停价 {formatPrice(event.limit_price)}</span>
        <span><i className="legend-reference" />昨收 {formatPrice(event.reference_close)}</span>
      </div>
      <svg
        className="stock-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${event.code} 当日分钟价格、成交量与成交额曲线`}
        onPointerMove={(pointerEvent) => updateActivePoint(pointerEvent.clientX, pointerEvent.currentTarget)}
        onPointerLeave={() => setActiveIndex(Math.max(0, points.length - 1))}
      >
        <title>{event.code} 当日分钟行情</title>
        <desc>共享时间轴展示分钟最高价、最低价、收盘价、成交量和成交额，并标记涨停价与首次触板时间。</desc>

        {priceTicks.map((tick) => (
          <g key={tick}>
            <line className="stock-grid" x1={margin.left} x2={width - margin.right} y1={yPrice(tick)} y2={yPrice(tick)} />
            <text className="stock-axis-label" x={margin.left - 10} y={yPrice(tick) + 4} textAnchor="end">{tick.toFixed(2)}</text>
          </g>
        ))}
        <text className="stock-lane-label" x={margin.left} y={priceTop - 10}>价格（元）</text>
        <path className="stock-line stock-high" d={linePath((point) => point.high, yPrice)} />
        <path className="stock-line stock-low" d={linePath((point) => point.low, yPrice)} />
        <path className="stock-line stock-close" d={linePath((point) => point.close, yPrice)} />
        <line className="stock-reference-line" x1={margin.left} x2={width - margin.right} y1={yPrice(event.reference_close)} y2={yPrice(event.reference_close)} />
        <line className="stock-limit-line" x1={margin.left} x2={width - margin.right} y1={yPrice(event.limit_price)} y2={yPrice(event.limit_price)} />

        <line className="stock-grid" x1={margin.left} x2={width - margin.right} y1={volumeTop + volumeHeight} y2={volumeTop + volumeHeight} />
        <text className="stock-lane-label" x={margin.left} y={volumeTop - 10}>分钟成交量</text>
        <text className="stock-axis-label" x={margin.left - 10} y={volumeTop + 4} textAnchor="end">{formatCompact(maxVolume)}</text>
        <path className="stock-area stock-volume-area" d={areaPath((point) => point.volume, yVolume, volumeTop + volumeHeight)} />
        <path className="stock-line stock-volume" d={linePath((point) => point.volume, yVolume)} />

        <line className="stock-grid" x1={margin.left} x2={width - margin.right} y1={amountTop + amountHeight} y2={amountTop + amountHeight} />
        <text className="stock-lane-label" x={margin.left} y={amountTop - 10}>分钟成交额（元）</text>
        <text className="stock-axis-label" x={margin.left - 10} y={amountTop + 4} textAnchor="end">{formatCompact(maxAmount)}</text>
        <path className="stock-area stock-amount-area" d={areaPath((point) => point.amount, yAmount, amountTop + amountHeight)} />
        <path className="stock-line stock-amount" d={linePath((point) => point.amount, yAmount)} />

        {timeTicks.map((time) => (
          <g key={time}>
            <line className="stock-time-grid" x1={x(time)} x2={x(time)} y1={priceTop} y2={amountTop + amountHeight} />
            <text className="stock-axis-label stock-time-label" x={x(time)} y={height - 15} textAnchor={time === "09:30" ? "start" : time === "15:00" ? "end" : "middle"}>{time}</text>
          </g>
        ))}

        {touchPoint && (
          <g>
            <line className="stock-touch-line" x1={x(touchPoint.time)} x2={x(touchPoint.time)} y1={priceTop} y2={amountTop + amountHeight} />
            <circle className="stock-touch-point" cx={x(touchPoint.time)} cy={yPrice(event.limit_price)} r="5" />
            <text className="stock-touch-label" x={x(touchPoint.time) + 7} y={yPrice(event.limit_price) - 9}>首次触板 {touchPoint.time}</text>
          </g>
        )}

        {activePoint && (
          <g className="stock-cursor">
            <line x1={x(activePoint.time)} x2={x(activePoint.time)} y1={priceTop} y2={amountTop + amountHeight} />
            <circle cx={x(activePoint.time)} cy={yPrice(activePoint.close)} r="4" />
          </g>
        )}
      </svg>
      {activePoint && (
        <div className="stock-readout" aria-live="polite">
          <strong>{activePoint.time}</strong>
          <span>开 {formatPrice(activePoint.open)}</span>
          <span>高 {formatPrice(activePoint.high)}</span>
          <span>低 {formatPrice(activePoint.low)}</span>
          <span>收 {formatPrice(activePoint.close)}</span>
          <span>量 {formatCompact(activePoint.volume)}</span>
          <span>额 {formatCompact(activePoint.amount)}</span>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [events, setEvents] = useState<LimitEvent[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [boards, setBoards] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [boardFilter, setBoardFilter] = useState<BoardFilter>("全部板块");
  const [typeFilter, setTypeFilter] = useState<"全部" | Classification>("全部");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [selectedCode, setSelectedCode] = useState("");
  const [minuteStocks, setMinuteStocks] = useState<Map<string, MinutePoint[]>>(new Map());
  const [base64MinuteDates, setBase64MinuteDates] = useState<Set<string>>(new Set());
  const [minuteLoading, setMinuteLoading] = useState(false);
  const [minuteError, setMinuteError] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [rangeBoards, setRangeBoards] = useState<string[]>([]);
  const [windowLength, setWindowLength] = useState(5);

  useEffect(() => {
    let active = true;
    fetch(`${DATA_BASE}/data/events.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`数据请求失败：${response.status}`);
        return response.json() as Promise<CompactPayload>;
      })
      .then(async (payload) => {
        if (payload.shards?.length) {
          const batches = await Promise.all(
            payload.shards.map((shard) =>
              fetch(`${DATA_BASE}/${shard.path}`).then((response) => {
                if (!response.ok) throw new Error(`事件分片请求失败：${response.status}`);
                return response.json() as Promise<Array<Array<string | number | null>>>;
              }),
            ),
          );
          payload.events = batches.flat();
        }
        return payload;
      })
      .then((payload) => {
        if (!active) return;
        const inflated = inflatePayload(payload);
        setEvents(inflated);
        setDates(payload.dates);
        const availableBoards = payload.boards ?? [...new Set(inflated.map((event) => event.board))];
        setBoards(availableBoards);
        setBase64MinuteDates(new Set(payload.base64_minute_dates ?? []));
        setRangeBoards(availableBoards);
        setSelectedDate(payload.dates.at(-1) ?? "");
        setRangeStart(payload.dates.at(-20) ?? payload.dates[0] ?? "");
        setRangeEnd(payload.dates.at(-1) ?? "");
      })
      .catch((reason: Error) => active && setError(reason.message));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setPage(1);
    setQuery("");
    setTypeFilter("全部");
  }, [selectedDate]);

  useEffect(() => {
    const choices = events
      .filter(
        (event) =>
          event.date === selectedDate &&
          (boardFilter === "全部板块" || event.board === boardFilter),
      )
      .sort((a, b) => a.first_touch_time.localeCompare(b.first_touch_time));
    setSelectedCode((current) =>
      choices.some((event) => event.code === current) ? current : (choices[0]?.code ?? ""),
    );
  }, [events, selectedDate, boardFilter]);

  useEffect(() => {
    if (!selectedDate) return;
    const controller = new AbortController();
    setMinuteLoading(true);
    setMinuteError("");
    setMinuteStocks(new Map());
    const usesBase64 = base64MinuteDates.has(selectedDate);
    const minutePath = usesBase64
      ? `${DATA_BASE}/data/minutes-base64/${selectedDate}.txt`
      : `${DATA_BASE}/data/minutes/${selectedDate}.bin`;
    fetch(minutePath, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`分钟行情请求失败：${response.status}`);
        return usesBase64
          ? response.text().then(decodeBase64Buffer)
          : response.arrayBuffer();
      })
      .then((payload) => setMinuteStocks(inflateMinutePayload(payload)))
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setMinuteError(reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setMinuteLoading(false);
      });
    return () => controller.abort();
  }, [base64MinuteDates, selectedDate]);

  const dayEvents = useMemo(
    () => events.filter((event) => event.date === selectedDate),
    [events, selectedDate],
  );
  const scopedEvents = useMemo(
    () =>
      dayEvents.filter(
        (event) => boardFilter === "全部板块" || event.board === boardFilter,
      ),
    [boardFilter, dayEvents],
  );
  const boardCounts = useMemo(
    () =>
      Object.fromEntries(
        boards.map((board) => [
          board,
          dayEvents.filter((event) => event.board === board).length,
        ]),
      ),
    [boards, dayEvents],
  );
  const sealedCount = scopedEvents.filter((event) => event.classification === "封板").length;
  const openedCount = scopedEvents.length - sealedCount;
  const sealRate = scopedEvents.length ? sealedCount / scopedEvents.length : 0;
  const earliest = scopedEvents.reduce<LimitEvent | null>((current, event) => {
    if (!current || event.first_touch_time < current.first_touch_time) return event;
    return current;
  }, null);
  const totalAmount = scopedEvents.reduce((sum, event) => sum + event.total_amount, 0);
  const stockChoices = useMemo(
    () => [...scopedEvents].sort((a, b) => a.first_touch_time.localeCompare(b.first_touch_time)),
    [scopedEvents],
  );
  const selectedEvent = scopedEvents.find((event) => event.code === selectedCode) ?? null;
  const selectedPoints = minuteStocks.get(selectedCode) ?? [];

  const filteredEvents = useMemo(() => {
    const normalizedQuery = query.trim().toUpperCase();
    return scopedEvents
      .filter((event) => typeFilter === "全部" || event.classification === typeFilter)
      .filter((event) => !normalizedQuery || event.code.includes(normalizedQuery))
      .sort((a, b) => a.first_touch_time.localeCompare(b.first_touch_time));
  }, [query, scopedEvents, typeFilter]);
  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / PAGE_SIZE));
  const visibleEvents = filteredEvents.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const dateIndex = dates.indexOf(selectedDate);
  const rangeDates = useMemo(
    () => dates.filter((date) => date >= rangeStart && date <= rangeEnd),
    [dates, rangeEnd, rangeStart],
  );
  const rangeObservation = useMemo(
    () => buildRangeObservation(events, rangeDates, rangeBoards, windowLength),
    [events, rangeBoards, rangeDates, windowLength],
  );

  const chooseInputDate = (value: string) => {
    const compact = compactDate(value);
    if (dates.includes(compact)) {
      setSelectedDate(compact);
      return;
    }
    const next = dates.find((date) => date >= compact) ?? dates.at(-1);
    if (next) setSelectedDate(next);
  };

  const nearestTradingDate = (value: string) => {
    const compact = compactDate(value);
    return dates.reduce((nearest, date) =>
      Math.abs(Number(date) - Number(compact)) < Math.abs(Number(nearest) - Number(compact))
        ? date
        : nearest,
    dates[0]);
  };

  const chooseRangeDate = (edge: "start" | "end", value: string) => {
    const next = nearestTradingDate(value);
    if (edge === "start") {
      setRangeStart(next);
      if (next > rangeEnd) setRangeEnd(next);
    } else {
      setRangeEnd(next);
      if (next < rangeStart) setRangeStart(next);
    }
  };

  const toggleRangeBoard = (board: string) => {
    setRangeBoards((current) => {
      if (current.includes(board)) {
        return current.length === 1 ? current : current.filter((item) => item !== board);
      }
      return boards.filter((item) => current.includes(item) || item === board);
    });
  };

  if (error) {
    return (
      <main className="state-page">
        <div className="state-panel">
          <span className="eyebrow">数据加载失败</span>
          <h1>暂时无法打开触板数据</h1>
          <p>{error}</p>
        </div>
      </main>
    );
  }

  if (!selectedDate) {
    return (
      <main className="state-page">
        <div className="loading-mark" aria-hidden="true" />
        <p>正在整理触板数据…</p>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">A-SHARE LIMIT EVENTS · 2023—2026</span>
          <h1>全市场涨停观察台</h1>
          <p className="subtitle">按日期与板块查看真实触板节奏、封板结果和个股分钟行情</p>
        </div>
        <div className="date-control" aria-label="选择交易日期">
          <button
            className="date-arrow"
            type="button"
            aria-label="上一交易日"
            disabled={dateIndex <= 0}
            onClick={() => setSelectedDate(dates[dateIndex - 1])}
          >
            ←
          </button>
          <label>
            <span>交易日期</span>
            <input
              type="date"
              value={dateInputValue(selectedDate)}
              min={dateInputValue(dates[0])}
              max={dateInputValue(dates.at(-1) ?? dates[0])}
              onChange={(event) => chooseInputDate(event.target.value)}
            />
          </label>
          <button
            className="date-arrow"
            type="button"
            aria-label="下一交易日"
            disabled={dateIndex >= dates.length - 1}
            onClick={() => setSelectedDate(dates[dateIndex + 1])}
          >
            →
          </button>
        </div>
      </header>

      <section className="day-heading">
        <div>
          <p className="day-date">{displayDate(selectedDate)}</p>
          <p className="day-context">第 {dateIndex + 1} / {dates.length} 个交易日</p>
        </div>
        <span className="scope-chip">
          {boardFilter === "全部板块"
            ? "全部板块 · 10% / 20% / 30%"
            : `${boardFilter} · ${BOARD_LIMIT_RATE[boardFilter] ?? "对应涨停规则"}`}
        </span>
      </section>

      <nav className="board-filter" aria-label="按股票板块筛选">
        {["全部板块", ...boards].map((board) => {
          const count = board === "全部板块" ? dayEvents.length : (boardCounts[board] ?? 0);
          return (
            <button
              key={board}
              type="button"
              className={boardFilter === board ? "active" : ""}
              aria-pressed={boardFilter === board}
              onClick={() => {
                setBoardFilter(board);
                setPage(1);
              }}
            >
              <span>{board}</span>
              <strong>{count}</strong>
            </button>
          );
        })}
      </nav>

      <section className="metric-grid" aria-label="当日关键指标">
        <article className="metric-card metric-total">
          <span>触板合计</span>
          <strong>{scopedEvents.length}</strong>
          <small>只 / 次</small>
        </article>
        <article className="metric-card metric-sealed">
          <span><i aria-hidden="true" />封板</span>
          <strong>{sealedCount}</strong>
          <small>收盘仍处涨停价</small>
        </article>
        <article className="metric-card metric-opened">
          <span><i aria-hidden="true" />开板</span>
          <strong>{openedCount}</strong>
          <small>触板后收盘打开</small>
        </article>
        <article className="metric-card metric-rate">
          <span>封板率</span>
          <strong>{formatPercent(sealRate)}</strong>
          <small>{sealedCount} / {scopedEvents.length}</small>
        </article>
      </section>

      <section className="analysis-grid">
        <article className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">INTRADAY CURVE</span>
              <h2>{boardFilter === "全部板块" ? "全市场累计触板曲线" : `${boardFilter}累计触板曲线`}</h2>
              <p>当前板块筛选会同步作用于曲线、指标、个股和明细</p>
            </div>
            <div className="chart-legend" aria-label="图例">
              <span><i style={{ background: SEALED }} />封板 {sealedCount}</span>
              <span><i style={{ background: OPENED }} />开板 {openedCount}</span>
            </div>
          </div>
          <CumulativeChart events={scopedEvents} scope={boardFilter} />
        </article>

        <aside className="panel day-facts">
          <div className="panel-heading compact-heading">
            <div>
              <span className="panel-kicker">DAY SNAPSHOT</span>
              <h2>当日速览</h2>
            </div>
          </div>
          <dl>
            <div>
              <dt>最早触板</dt>
              <dd>{earliest ? timeOnly(earliest.first_touch_time) : "—"}</dd>
              <small>{earliest?.code ?? "无记录"}</small>
            </div>
            <div>
              <dt>触板股票成交额</dt>
              <dd>{formatCompact(totalAmount)}</dd>
              <small>当日分钟成交额合计</small>
            </div>
            <div>
              <dt>平均触板分钟数</dt>
              <dd>
                {scopedEvents.length
                  ? (scopedEvents.reduce((sum, event) => sum + event.touch_minutes, 0) / scopedEvents.length).toFixed(1)
                  : "—"}
              </dd>
              <small>最高价等于涨停价</small>
            </div>
          </dl>
        </aside>
      </section>

      <section className="panel observation-panel" id="range-observation">
        <div className="panel-heading observation-heading">
          <div>
            <span className="panel-kicker">RANGE OBSERVATION</span>
            <h2>区间涨停节奏观察</h2>
            <p>逐分钟对齐所选交易日，每个点仅统计对应滑动窗口内的新封板与新开板事件，不做日内累计</p>
          </div>
          <div className="observation-summary" aria-label="当前区间摘要">
            <strong>{rangeObservation.tradingDayCount}</strong>
            <span>个交易日</span>
            <i aria-hidden="true" />
            <strong>{rangeObservation.eventCount.toLocaleString("zh-CN")}</strong>
            <span>次触板</span>
          </div>
        </div>

        <div className="observation-controls">
          <fieldset className="range-date-control">
            <legend>日期区间</legend>
            <label>
              <span>开始</span>
              <input
                type="date"
                value={dateInputValue(rangeStart)}
                min={dateInputValue(dates[0])}
                max={dateInputValue(rangeEnd)}
                onChange={(event) => chooseRangeDate("start", event.target.value)}
              />
            </label>
            <span className="date-separator" aria-hidden="true">—</span>
            <label>
              <span>结束</span>
              <input
                type="date"
                value={dateInputValue(rangeEnd)}
                min={dateInputValue(rangeStart)}
                max={dateInputValue(dates.at(-1) ?? dates[0])}
                onChange={(event) => chooseRangeDate("end", event.target.value)}
              />
            </label>
          </fieldset>

          <fieldset className="window-control">
            <legend>分钟移动平均窗口</legend>
            <div>
              <input
                type="range"
                min="1"
                max="60"
                step="1"
                value={windowLength}
                aria-label="分钟移动平均窗口长度"
                onChange={(event) => setWindowLength(Number(event.target.value))}
              />
              <output>{windowLength} 分钟</output>
            </div>
          </fieldset>

          <fieldset className="range-board-control">
            <legend>板块（可多选）</legend>
            <div>
              {boards.map((board) => (
                <button
                  key={board}
                  type="button"
                  className={rangeBoards.includes(board) ? "active" : ""}
                  aria-pressed={rangeBoards.includes(board)}
                  onClick={() => toggleRangeBoard(board)}
                >
                  {board}
                </button>
              ))}
              <button
                type="button"
                className={rangeBoards.length === boards.length ? "active" : ""}
                onClick={() => setRangeBoards(boards)}
              >
                全选
              </button>
            </div>
          </fieldset>
        </div>

        <div className="range-charts-grid">
          <article className="range-chart-card">
            <div className="range-chart-heading">
              <div>
                <span>AVERAGE COUNT</span>
                <h3>封板 / 开板每分钟日均数量</h3>
              </div>
              <div className="range-reference-legend">
                <span className="sealed-value">封板 {rangeObservation.averageMinuteSealed.toFixed(2)}/分钟 · {rangeObservation.averageDailySealed.toFixed(1)}/日</span>
                <span className="opened-value">开板 {rangeObservation.averageMinuteOpened.toFixed(2)}/分钟 · {rangeObservation.averageDailyOpened.toFixed(1)}/日</span>
              </div>
            </div>
            <RangeObservationChart mode="count" observation={rangeObservation} />
          </article>

          <article className="range-chart-card">
            <div className="range-chart-heading">
              <div>
                <span>AVERAGE SHARE</span>
                <h3>封板 / 开板每分钟占比</h3>
              </div>
              <div className="range-reference-legend">
                <span className="sealed-value">封板基准 {formatPercent(rangeObservation.overallSealedRate)}</span>
                <span className="opened-value">开板基准 {formatPercent(rangeObservation.overallOpenedRate)}</span>
              </div>
            </div>
            <RangeObservationChart mode="rate" observation={rangeObservation} />
          </article>

          <article className="range-chart-card path-chart-card">
            <div className="range-chart-heading">
              <div>
                <span>SEALED PATH MIX</span>
                <h3>封板两类每分钟比例堆叠</h3>
              </div>
              <div className="path-legend">
                <span><i style={{ background: NEVER_OPENED }} />未开板封住 {formatPercent(rangeObservation.overallNeverOpenedRate)}</span>
                <span><i style={{ background: RESEALED }} />开板后回封 {formatPercent(rangeObservation.overallResealedRate)}</span>
              </div>
            </div>
            <PathStackedChart kind="sealed" observation={rangeObservation} />
          </article>

          <article className="range-chart-card path-chart-card">
            <div className="range-chart-heading">
              <div>
                <span>OPENED PATH MIX</span>
                <h3>开板两类每分钟比例堆叠</h3>
              </div>
              <div className="path-legend">
                <span><i style={{ background: SEALED_THEN_OPENED }} />封板后开板 {formatPercent(rangeObservation.overallSealedThenOpenedRate)}</span>
                <span><i style={{ background: TOUCHED_NOT_SEALED }} />触板未封 {formatPercent(rangeObservation.overallTouchedNotSealedRate)}</span>
              </div>
            </div>
            <PathStackedChart kind="opened" observation={rangeObservation} />
          </article>
        </div>

        <section className="path-statistics" aria-labelledby="path-statistics-title">
          <div className="path-statistics-heading">
            <div>
              <span>PATH STATISTICS</span>
              <h3 id="path-statistics-title">所选区间路径统计</h3>
            </div>
            <p>比例分别以封板总数或开板总数为分母</p>
          </div>
          <div className="path-stats-grid">
            {[
              {
                label: "未开板封住",
                count: rangeObservation.neverOpenedCount,
                rate: rangeObservation.overallNeverOpenedRate,
                color: NEVER_OPENED,
                parent: "封板",
              },
              {
                label: "开板后回封",
                count: rangeObservation.resealedCount,
                rate: rangeObservation.overallResealedRate,
                color: RESEALED,
                parent: "封板",
              },
              {
                label: "封板后开板",
                count: rangeObservation.sealedThenOpenedCount,
                rate: rangeObservation.overallSealedThenOpenedRate,
                color: SEALED_THEN_OPENED,
                parent: "开板",
              },
              {
                label: "触板未封",
                count: rangeObservation.touchedNotSealedCount,
                rate: rangeObservation.overallTouchedNotSealedRate,
                color: TOUCHED_NOT_SEALED,
                parent: "开板",
              },
            ].map((stat) => (
              <article key={stat.label} style={{ "--path-color": stat.color } as CSSProperties}>
                <span>{stat.label}</span>
                <strong>{stat.count.toLocaleString("zh-CN")}</strong>
                <div>
                  <b>{formatPercent(stat.rate)}</b>
                  <small>占{stat.parent} · 日均 {(stat.count / Math.max(1, rangeObservation.tradingDayCount)).toFixed(1)}</small>
                </div>
              </article>
            ))}
          </div>
        </section>

        <footer className="observation-note">
          <span><i className="solid-sample" />实线：{windowLength} 分钟窗口内的每分钟日均值</span>
          <span><i className="dashed-sample" />虚线：全日每分钟均值 / 区间总体占比</span>
          <span>早盘至午间休市、午后开盘按实际交易分钟连续对齐</span>
          <span>“中途开板”按首次分钟收盘封板后的后续分钟最低价低于涨停价判定</span>
        </footer>
      </section>

      <section className="panel stock-panel" id="stock-analysis">
        <div className="panel-heading stock-heading">
          <div>
            <span className="panel-kicker">STOCK INTRADAY</span>
            <h2>个股当日曲线</h2>
            <p>选择当天的一只触板股票，查看分钟价格、成交量和成交额的同步变化</p>
          </div>
          <label className="stock-selector">
            <span>选择股票</span>
            <select value={selectedCode} onChange={(selectEvent) => setSelectedCode(selectEvent.target.value)}>
              {stockChoices.map((event) => (
                <option key={event.code} value={event.code}>
                  {event.code} · {event.classification} · {timeOnly(event.first_touch_time)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {selectedEvent && (
          <div className="stock-summary">
            <div className="stock-identity">
              <strong>{selectedEvent.code}</strong>
              <span className={`status-badge ${selectedEvent.classification === "封板" ? "sealed" : "opened"}`}>
                {selectedEvent.classification}
              </span>
              <small>{selectedEvent.board}</small>
            </div>
            <dl>
              <div><dt>首次触板</dt><dd>{timeOnly(selectedEvent.first_touch_time)}</dd></div>
              <div><dt>最后触板</dt><dd>{timeOnly(selectedEvent.last_touch_time)}</dd></div>
              <div><dt>涨停价</dt><dd>{formatPrice(selectedEvent.limit_price)}</dd></div>
              <div><dt>日收盘</dt><dd>{formatPrice(selectedEvent.daily_close)}</dd></div>
            </dl>
          </div>
        )}

        {minuteLoading && <div className="stock-data-state"><i className="loading-mark" aria-hidden="true" />正在载入分钟行情…</div>}
        {minuteError && <div className="stock-data-state stock-data-error">{minuteError}</div>}
        {!minuteLoading && !minuteError && selectedEvent && selectedPoints.length > 0 && (
          <StockIntradayChart event={selectedEvent} points={selectedPoints} />
        )}
        {!minuteLoading && !minuteError && selectedEvent && !selectedPoints.length && (
          <div className="stock-data-state">该股票当天没有可用的分钟行情</div>
        )}
      </section>

      <section className="panel table-panel">
        <div className="panel-heading table-heading">
          <div>
            <span className="panel-kicker">EVENT DETAILS</span>
            <h2>当日触板明细</h2>
            <p>按照首次触板时间从早到晚排列</p>
          </div>
          <div className="table-tools">
            <div className="type-filter" aria-label="按结果筛选">
              {(["全部", "封板", "开板"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  className={typeFilter === type ? "active" : ""}
                  onClick={() => {
                    setTypeFilter(type);
                    setPage(1);
                  }}
                >
                  {type}
                </button>
              ))}
            </div>
            <label className="search-field">
              <span className="sr-only">搜索股票代码</span>
              <input
                type="search"
                value={query}
                placeholder="搜索代码"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
              />
            </label>
          </div>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>股票代码</th>
                <th>结果</th>
                <th>首次触板</th>
                <th>最后触板</th>
                <th className="numeric">昨收</th>
                <th className="numeric">涨停价</th>
                <th className="numeric">收盘价</th>
                <th className="numeric">触板分钟</th>
                <th className="numeric">成交额</th>
              </tr>
            </thead>
            <tbody>
              {visibleEvents.map((event) => (
                <tr key={`${event.date}-${event.code}`}>
                  <td>
                    <strong>{event.code}</strong>
                    <small>{event.board}</small>
                  </td>
                  <td>
                    <span className={`status-badge ${event.classification === "封板" ? "sealed" : "opened"}`}>
                      {event.classification}
                    </span>
                  </td>
                  <td className="mono">{timeOnly(event.first_touch_time)}</td>
                  <td className="mono">{timeOnly(event.last_touch_time)}</td>
                  <td className="numeric mono">{formatPrice(event.reference_close)}</td>
                  <td className="numeric mono limit-price">{formatPrice(event.limit_price)}</td>
                  <td className="numeric mono">{formatPrice(event.daily_close)}</td>
                  <td className="numeric mono">{event.touch_minutes}</td>
                  <td className="numeric mono">{formatCompact(event.total_amount)}</td>
                </tr>
              ))}
              {!visibleEvents.length && (
                <tr>
                  <td colSpan={9} className="empty-row">没有符合当前筛选条件的记录</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <footer className="table-footer">
          <span>共 {filteredEvents.length} 条记录</span>
          <div>
            <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>上一页</button>
            <span>{page} / {totalPages}</span>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>下一页</button>
          </div>
        </footer>
      </section>

      <footer className="site-footer">
        <span>数据范围：{dateInputValue(dates[0])} — {dateInputValue(dates.at(-1) ?? dates[0])}</span>
        <span>口径：主板 10% · 创业板/科创板 20% · 北交所 30%</span>
      </footer>
    </main>
  );
}
