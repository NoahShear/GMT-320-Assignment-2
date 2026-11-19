const FILES = {
  wdi: "data/wdi_indicators.csv",
  classes: "data/country_classification.csv",
};

const INDICATORS = {
  gdp:  { series: "NY.GDP.PCAP.CD", label: "GDP per capita (US$)", short: "GDP per capita", fmt: (v) => "$" + Math.round(v).toLocaleString("en-ZA") },
  life: { series: "SP.DYN.LE00.IN", label: "Life expectancy (years)", short: "Life expectancy", fmt: (v) => v.toFixed(1) + " yrs" },
};
const POP_SERIES = "SP.POP.TOTL";

const INCOME_ORDER = ["Low income", "Lower middle income", "Upper middle income", "High income"];
const INCOME_COLOURS = {
  "Low income": "#d95f02",
  "Lower middle income": "#e6ab02",
  "Upper middle income": "#1b9e77",
  "High income": "#2c5f9e",
};
const REGION_COLOURS = ["#2c5f9e", "#1b9e77", "#d95f02", "#7570b3", "#e6ab02", "#66a61e", "#a6761d", "#666666"];

let records = [];          
let years = [];            
const state = { region: "all", income: "all", indicator: "gdp", year: 2023 };
const charts = {};

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift().map((h) => h.replace(/^﻿/, "").trim());
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

async function loadCSV(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  return parseCSV(await res.text());
}

function buildRecords(wdiRows, classRows) {
  const byCode = new Map();
  for (const c of classRows) {
    if (c["Region"] && c["Income group"]) {
      byCode.set(c["Code"], {
        name: c["Economy"], code: c["Code"], region: c["Region"],
        income: c["Income group"], lending: c["Lending category"] || "Not classified",
        gdp: {}, life: {}, pop: {},
      });
    }
  }
  const yearCols = Object.keys(wdiRows[0]).filter((k) => /^\d{4} \[YR\d{4}\]$/.test(k));
  years = yearCols.map((k) => parseInt(k.slice(0, 4), 10));
  const target = { [INDICATORS.gdp.series]: "gdp", [INDICATORS.life.series]: "life", [POP_SERIES]: "pop" };

  for (const row of wdiRows) {
    const rec = byCode.get(row["Country Code"]);
    const key = target[row["Series Code"]];
    if (!rec || !key) continue;
    yearCols.forEach((col, i) => {
      const raw = row[col];
      if (raw !== "" && raw !== "..") {
        const v = Number(raw);
        if (Number.isFinite(v)) rec[key][years[i]] = v;
      }
    });
  }
  return [...byCode.values()];
}

const sum = (a) => a.reduce((s, x) => s + x, 0);
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function weightedMean(recs, ind, year) {
  let num = 0, den = 0;
  for (const r of recs) {
    const v = r[ind][year], p = r.pop[year];
    if (v != null && p != null) { num += v * p; den += p; }
  }
  return den ? num / den : null;
}

function filtered() {
  return records.filter((r) =>
    (state.region === "all" || r.region === state.region) &&
    (state.income === "all" || r.income === state.income));
}

const $ = (id) => document.getElementById(id);
const fmtPop = (n) => n >= 1e9 ? (n / 1e9).toFixed(2) + " bn" : n >= 1e6 ? (n / 1e6).toFixed(1) + " m" : Math.round(n).toLocaleString("en-ZA");

function selectionLabel() {
  const parts = [];
  if (state.region !== "all") parts.push(state.region);
  if (state.income !== "all") parts.push(state.income);
  return parts.length ? parts.join(", ") : "All economies";
}

