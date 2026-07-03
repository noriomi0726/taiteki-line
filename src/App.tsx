import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type WaveType =
  | "履歴不足"
  | "軽め安定型"
  | "重め安定型"
  | "荒波型"
  | "右肩重化型"
  | "右肩軽化型"
  | "乱高下型";

type LineKind = "勝負ライン" | "撤退ライン" | "警戒ライン" | "危険ライン";

type LineInfo = {
  kind: LineKind;
  spins: number;
  tone: string;
  comment: string;
};

type SavedState = {
  denominator: string;
  currentSpins: string;
  history: number[];
  baseRate: string;
};

const STORAGE_KEY = "taiteki-line-state";
const DEFAULT_STATE: SavedState = {
  denominator: "319.7",
  currentSpins: "0",
  history: [],
  baseRate: "15",
};

const lineOrder: LineKind[] = ["勝負ライン", "撤退ライン", "警戒ライン", "危険ライン"];

const lineStyles: Record<LineKind, string> = {
  勝負ライン: "border-emerald-400/40 bg-emerald-400/10 text-emerald-100",
  撤退ライン: "border-amber-300/50 bg-amber-300/10 text-amber-100",
  警戒ライン: "border-orange-400/50 bg-orange-400/10 text-orange-100",
  危険ライン: "border-rose-400/60 bg-rose-500/15 text-rose-100",
};

function loadSavedState(): SavedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<SavedState>;
    return {
      denominator: parsed.denominator ?? DEFAULT_STATE.denominator,
      currentSpins: parsed.currentSpins ?? DEFAULT_STATE.currentSpins,
      history: Array.isArray(parsed.history)
        ? parsed.history.filter((value) => Number.isFinite(value) && value > 0)
        : [],
      baseRate: parsed.baseRate ?? DEFAULT_STATE.baseRate,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function toNumber(value: string): number {
  return Number.parseFloat(value);
}

function formatNumber(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "-";
  return value.toLocaleString("ja-JP", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatMaybe(value: number | null | undefined, suffix = "", digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "履歴なし";
  return `${formatNumber(value, digits)}${suffix}`;
}

function formatPercent(value: number, digits = 1): string {
  return `${formatNumber(value * 100, digits)}%`;
}

function formatYen(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0円";
  return `約${Math.round(value).toLocaleString("ja-JP")}円`;
}

function expectation(spins: number, denominator: number): number {
  if (spins <= 0 || denominator <= 0) return 0;
  const p = 1 / denominator;
  return 1 - Math.pow(1 - p, spins);
}

function expectedLine(target: number, denominator: number): number {
  const p = 1 / denominator;
  return Math.round(Math.log(1 - target) / Math.log(1 - p));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentileNearest(values: number[], percentile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * percentile) - 1);
  return sorted[index];
}

function clampLine(value: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(value, min), max));
}

function classifyVolatility(cv: number | null): "履歴不足" | "安定" | "やや荒れ" | "荒れ" | "大荒れ" {
  if (cv === null || !Number.isFinite(cv)) return "履歴不足";
  if (cv < 0.35) return "安定";
  if (cv < 0.65) return "やや荒れ";
  if (cv < 0.95) return "荒れ";
  return "大荒れ";
}

function trendLabel(recentAvg: number | null, average: number | null): "履歴不足" | "軽め" | "標準" | "重め" {
  if (recentAvg === null || average === null) return "履歴不足";
  if (recentAvg < average * 0.9) return "軽め";
  if (recentAvg > average * 1.1) return "重め";
  return "標準";
}

