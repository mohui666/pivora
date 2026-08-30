"use client";

import { Database } from "lucide-react";
import { useSyncExternalStore } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { AggregatedPoint } from "@/lib/analytics";
import type { ChartWidget, NumberFormat } from "@/lib/bi-types";

const PIE_COLORS = [
  "#4f6df5",
  "#22b8a7",
  "#f2a43a",
  "#8b62e8",
  "#ef6a68",
  "#5c8dff",
];

const subscribeToHydration = () => () => {};

export function formatVisualValue(value: number, format: NumberFormat): string {
  if (format === "currency") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: Math.abs(value) >= 100_000 ? "compact" : "standard",
      maximumFractionDigits: 1,
    }).format(value);
  }
  if (format === "percent") {
    return new Intl.NumberFormat("en-US", {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(value / 100);
  }
  return new Intl.NumberFormat("en-US", {
    notation: format === "compact" ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(value);
}

export function ChartVisual({
  widget,
  points,
  onPointClick,
}: {
  widget: ChartWidget;
  points: AggregatedPoint[];
  onPointClick?: (label: string) => void;
}) {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const total = points.reduce((sum, point) => sum + point.value, 0);
  if (!hydrated) {
    return (
      <div className="h-full min-h-0 w-full animate-pulse rounded-lg bg-muted" />
    );
  }
  if (!points.length) {
    return (
      <div className="grid h-full place-items-center text-center text-xs text-muted-foreground">
        <div>
          <Database className="mx-auto mb-2 size-5 opacity-50" />
          No matching data
        </div>
      </div>
    );
  }
  if (widget.kind === "kpi") {
    return (
      <div className="flex h-full flex-col justify-center px-2">
        <strong
          className="text-[clamp(1.9rem,4vw,3.4rem)] font-semibold tracking-[-0.04em]"
          style={{ color: widget.color }}
        >
          {formatVisualValue(total, widget.numberFormat)}
        </strong>
        <p className="mt-1 text-xs text-muted-foreground">
          {widget.aggregation} of {widget.measure}
        </p>
      </div>
    );
  }
  if (widget.kind === "table") {
    return (
      <div className="h-full overflow-auto rounded-lg border">
        <table className="visual-table">
          <thead>
            <tr>
              <th>{widget.dimension}</th>
              <th>{widget.measure}</th>
            </tr>
          </thead>
          <tbody>
            {points.slice(0, 100).map((point) => (
              <tr key={point.label} onClick={() => onPointClick?.(point.label)}>
                <td>{point.label}</td>
                <td>{formatVisualValue(point.value, widget.numberFormat)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const tooltip = (
    <Tooltip
      contentStyle={{
        borderRadius: 10,
        borderColor: "var(--border)",
        background: "var(--card)",
      }}
      cursor={{ fill: "var(--muted)" }}
      formatter={(value) => [
        formatVisualValue(Number(value), widget.numberFormat),
        widget.measure,
      ]}
    />
  );
  const axes = (
    <>
      {widget.showGrid && (
        <CartesianGrid
          vertical={false}
          stroke="var(--border)"
          strokeDasharray="3 3"
        />
      )}
      <XAxis
        dataKey="label"
        axisLine={false}
        tickLine={false}
        tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
        minTickGap={18}
      />
      <YAxis
        axisLine={false}
        tickLine={false}
        width={56}
        tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
        tickFormatter={(value) =>
          formatVisualValue(Number(value), widget.numberFormat)
        }
      />
    </>
  );
  const clickFromState = (state: { activeLabel?: string | number } | null) => {
    if (state?.activeLabel !== undefined)
      onPointClick?.(String(state.activeLabel));
  };

  if (widget.kind === "pie") {
    const pieData = points.map((point, index) => ({
      ...point,
      fill: index === 0 ? widget.color : PIE_COLORS[index % PIE_COLORS.length],
    }));
    return (
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={0}
        minHeight={0}
      >
        <PieChart>
          {tooltip}
          {widget.showLegend && (
            <Legend iconType="circle" wrapperStyle={{ fontSize: 10 }} />
          )}
          <Pie
            data={pieData}
            dataKey="value"
            nameKey="label"
            innerRadius="42%"
            outerRadius="72%"
            paddingAngle={2}
            onClick={(_, index) => onPointClick?.(points[index]?.label ?? "")}
          />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  if (widget.kind === "line") {
    return (
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={0}
        minHeight={0}
      >
        <LineChart
          data={points}
          margin={{ top: 8, right: 12, left: 0 }}
          onClick={clickFromState}
        >
          {axes}
          {tooltip}
          <Line
            type="monotone"
            dataKey="value"
            stroke={widget.color}
            strokeWidth={3}
            dot={{ r: 2.5 }}
            activeDot={{ r: 5 }}
          />
          {widget.showLegend && <Legend />}
        </LineChart>
      </ResponsiveContainer>
    );
  }
  if (widget.kind === "area") {
    const gradientId = `fill-${widget.id}`;
    return (
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={0}
        minHeight={0}
      >
        <AreaChart
          data={points}
          margin={{ top: 8, right: 12, left: 0 }}
          onClick={clickFromState}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={widget.color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={widget.color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          {axes}
          {tooltip}
          <Area
            type="monotone"
            dataKey="value"
            stroke={widget.color}
            strokeWidth={3}
            fill={`url(#${gradientId})`}
          />
          {widget.showLegend && <Legend />}
        </AreaChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
      <BarChart
        data={points}
        margin={{ top: 8, right: 12, left: 0 }}
        onClick={clickFromState}
      >
        {axes}
        {tooltip}
        <Bar
          dataKey="value"
          fill={widget.color}
          radius={[5, 5, 2, 2]}
          maxBarSize={56}
        />
        {widget.showLegend && <Legend />}
      </BarChart>
    </ResponsiveContainer>
  );
}
