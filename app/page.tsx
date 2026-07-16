"use client";

import { useEffect, useMemo, useState } from "react";

type Classification = "封板" | "开板";

type LimitEvent = {
  date: string;
  code: string;
  board: string;
  classification: Classification;
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
  fields: (keyof LimitEvent)[];
  events: Array<Array<string | number | null>>;
};

const PAGE_SIZE = 18;
const SEALED = "#2f6ea3";
const OPENED = "#e0785c";

function inflatePayload(payload: CompactPayload): LimitEvent[] {
  return payload.events.map((values) => {
    const record = Object.fromEntries(
      payload.fields.map((field, index) => [field, values[index]]),
    );
    return record as LimitEvent;
  });
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

function buildCumulative(events: LimitEvent[], type: Classification) {
  const increments = Array.from({ length: 242 }, () => 0);
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

function CumulativeChart({ events }: { events: LimitEvent[] }) {
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
        aria-label="当日封板与开板股票按真实首次触板时间计算的累计曲线"
      >
        <title>当日累计触板曲线</title>
        <desc>横轴是实际交易时刻，纵轴是累计触板股票数量。</desc>
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

export default function Dashboard() {
  const [events, setEvents] = useState<LimitEvent[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [typeFilter, setTypeFilter] = useState<"全部" | Classification>("全部");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/data/events.json")
      .then((response) => {
        if (!response.ok) throw new Error(`数据请求失败：${response.status}`);
        return response.json() as Promise<CompactPayload>;
      })
      .then((payload) => {
        if (!active) return;
        const inflated = inflatePayload(payload);
        setEvents(inflated);
        setDates(payload.dates);
        setSelectedDate(payload.dates.at(-1) ?? "");
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

  const dayEvents = useMemo(
    () => events.filter((event) => event.date === selectedDate),
    [events, selectedDate],
  );
  const sealedCount = dayEvents.filter((event) => event.classification === "封板").length;
  const openedCount = dayEvents.length - sealedCount;
  const sealRate = dayEvents.length ? sealedCount / dayEvents.length : 0;
  const earliest = dayEvents.reduce<LimitEvent | null>((current, event) => {
    if (!current || event.first_touch_time < current.first_touch_time) return event;
    return current;
  }, null);
  const totalAmount = dayEvents.reduce((sum, event) => sum + event.total_amount, 0);

  const filteredEvents = useMemo(() => {
    const normalizedQuery = query.trim().toUpperCase();
    return dayEvents
      .filter((event) => typeFilter === "全部" || event.classification === typeFilter)
      .filter((event) => !normalizedQuery || event.code.includes(normalizedQuery))
      .sort((a, b) => a.first_touch_time.localeCompare(b.first_touch_time));
  }, [dayEvents, query, typeFilter]);
  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / PAGE_SIZE));
  const visibleEvents = filteredEvents.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const dateIndex = dates.indexOf(selectedDate);

  const chooseInputDate = (value: string) => {
    const compact = compactDate(value);
    if (dates.includes(compact)) {
      setSelectedDate(compact);
      return;
    }
    const next = dates.find((date) => date >= compact) ?? dates.at(-1);
    if (next) setSelectedDate(next);
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
          <span className="eyebrow">MAIN BOARD · 10% LIMIT</span>
          <h1>主板涨停观察台</h1>
          <p className="subtitle">查看每个交易日的真实触板节奏、封板结果与事件明细</p>
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
        <span className="scope-chip">沪深主板 · 10%</span>
      </section>

      <section className="metric-grid" aria-label="当日关键指标">
        <article className="metric-card metric-total">
          <span>触板合计</span>
          <strong>{dayEvents.length}</strong>
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
          <small>{sealedCount} / {dayEvents.length}</small>
        </article>
      </section>

      <section className="analysis-grid">
        <article className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">INTRADAY CURVE</span>
              <h2>累计触板曲线</h2>
              <p>按真实首次触板分钟累计，午间休市区间压缩显示</p>
            </div>
            <div className="chart-legend" aria-label="图例">
              <span><i style={{ background: SEALED }} />封板 {sealedCount}</span>
              <span><i style={{ background: OPENED }} />开板 {openedCount}</span>
            </div>
          </div>
          <CumulativeChart events={dayEvents} />
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
                {dayEvents.length
                  ? (dayEvents.reduce((sum, event) => sum + event.touch_minutes, 0) / dayEvents.length).toFixed(1)
                  : "—"}
              </dd>
              <small>最高价等于涨停价</small>
            </div>
          </dl>
        </aside>
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
        <span>口径：当日最高价精确等于主板 10% 涨停价</span>
      </footer>
    </main>
  );
}