function classifyWave(history: number[], denominator: number, average: number | null, stdDev: number | null, cv: number | null): WaveType {
  if (history.length < 3 || average === null || stdDev === null || cv === null) return "履歴不足";
  const last3 = history.slice(-3);
  const recentAvg = last3.reduce((sum, value) => sum + value, 0) / last3.length;
  const increasing = last3[0] < last3[1] && last3[1] < last3[2];
  const decreasing = last3[0] > last3[1] && last3[1] > last3[2];
  const hasLight = history.some((value) => value <= denominator * 0.55);
  const hasDeep = history.some((value) => value >= denominator * 1.55);
  const diffs = history.slice(1).map((value, index) => value - history[index]);
  const signChanges = diffs.slice(1).filter((value, index) => Math.sign(value) !== Math.sign(diffs[index])).length;
  const averageDiff = diffs.reduce((sum, value) => sum + Math.abs(value), 0) / Math.max(1, diffs.length);
  const alternating = history.length >= 4 && signChanges >= Math.max(2, diffs.length - 1) && averageDiff > denominator * 0.7;
  const highVolatility = cv >= 0.75 || stdDev >= denominator * 0.8;
  const lowVolatility = cv < 0.45;

  if (alternating) return "乱高下型";
  if (recentAvg > average * 1.1 && increasing) return "右肩重化型";
  if (recentAvg < average * 0.9 && decreasing) return "右肩軽化型";
  if (highVolatility || (hasLight && hasDeep)) return "荒波型";
  if (average <= denominator && lowVolatility) return "軽め安定型";
  if (average > denominator && lowVolatility) return "重め安定型";
  return average <= denominator ? "軽め安定型" : "重め安定型";
}

function correctionForBattle(waveType: WaveType): number {
  switch (waveType) {
    case "右肩重化型":
    case "荒波型":
    case "乱高下型":
      return 0.9;
    case "軽め安定型":
    case "右肩軽化型":
      return 1.08;
    case "重め安定型":
      return 0.98;
    default:
      return 1;
  }
}

function retreatCoefficient(waveType: WaveType): number {
  switch (waveType) {
    case "右肩重化型":
    case "荒波型":
    case "乱高下型":
      return 0.25;
    case "重め安定型":
      return 0.3;
    case "軽め安定型":
    case "右肩軽化型":
      return 0.4;
    default:
      return 0.3;
  }
}

function statusFor(current: number, lines: Record<LineKind, number>) {
  if (current < lines.勝負ライン) {
    return {
      label: "勝負圏内",
      style: "border-emerald-300/50 bg-emerald-400/15 text-emerald-100",
      text: "現在回転数は勝負ライン内です。履歴上はまだ見る余地があります。",
    };
  }
  if (current < lines.撤退ライン) {
    return {
      label: "短期勝負",
      style: "border-sky-300/50 bg-sky-400/15 text-sky-100",
      text: "勝負ラインを超えています。追う場合は撤退ラインまでの短期勝負。",
    };
  }
  if (current < lines.警戒ライン) {
    return {
      label: "撤退判断",
      style: "border-amber-300/60 bg-amber-300/15 text-amber-100",
      text: "撤退ラインを超えています。履歴上の目安から外れています。",
    };
  }
  if (current < lines.危険ライン) {
    return {
      label: "深追い警戒",
      style: "border-orange-400/60 bg-orange-400/15 text-orange-100",
      text: "警戒ラインを超えています。深追い領域です。",
    };
  }
  return {
    label: "見送り",
    style: "border-rose-400/70 bg-rose-500/20 text-rose-100",
    text: "危険ラインを超えています。低投資目的から外れています。",
  };
}

function cardComment(kind: LineKind, spins: number, current: number) {
  const remaining = spins - current;
  if (kind === "勝負ライン") return remaining > 0 ? "第一判断地点。ここまでは波形上の余地を確認。" : "勝負ライン到達済み。短期判断へ移行。";
  if (kind === "撤退ライン") return remaining > 0 ? "追う場合の降りる場所。超過後は根拠を絞る。" : "撤退ライン到達済み。継続理由を再確認。";
  if (kind === "警戒ライン") return remaining > 0 ? "深追い手前の警戒地点。投資の伸びを意識。" : "警戒ライン到達済み。深追い領域。";
  return remaining > 0 ? "95%ライン。撤退推奨ではなく危険領域の目印。" : "危険ライン超過。低投資目的から外れやすい位置。";
}

function Section({ title, children, muted = false }: { title: string; children: React.ReactNode; muted?: boolean }) {
  return (
    <section className={`rounded-lg border p-4 shadow-glow sm:p-5 ${muted ? "border-white/8 bg-white/[0.035]" : "border-white/10 bg-slate-950/55"}`}>
      <h2 className="mb-4 text-lg font-semibold tracking-normal text-white sm:text-xl">{title}</h2>
      {children}
    </section>
  );
}

