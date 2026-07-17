# 全市场涨停观察台

按交易日查看 2023—2026 年沪市主板、深市主板、创业板、科创板和北交所触板事件。页面支持板块筛选，并可选择当日股票查看分钟价格、成交量和成交额曲线。

## 数据准备

网页数据来自：

- `../limit_up_output/all_limit_up_events.csv`：全板块触板事件及封板/开板结果；
- `../2023/YYYYMMDD.parquet` 至 `../2026/YYYYMMDD.parquet`：对应交易日的分钟行情。

运行数据转换：

```powershell
C:\Anaconda3\python.exe prepare_dashboard_data.py
```

脚本会生成：

- `public/data/events.json`：全部日期、板块和事件；
- `public/data/minutes/YYYYMMDD.bin`：按交易日拆分的紧凑分钟行情。

页面首先载入事件索引；分钟行情采用差分和变长整数编码，只在选择日期后加载，切换同一天的股票不会重复请求数据。价格保留到分，图表用分钟成交量按百股、成交额按千元存储并在前端恢复单位。

## 本地运行

```powershell
npm install
npm run dev
```

构建检查：

```powershell
npm run build
```

## GitHub Pages

仓库包含 `.github/workflows/deploy-pages.yml`。推送到默认分支后，GitHub Actions 会自动执行静态导出并部署 Pages。

## 页面筛选口径

- 全部板块：显示当天所有正式触板事件；
- 沪市主板、深市主板：正常涨停幅度 10%；
- 创业板、科创板：正常涨停幅度 20%；
- 北交所：正常涨停幅度 30%；
- 选择板块后，关键指标、累计曲线、个股列表和触板明细会同步更新。

未核验的 5% ST 候选不包含在网页正式结果中。
