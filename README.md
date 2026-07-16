# 主板涨停观察台

按交易日查看沪深主板 10% 触板事件，并支持选择当天股票查看分钟价格、成交量和成交额曲线。

## 数据准备

网页数据来自：

- `../limit_up_output/all_limit_up_events.csv`：触板事件与封板/开板结果
- `../2026/YYYYMMDD.parquet`：对应交易日的分钟行情

运行数据转换：

```bash
C:\Anaconda3\python.exe prepare_dashboard_data.py
```

脚本会生成：

- `public/data/events.json`：全部日级事件
- `public/data/minutes/YYYYMMDD.json`：按交易日拆分的触板股票分钟行情

分钟数据按日期延迟加载，切换股票时不需要重复请求同一天的数据。

## 本地运行

```bash
npm install
npm run dev
```

构建检查：

```bash
npm run build
```

## 个股图表口径

- 价格区：分钟最高价、最低价和收盘价，并显示昨收价与理论涨停价
- 成交量区：每分钟 `vol`
- 成交额区：每分钟 `amount`
- 首次触板标记：分钟最高价第一次等于理论涨停价的时刻
- 午间休市：11:30 和 13:00 在横轴上相邻显示