function MetricCard({ label, value, note, tone = "border-white/10 bg-white/[0.04]" }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div className={`rounded-lg border p-3 ${tone}`}>
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold leading-tight text-white">{value}</p>
      {note ? <p className="mt-1 text-xs text-slate-400">{note}</p> : null}
    </div>
  );
}

function App() {
  const saved = useMemo(loadSavedState, []);
  const [denominator, setDenominator] = useState(saved.denominator);
  const [currentSpins, setCurrentSpins] = useState(saved.currentSpins);
  const [history, setHistory] = useState<number[]>(saved.history);
  const [baseRate, setBaseRate] = useState(saved.baseRate);
  const [newHistoryValue, setNewHistoryValue] = useState("");
  const [historyError, setHistoryError] = useState("");

  useEffect(() => {
    const nextState: SavedState = { denominator, currentSpins, history, baseRate };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  }, [denominator, currentSpins, history, baseRate]);

  const denominatorValue = toNumber(denominator);
  const currentValue = toNumber(currentSpins);
  const baseRateValue = toNumber(baseRate);

  const errors = useMemo(() => {
    const next: string[] = [];
    if (denominator.trim() === "" || !Number.isFinite(denominatorValue)) next.push("大当たり確率分母を入力してください。");
    else if (denominatorValue <= 0) next.push("大当たり確率分母は0より大きい値にしてください。");
    if (currentSpins.trim() === "" || !Number.isFinite(currentValue)) next.push("現在回転数を入力してください。");
    else if (currentValue < 0) next.push("現在回転数は0以上にしてください。");
    if (baseRate.trim() === "" || !Number.isFinite(baseRateValue)) next.push("基準回転率を入力してください。");
    else if (baseRateValue <= 0) next.push("基準回転率は0より大きい値にしてください。");
    if (history.some((value) => value <= 0 || !Number.isFinite(value))) next.push("初当たり履歴は0より大きい値だけを入力してください。");
    return next;
  }, [baseRate, baseRateValue, currentSpins, currentValue, denominator, denominatorValue, history]);

  const analysis = useMemo(() => {
    const count = history.length;
    const total = history.reduce((sum, value) => sum + value, 0);
    const average = count > 0 ? total / count : null;
    const med = median(history);
    const min = count > 0 ? Math.min(...history) : null;
    const max = count > 0 ? Math.max(...history) : null;
    const stdDev =
      count > 0 && average !== null
        ? Math.sqrt(history.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) / count)
        : null;
    const cv = average && stdDev !== null ? stdDev / average : null;
    const recent3 = count >= 3 ? history.slice(-3).reduce((sum, value) => sum + value, 0) / 3 : null;
    const q75 = percentileNearest(history, 0.75);
    const diff = average !== null ? average - denominatorValue : null;
    const nominalRatio = average !== null ? (average / denominatorValue) * 100 : null;
    const trend = trendLabel(recent3, average);
    const volatility = classifyVolatility(cv);
    const waveType = classifyWave(history, denominatorValue, average, stdDev, cv);
    const graphData = history.map((value, index) => ({
      count: `${index + 1}回目`,
      spin: value,
      cumulative: history.slice(0, index + 1).reduce((sum, item) => sum + item, 0),
      nominal: denominatorValue,
    }));
    return {
      count,
      total,
      average,
      median: med,
      min,
      max,
      stdDev,
      cv,
      recent3,
      q75,
      diff,
      nominalRatio,
      trend,
      volatility,
      waveType,
      graphData,
    };
  }, [denominatorValue, history]);

  const nominalLines = useMemo(() => {
    if (errors.length > 0 || denominatorValue <= 0) {
      return { 50: 0, 70: 0, 80: 0, 90: 0, 95: 0 };
    }
    return {
      50: expectedLine(0.5, denominatorValue),
      70: expectedLine(0.7, denominatorValue),
      80: expectedLine(0.8, denominatorValue),
      90: expectedLine(0.9, denominatorValue),
      95: expectedLine(0.95, denominatorValue),
    };
  }, [denominatorValue, errors.length]);

  const lines = useMemo<Record<LineKind, number>>(() => {
    if (errors.length > 0) {
      return { 勝負ライン: 0, 撤退ライン: 0, 警戒ライン: 0, 危険ライン: 0 };
    }

    if (analysis.count === 0) {
      return {
        勝負ライン: nominalLines[70],
        撤退ライン: nominalLines[80],
        警戒ライン: nominalLines[90],
        危険ライン: nominalLines[95],
      };
    }

    if (analysis.count < 3) {
      const simpleAverage = analysis.average ?? denominatorValue;
      const battle = clampLine(nominalLines[70] * 0.75 + simpleAverage * 0.25, nominalLines[50], nominalLines[90]);
      const retreat = clampLine(nominalLines[80] * 0.8 + simpleAverage * 0.2, battle + 20, nominalLines[90]);
      return {
        勝負ライン: battle,
        撤退ライン: retreat,
        警戒ライン: nominalLines[90],
        危険ライン: nominalLines[95],
      };
    }

    const avg = analysis.average ?? denominatorValue;
    const med = analysis.median ?? avg;
    const recent3 = analysis.recent3 ?? avg;
    const stdDev = analysis.stdDev ?? 0;
    const battleBase = (avg * 0.55 + med * 0.25 + recent3 * 0.2) * correctionForBattle(analysis.waveType);
    const candidateRetreat = avg + stdDev * retreatCoefficient(analysis.waveType);
    const retreat = Math.round(Math.min(candidateRetreat, nominalLines[90]));
    const battle = Math.round(Math.min(battleBase, Math.max(nominalLines[50], retreat * 0.95)));
    const alertSource = analysis.q75 ?? nominalLines[90];
    const alert = Math.round(Math.min(alertSource, nominalLines[90]));

    return {
      勝負ライン: battle,
      撤退ライン: retreat,
      警戒ライン: alert,
      危険ライン: nominalLines[95],
    };
  }, [analysis, denominatorValue, errors.length, nominalLines]);

  const currentStatus = errors.length === 0 ? statusFor(currentValue, lines) : null;

  const lineCards = useMemo<LineInfo[]>(() => {
    return lineOrder.map((kind) => ({
      kind,
      spins: lines[kind],
      tone: lineStyles[kind],
      comment: cardComment(kind, lines[kind], currentValue),
    }));
  }, [currentValue, lines]);

  const range = useMemo(() => {
    if (analysis.count < 3 || analysis.median === null || analysis.average === null) return null;
    const lower = Math.round(analysis.median);
    let upper = lines.撤退ライン;
    if (analysis.waveType === "軽め安定型") upper = Math.round(analysis.average);
    if (analysis.waveType === "右肩重化型") upper = Math.round(analysis.average);
    return { lower: Math.min(lower, upper), upper: Math.max(lower, upper) };
  }, [analysis.average, analysis.count, analysis.median, analysis.waveType, lines.撤退ライン]);

  const mainComment = useMemo(() => {
    if (errors.length > 0) return "入力値を確認すると、現在地とラインを再計算できます。";
    if (analysis.count === 0) {
      return "履歴がないため、公称確率ベースの簡易判定です。勝てる台の判定ではなく、現在地と深さを確認するための目安です。";
    }
    const medianText = analysis.median !== null && currentValue > analysis.median ? `現在${formatNumber(currentValue)}回転は履歴中央値${formatNumber(analysis.median)}回転を超過しています。` : `現在${formatNumber(currentValue)}回転は履歴中央値${formatMaybe(analysis.median, "回転")}付近と比較して確認中です。`;
    return `${medianText} 波形は${analysis.waveType}、直近傾向は${analysis.trend}、荒れ度は${analysis.volatility}です。撤退ライン${formatNumber(lines.撤退ライン)}回転を超えたら撤退判断。警戒ライン${formatNumber(lines.警戒ライン)}回転超えは深追い領域です。`;
  }, [analysis.median, analysis.count, analysis.trend, analysis.volatility, analysis.waveType, currentValue, errors.length, lines.撤退ライン, lines.警戒ライン]);

  const addHistory = () => {
    const value = Number.parseInt(newHistoryValue, 10);
    if (newHistoryValue.trim() === "" || !Number.isFinite(value)) {
      setHistoryError("初当たり回転数を入力してください。");
      return;
    }
    if (value <= 0) {
      setHistoryError("初当たり履歴には0より大きい値を入力してください。");
      return;
    }
    setHistory((prev) => [...prev, value]);
    setNewHistoryValue("");
    setHistoryError("");
  };

  const deleteHistory = (index: number) => {
    setHistory((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  };

  const resetAll = () => {
    setDenominator(DEFAULT_STATE.denominator);
    setCurrentSpins(DEFAULT_STATE.currentSpins);
    setHistory([]);
    setBaseRate(DEFAULT_STATE.baseRate);
    setNewHistoryValue("");
    setHistoryError("");
  };

  const reachedMedian = analysis.median !== null && currentValue > analysis.median;
  const retreatRemaining = Math.max(0, lines.撤退ライン - currentValue);
  const retreatInvestment = retreatRemaining / Math.max(baseRateValue, 1) * 1000;
  const theoreticalMedian = nominalLines[50];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 px-3 py-4 sm:px-5 lg:py-8">
      <header className="rounded-lg border border-white/10 bg-slate-950/70 p-5 shadow-glow sm:p-7">
        <p className="text-sm font-medium text-cyan-200">波形を見る。現在地を知る。ラインで降りる。</p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-4xl font-black tracking-normal text-white sm:text-5xl">撤退ライン</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
              期待度を見る。波形を見る。でも、撤退ラインで降りる。大当たりを予測・保証せず、入力履歴から現在地と判断ラインを整理します。
            </p>
          </div>
          <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100">
            公称確率は理論の地図。履歴は今日の波形。
          </div>
        </div>
      </header>

      <Section title="1. 基本入力">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block">
            <span className="text-sm text-slate-300">大当たり確率分母</span>
            <input
              className="mt-2 w-full rounded-lg border border-white/10 bg-slate-900 px-4 py-4 text-2xl font-bold text-white outline-none ring-cyan-300/30 focus:ring-4"
              inputMode="decimal"
              type="number"
              min="0"
              step="0.1"
              value={denominator}
              onChange={(event) => setDenominator(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-sm text-slate-300">現在回転数</span>
            <input
              className="mt-2 w-full rounded-lg border border-cyan-300/25 bg-slate-900 px-4 py-4 text-2xl font-bold text-white outline-none ring-cyan-300/30 focus:ring-4"
              inputMode="numeric"
              type="number"
              min="0"
              step="1"
              value={currentSpins}
              onChange={(event) => setCurrentSpins(event.target.value)}
            />
          </label>
          <div className="flex items-end gap-2">
            <button className="h-[62px] flex-1 rounded-lg border border-white/10 bg-white/10 px-4 text-sm font-semibold text-white hover:bg-white/15" onClick={() => setCurrentSpins("0")}>
              現在回転数のみリセット
            </button>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-white/10 bg-white/[0.03] p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <label className="block">
              <span className="text-sm text-slate-300">初当たり履歴を追加</span>
              <input
                className="mt-2 w-full rounded-lg border border-white/10 bg-slate-900 px-4 py-4 text-xl font-bold text-white outline-none ring-cyan-300/30 focus:ring-4"
                inputMode="numeric"
                type="number"
                min="1"
                step="1"
                placeholder="例：403"
                value={newHistoryValue}
                onChange={(event) => setNewHistoryValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") addHistory();
                }}
              />
            </label>
            <button className="self-end rounded-lg bg-cyan-300 px-6 py-4 text-base font-bold text-slate-950 hover:bg-cyan-200" onClick={addHistory}>
              追加
            </button>
          </div>
          {historyError ? <p className="mt-3 rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{historyError}</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {history.length === 0 ? (
              <p className="text-sm text-slate-400">初当たり履歴なし</p>
            ) : (
              history.map((value, index) => {
                const cumulative = history.slice(0, index + 1).reduce((sum, item) => sum + item, 0);
                return (
                  <div key={`${value}-${index}`} className="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2">
                    <span className="text-sm text-white">
                      {index + 1}回目：{formatNumber(value)}回転 / 累積{formatNumber(cumulative)}回転
                    </span>
                    <button className="rounded-md border border-rose-300/30 px-2 py-1 text-xs text-rose-100 hover:bg-rose-500/20" onClick={() => deleteHistory(index)}>
                      削除
                    </button>
                  </div>
                );
              })
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="rounded-lg border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-white hover:bg-white/15" onClick={() => setHistory([])}>
              初当たり履歴をリセット
            </button>
            <button className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-100 hover:bg-rose-500/20" onClick={resetAll}>
              全データをリセット
            </button>
          </div>
        </div>

        {errors.length > 0 ? (
          <div className="mt-4 space-y-2">
            {errors.map((error) => (
              <p key={error} className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
                {error}
              </p>
            ))}
          </div>
        ) : null}
      </Section>

      <Section title="2. 現在判定">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="現在回転数" value={`${formatNumber(currentValue)}回転`} tone="border-cyan-300/35 bg-cyan-300/10" />
          <MetricCard label="公称確率" value={`1/${formatNumber(denominatorValue, 1)}`} />
          <MetricCard label="撤退ラインまで" value={`${formatNumber(retreatRemaining)}回転`} note={`目安投資 ${formatYen(retreatInvestment)}`} tone="border-amber-300/40 bg-amber-300/10" />
          <MetricCard label="中央値超過" value={reachedMedian ? "中央値超過" : "未超過"} note={analysis.median ? `中央値 ${formatNumber(analysis.median)}回転` : "履歴なし"} />
        </div>
        {currentStatus ? (
          <div className={`mt-4 rounded-lg border p-4 ${currentStatus.style}`}>
            <p className="text-3xl font-black">{currentStatus.label}</p>
            <p className="mt-2 text-sm leading-6">{currentStatus.text}</p>
          </div>
        ) : null}
        <p className="mt-4 rounded-lg border border-white/10 bg-white/[0.035] p-4 text-sm leading-6 text-slate-200">{mainComment}</p>
      </Section>

      <Section title="3. 勝負・撤退ラインカード">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {lineCards.map((line) => {
            const remaining = line.spins - currentValue;
            const nowExpectation = remaining > 0 ? expectation(remaining, denominatorValue) : null;
            const investment = Math.max(0, remaining) / Math.max(1, baseRateValue) * 1000;
            const lineExpectation = expectation(line.spins, denominatorValue);
            const noHit = nowExpectation === null ? null : 1 - nowExpectation;
            return (
              <article key={line.kind} className={`rounded-lg border p-4 ${line.tone}`}>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-lg font-bold">{line.kind}</h3>
                  <span className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-xs">{line.kind === "危険ライン" ? "95%地点" : "判断線"}</span>
                </div>
                <p className="mt-3 text-4xl font-black text-white">{formatNumber(line.spins)}<span className="text-base font-semibold text-slate-300">回転</span></p>
                <div className="mt-4 rounded-lg bg-black/20 p-3">
                  <p className="text-xs text-slate-300">ライン期待度</p>
                  <p className="text-3xl font-black text-white">約{formatPercent(lineExpectation)}</p>
                </div>
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between gap-3"><dt className="text-slate-300">残り</dt><dd className="font-semibold text-white">{remaining > 0 ? `${formatNumber(remaining)}回転` : "到達済み"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-300">今から期待度</dt><dd className="font-semibold text-white">{nowExpectation === null ? "到達済み" : `約${formatPercent(nowExpectation)}`}</dd></div>
                  {line.kind === "撤退ライン" ? (
                    <div className="flex justify-between gap-3"><dt className="text-slate-300">当たらない確率</dt><dd className="font-semibold text-white">{noHit === null ? "到達済み" : `約${formatPercent(noHit)}`}</dd></div>
                  ) : null}
                  <div className="flex justify-between gap-3"><dt className="text-slate-300">目安投資</dt><dd className="font-semibold text-white">{formatYen(investment)}</dd></div>
                </dl>
                <p className="mt-4 text-sm leading-6 text-slate-200">{line.comment}</p>
              </article>
            );
          })}
        </div>
        <div className="mt-4 rounded-lg border border-amber-300/30 bg-amber-300/10 p-4 text-sm leading-6 text-amber-50">
          撤退ライン{formatNumber(lines.撤退ライン)}回転は、ライン期待度約{formatPercent(expectation(lines.撤退ライン, denominatorValue))}地点です。現在{formatNumber(currentValue)}回転から撤退ラインまでの今から期待度は
          {retreatRemaining > 0 ? `約${formatPercent(expectation(retreatRemaining, denominatorValue))}` : "到達済み"}です。
          {retreatRemaining > 0 ? ` 一方で、約${formatPercent(1 - expectation(retreatRemaining, denominatorValue))}は当たらず撤退ラインに到達する計算です。` : " "}
          撤退ライン超過後は追う根拠が弱くなります。
        </div>
      </Section>

      <Section title="4. 波形予測">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="波形タイプ" value={analysis.waveType} />
          <MetricCard label="直近傾向" value={analysis.trend} />
          <MetricCard label="荒れ度" value={analysis.volatility} />
          <MetricCard label="本命レンジ" value={range ? `${formatNumber(range.lower)}〜${formatNumber(range.upper)}回転` : "履歴不足"} />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {lineOrder.map((kind) => (
            <MetricCard key={kind} label={kind} value={`${formatNumber(lines[kind])}回転`} tone={lineStyles[kind]} />
          ))}
        </div>
        <p className="mt-4 rounded-lg border border-white/10 bg-white/[0.035] p-4 text-sm leading-6 text-slate-200">
          {analysis.count < 3
            ? "履歴3件未満のため、公称確率を強めに反映した簡易判定です。初当たり履歴が増えると波形判定を有効化します。"
            : `${analysis.waveType}・直近${analysis.trend}の波形です。追う場合は勝負ライン${formatNumber(lines.勝負ライン)}回転付近を第一判断、撤退ライン${formatNumber(lines.撤退ライン)}回転を超えたら撤退判断。警戒ライン${formatNumber(lines.警戒ライン)}回転超えは深追い領域です。${analysis.waveType === "荒波型" ? "軽い初当たり決め打ちはせず短期勝負で確認してください。" : ""}${analysis.waveType === "乱高下型" ? "振れが大きいため撤退ライン厳守が前提です。" : ""}${analysis.waveType === "右肩軽化型" ? "直近は軽化していますが、次回転の確率そのものは変わりません。" : ""}`}
        </p>
      </Section>

      <Section title="5. 次回初当たり目安">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="理論中央値" value={`${formatNumber(theoreticalMedian)}回転`} />
          <MetricCard label="実績中央値" value={formatMaybe(analysis.median, "回転")} />
          <MetricCard label="実績平均" value={formatMaybe(analysis.average, "回転", 1)} />
          <MetricCard label="直近3回平均" value={formatMaybe(analysis.recent3, "回転", 1)} />
          <MetricCard label="本命レンジ" value={range ? `${formatNumber(range.lower)}〜${formatNumber(range.upper)}回転` : "履歴不足"} />
          <MetricCard label="勝負ライン" value={`${formatNumber(lines.勝負ライン)}回転`} tone={lineStyles.勝負ライン} />
          <MetricCard label="撤退ライン" value={`${formatNumber(lines.撤退ライン)}回転`} tone={lineStyles.撤退ライン} />
        </div>
      </Section>

      <Section title="6. 波形分析">
        <div className="mb-4 rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-slate-200">
          初当たり履歴：{history.length ? history.map((value) => formatNumber(value)).join(" → ") : "履歴なし"}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="初当たり回数" value={analysis.count ? `${formatNumber(analysis.count)}回` : "履歴なし"} />
          <MetricCard label="累積回転数" value={analysis.count ? `${formatNumber(analysis.total)}回転` : "履歴なし"} />
          <MetricCard label="実績初当たり確率" value={analysis.average ? `1/${formatNumber(analysis.average, 1)}` : "履歴なし"} />
          <MetricCard label="実績平均初当たり" value={formatMaybe(analysis.average, "回転", 1)} />
          <MetricCard label="実績中央値" value={formatMaybe(analysis.median, "回転")} />
          <MetricCard label="最短初当たり" value={formatMaybe(analysis.min, "回転")} />
          <MetricCard label="最大ハマり" value={formatMaybe(analysis.max, "回転")} />
          <MetricCard label="標準偏差" value={formatMaybe(analysis.stdDev, "", 1)} />
          <MetricCard label="変動係数" value={analysis.cv !== null ? formatNumber(analysis.cv, 2) : "履歴なし"} />
          <MetricCard label="直近3回平均" value={formatMaybe(analysis.recent3, "回転", 1)} />
          <MetricCard label="履歴75%ライン" value={formatMaybe(analysis.q75, "回転")} />
          <MetricCard label="公称との差" value={analysis.diff !== null ? `${analysis.diff >= 0 ? "+" : ""}${formatNumber(analysis.diff, 1)}回転` : "履歴なし"} />
          <MetricCard label="公称比率" value={analysis.nominalRatio !== null ? `${formatNumber(analysis.nominalRatio, 1)}%` : "履歴なし"} note={analysis.average === null ? undefined : analysis.average <= denominatorValue ? "公称より軽い" : "公称より重い"} />
          <MetricCard label="荒れ度" value={analysis.volatility} />
          <MetricCard label="直近傾向" value={analysis.trend} />
          <MetricCard label="波形タイプ" value={analysis.waveType} />
        </div>
      </Section>

      <Section title="7. 初当たり履歴グラフ">
        {history.length === 0 ? (
          <p className="text-sm text-slate-400">履歴が空のため、公称確率ベースの簡易判定のみ表示しています。</p>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analysis.graphData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#334155" strokeDasharray="4 4" />
                <XAxis dataKey="count" stroke="#cbd5e1" tick={{ fontSize: 12 }} />
                <YAxis stroke="#cbd5e1" tick={{ fontSize: 12 }} />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8 }} />
                <ReferenceLine y={denominatorValue} stroke="#22d3ee" strokeDasharray="6 4" label={{ value: `公称 ${formatNumber(denominatorValue, 1)}`, fill: "#67e8f9", fontSize: 12 }} />
                <Line type="monotone" dataKey="spin" name="初当たり回転数" stroke="#facc15" strokeWidth={3} dot={{ r: 5 }} activeDot={{ r: 7 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>

      <Section title="8. 累積回転数グラフ">
        {history.length === 0 ? (
          <p className="text-sm text-slate-400">履歴が増えると、入力順の累積推移を表示します。</p>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analysis.graphData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#334155" strokeDasharray="4 4" />
                <XAxis dataKey="count" stroke="#cbd5e1" tick={{ fontSize: 12 }} />
                <YAxis stroke="#cbd5e1" tick={{ fontSize: 12 }} />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8 }} />
                <Line type="monotone" dataKey="cumulative" name="累積回転数" stroke="#34d399" strokeWidth={3} dot={{ r: 5 }} activeDot={{ r: 7 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>

      <Section title="9. 公称確率ライン" muted>
        <p className="mb-3 text-sm text-slate-400">参考：公称確率ライン。95%ラインは撤退推奨ではなく、危険ラインとして扱います。</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <MetricCard label="50%ライン" value={`${formatNumber(nominalLines[50])}回転`} />
          <MetricCard label="70%ライン" value={`${formatNumber(nominalLines[70])}回転`} />
          <MetricCard label="80%ライン" value={`${formatNumber(nominalLines[80])}回転`} />
          <MetricCard label="90%ライン" value={`${formatNumber(nominalLines[90])}回転`} />
          <MetricCard label="95%ライン" value={`${formatNumber(nominalLines[95])}回転`} note="危険ライン" tone="border-rose-400/40 bg-rose-500/10" />
        </div>
      </Section>

      <Section title="10. 詳細設定" muted>
        <label className="block max-w-sm">
          <span className="text-sm text-slate-300">基準回転率</span>
          <div className="mt-2 flex items-center gap-2">
            <input
              className="w-full rounded-lg border border-white/10 bg-slate-900 px-4 py-3 text-lg font-bold text-white outline-none ring-cyan-300/30 focus:ring-4"
              inputMode="decimal"
              type="number"
              min="0"
              step="0.1"
              value={baseRate}
              onChange={(event) => setBaseRate(event.target.value)}
            />
            <span className="shrink-0 text-sm text-slate-300">回転 / 1,000円</span>
          </div>
        </label>
        <p className="mt-3 text-sm text-slate-400">初期値は福岡の実戦前提として15回転 / 1,000円。目安投資額の換算だけに使用します。</p>
      </Section>

      <Section title="11. 注意書き" muted>
        <p className="text-sm leading-7 text-slate-300">
          本アプリは、パチンコの大当たりを予測・保証するものではありません。入力された大当たり確率、現在回転数、初当たり履歴をもとに、波形・現在地・撤退ラインを可視化する個人用判断確認アプリです。過去の初当たり履歴によって次回転の当選確率が変化するものではありません。遊技は自己責任で行ってください。
        </p>
      </Section>
    </main>
  );
}

export default App;