function renderKPIs(recs) {
  const ind = INDICATORS[state.indicator], y = state.year;
  const withData = recs.filter((r) => r[state.indicator][y] != null);
  const values = withData.map((r) => r[state.indicator][y]);
  const pops = recs.map((r) => r.pop[y]).filter((v) => v != null);

  $("kpi-count").textContent = withData.length;
  $("kpi-count-sub").textContent = `of ${recs.length} in selection`;

  $("kpi-pop").textContent = pops.length ? fmtPop(sum(pops)) : "n/a";
  $("kpi-pop-sub").textContent = `in ${y}`;

  const med = median(values);
  $("kpi-median-title").textContent = `Median ${ind.short.toLowerCase()}`;
  $("kpi-median").textContent = med == null ? "n/a" : ind.fmt(med);
  $("kpi-median-sub").textContent = values.length ? `Mean ${ind.fmt(sum(values) / values.length)} · ${y}` : `No data for ${y}`;

  const base = years[0];
  const now = weightedMean(recs, state.indicator, y), then = weightedMean(recs, state.indicator, base);
  $("kpi-change-title").textContent = `Change since ${base}`;
  if (now != null && then != null && y !== base) {
    const pct = ((now - then) / then) * 100;
    $("kpi-change").textContent = (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
    $("kpi-change-sub").textContent = `Weighted mean ${ind.fmt(then)} → ${ind.fmt(now)}`;
  } else {
    $("kpi-change").textContent = "n/a";
    $("kpi-change-sub").textContent = y === base ? "Choose a later year" : "Not enough data";
  }
}

function lineChart(recs) {
  const ind = INDICATORS[state.indicator];
  const allYears = [];
  for (let y = years[0]; y <= years[years.length - 1]; y++) allYears.push(y);
  const groups = INCOME_ORDER.filter((g) => recs.some((r) => r.income === g));
  charts.line.data.labels = allYears;
  charts.line.data.datasets = groups.map((g) => {
    const members = recs.filter((r) => r.income === g);
    return {
      label: g,
      data: allYears.map((y) => weightedMean(members, state.indicator, y)),
      borderColor: INCOME_COLOURS[g], backgroundColor: INCOME_COLOURS[g],
      borderWidth: 2, pointRadius: 2.5, tension: 0.25, spanGaps: true,
    };
  });
  charts.line.options.scales.y.title.text = ind.label;
  charts.line.update();
  $("t-line").textContent = `${ind.short} over time by income group (population-weighted) · ${selectionLabel()}`;
}

function barChart(recs) {
  const ind = INDICATORS[state.indicator], y = state.year;
  const top = recs.filter((r) => r[state.indicator][y] != null)
    .sort((a, b) => b[state.indicator][y] - a[state.indicator][y]).slice(0, 10);
  charts.bar.data.labels = top.map((r) => r.name);
  charts.bar.data.datasets = [{
    label: ind.label, data: top.map((r) => r[state.indicator][y]),
    backgroundColor: top.map((r) => INCOME_COLOURS[r.income]),
  }];
  charts.bar.options.scales.x.title.text = ind.label;
  charts.bar.update();
  $("t-bar").textContent = `Top 10 economies by ${ind.short}, ${y}`;
}

function doughnutChart(recs) {
  const y = state.year;
  const byIncome = state.income === "all";
  const key = byIncome ? "income" : "region";
  const totals = new Map();
  for (const r of recs) if (r.pop[y] != null) totals.set(r[key], (totals.get(r[key]) || 0) + r.pop[y]);
  let labels = [...totals.keys()];
  if (byIncome) labels = INCOME_ORDER.filter((g) => totals.has(g));
  const colours = labels.map((l, i) => byIncome ? INCOME_COLOURS[l] : REGION_COLOURS[i % REGION_COLOURS.length]);
  charts.doughnut.data.labels = labels;
  charts.doughnut.data.datasets = [{ data: labels.map((l) => totals.get(l)), backgroundColor: colours, borderColor: "#fff", borderWidth: 2 }];
  charts.doughnut.update();
  $("t-doughnut").textContent = `Population share by ${byIncome ? "income group" : "region"}, ${y}`;
}

function bubbleChart(recs) {
  const y = state.year;
  const pts = recs.filter((r) => r.gdp[y] != null && r.life[y] != null && r.pop[y] != null);
  const maxPop = Math.max(1, ...pts.map((r) => r.pop[y]));
  charts.bubble.data.datasets = INCOME_ORDER.filter((g) => pts.some((r) => r.income === g)).map((g) => ({
    label: g,
    data: pts.filter((r) => r.income === g).map((r) => ({
      x: r.gdp[y], y: r.life[y], r: 3 + 22 * Math.sqrt(r.pop[y] / maxPop), name: r.name, pop: r.pop[y],
    })),
    backgroundColor: INCOME_COLOURS[g] + "99", borderColor: INCOME_COLOURS[g],
  }));
  charts.bubble.update();
  $("t-bubble").textContent = `GDP per capita vs life expectancy, ${y} (bubble size = population)`;
}

function render() {
  const recs = filtered();
  const has = recs.length > 0;
  $("status").textContent = has ? `Showing ${recs.length} economies · ${selectionLabel()} · ${state.year}` : "No economies match this combination of filters.";
  $("status").className = "status";
  renderKPIs(recs);
  lineChart(recs); barChart(recs); doughnutChart(recs); bubbleChart(recs);
}

function initCharts() {
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = "#33404d";
  const legend = { position: "bottom", labels: { boxWidth: 12 } };

  charts.line = new Chart($("c-line"), {
    type: "line", data: { labels: [], datasets: [] },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.y == null ? "n/a" : INDICATORS[state.indicator].fmt(c.parsed.y)}` } } },
      scales: { y: { title: { display: true, text: "" }, beginAtZero: false } },
    },
  });

  charts.bar = new Chart($("c-bar"), {
    type: "bar", data: { labels: [], datasets: [] },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => " " + INDICATORS[state.indicator].fmt(c.parsed.x) } } },
      scales: { x: { title: { display: true, text: "" }, beginAtZero: true } },
    },
  });

  charts.doughnut = new Chart($("c-doughnut"), {
    type: "doughnut", data: { labels: [], datasets: [] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "55%",
      plugins: { legend, tooltip: { callbacks: { label: (c) => {
        const total = sum(c.dataset.data);
        return ` ${c.label}: ${fmtPop(c.parsed)} (${((c.parsed / total) * 100).toFixed(1)}%)`;
      } } } },
    },
  });

  charts.bubble = new Chart($("c-bubble"), {
    type: "bubble", data: { datasets: [] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend, tooltip: { callbacks: { label: (c) => {
        const d = c.raw;
        return ` ${d.name}: $${Math.round(d.x).toLocaleString("en-ZA")}, ${d.y.toFixed(1)} yrs, pop ${fmtPop(d.pop)}`;
      } } } },
      scales: {
        x: { type: "logarithmic", title: { display: true, text: "GDP per capita (US$, log scale)" } },
        y: { title: { display: true, text: "Life expectancy (years)" } },
      },
    },
  });
}

function fillSelect(el, values, allLabel) {
  el.innerHTML = "";
  if (allLabel) el.add(new Option(allLabel, "all"));
  for (const v of values) el.add(new Option(v, v));
}

function initControls() {
  fillSelect($("f-region"), [...new Set(records.map((r) => r.region))].sort(), "All regions");
  fillSelect($("f-income"), INCOME_ORDER, "All income groups");
  const yearSel = $("f-year");
  [...years].reverse().forEach((y) => yearSel.add(new Option(y, y)));
  if (!years.includes(state.year)) state.year = years[years.length - 1];
  yearSel.value = state.year;

  $("f-region").addEventListener("change", (e) => { state.region = e.target.value; render(); });
  $("f-income").addEventListener("change", (e) => { state.income = e.target.value; render(); });
  $("f-indicator").addEventListener("change", (e) => { state.indicator = e.target.value; render(); });
  yearSel.addEventListener("change", (e) => { state.year = parseInt(e.target.value, 10); render(); });
  $("f-reset").addEventListener("click", () => {
    Object.assign(state, { region: "all", income: "all", indicator: "gdp", year: 2023 });
    $("f-region").value = "all"; $("f-income").value = "all";
    $("f-indicator").value = "gdp"; yearSel.value = state.year;
    render();
  });
}

function noteGaps() {
  const missing = [];
  for (let y = years[0]; y <= years[years.length - 1]; y++) if (!years.includes(y)) missing.push(y);
  $("gap-note").textContent = missing.length
    ? `Note: the dataset has no columns for ${missing[0]}–${missing[missing.length - 1]}, so trend lines join the points either side of that gap.`
    : "";
}

(async function main() {
  try {
    const [wdi, classes] = await Promise.all([loadCSV(FILES.wdi), loadCSV(FILES.classes)]);
    records = buildRecords(wdi, classes);
    initCharts();
    initControls();
    noteGaps();
    render();
  } catch (err) {
    const s = $("status");
    s.textContent = "Could not load the data: " + err.message + ". If you opened index.html directly from disk, run a local server (python -m http.server) instead.";
    s.className = "status error";
  }
})();
