"use client";

type Series = {
  label: string;
  color: string;
  values: number[];
};

export function SimpleLineChart({
  series,
  labels,
  height = 220,
}: {
  series: Series[];
  labels: string[];
  height?: number;
}) {
  const width = 640;
  const padL = 40;
  const padR = 12;
  const padT = 16;
  const padB = 44;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const allVals = series.flatMap((s) => s.values);
  const minV = Math.min(0, ...allVals);
  const maxV = Math.max(1, ...allVals);
  const span = maxV - minV || 1;

  const n = Math.max(1, labels.length - 1);
  const xAt = (i: number) => padL + (n === 0 ? innerW / 2 : (innerW * i) / n);
  const yAt = (v: number) =>
    padT + innerH - ((v - minV) / span) * innerH;

  const paths = series.map((s) => {
    const pts = s.values.map((v, i) => `${xAt(i)},${yAt(v)}`);
    const d = pts.length ? `M ${pts.join(" L ")}` : "";
    return { ...s, d };
  });

  const yTickCount = 4;
  const ticks = Array.from({ length: yTickCount + 1 }, (_, i) => {
    const v = minV + (span * i) / yTickCount;
    return { v, y: yAt(v) };
  });

  const labelStep = Math.max(1, Math.ceil(labels.length / 8));
  const xLabels = labels.map((lab, i) => ({
    lab,
    i,
    x: xAt(i),
    show: i % labelStep === 0 || i === labels.length - 1,
  }));

  return (
    <div className="w-full overflow-x-auto">
      <svg
        view={`0 0 ${width} ${height}`}
        className="max-h-[280px] w-full text-[10px] text-slate-500"
        preserveAspectRatio="xMidYMid meet"
      >
        {ticks.map((t) => (
          <g key={t.v}>
            <line
              x1={padL}
              x2={width - padR}
              y1={t.y}
              y2={t.y}
              stroke="rgb(30 41 59)"
              strokeDasharray="4 4"
            />
            <text x={4} y={t.y + 3} fill="rgb(148 163 184)">
              {t.v >= 1000 ? `${(t.v / 1000).toFixed(1)}k` : t.v.toFixed(0)}
            </text>
          </g>
        ))}
        {paths.map((p) => (
          <path
            key={p.label}
            d={p.d}
            fill="none"
            stroke={p.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {xLabels
          .filter((l) => l.show)
          .map((l) => (
            <text
              key={l.i}
              x={l.x}
              y={height - 12}
              textAnchor="middle"
              fill="rgb(148 163 184)"
              transform={`rotate(-35 ${l.x} ${height - 12})`}
            >
              {l.lab}
            </text>
          ))}
      </svg>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <span className="text-slate-300">{s.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
