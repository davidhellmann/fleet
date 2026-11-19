import * as React from 'react';
import { barY, colorLegend, defineChart } from '@tanstack/charts';
import { Chart } from '@tanstack/charts/react';
import { scaleBand } from '@tanstack/charts/scales/band';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { tooltip } from '@tanstack/charts/tooltip';
import { formatUsd } from '@/lib/format.ts';
import { OTHER_SERIES, type Timeline } from '@/lib/usage.ts';

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

/** Axis label of a bucket: "18 Nov" for days and weeks (the Monday), "Nov 26" for months. */
const bucketLabel = (bucket: Timeline['bucket']) => (day: string) => (bucket === 'month' ? MONTH.format(asDate(day)) : DAY.format(asDate(day)));

/** Accent first, then the category tokens; Other is always the quiet grey. */
const colorOf = (series: string, i: number) => (series === OTHER_SERIES ? 'var(--category-6)' : `var(--category-${Math.min(i + 1, 5)})`);

export interface CostChartProps {
  timeline: Timeline;
  /** What the series are, for the legend and the accessible name: "Model", "Repo". */
  seriesLabel: string;
  height?: number;
}

/**
 * Cost over time as stacked bars, one stack per day, week or month, one colour per series.
 * Server-rendered SVG; hydrated for focus and tooltips.
 */
export function CostChart({ timeline, seriesLabel, height = 260 }: CostChartProps) {
  const { bucket, buckets, series, points } = timeline;

  // Built once per data: the definition's identity is the chart's update boundary
  const definition = React.useMemo(() => {
    const label = bucketLabel(bucket);
    return defineChart({
        marks: [
          barY(points, {
            x: 'bucket',
            y: 'cost',
            color: 'series',
            key: 'id',
            inset: buckets.length > 60 ? 0 : 1,
            radius: { end: 2 },
          }),
        ],
        scales: {
          // The full bucket list as domain: days without usage keep their slot
          x: { scale: scaleBand<string>().domain(buckets).padding(0.2), axis: { ticks: { size: 0, format: label }, line: false } },
          y: { scale: scaleLinear, nice: true, grid: true, axis: { ticks: { size: 0, format: (v: number) => formatUsd(v).replace(/\.00$/, '') }, line: false } },
        },
        color: {
          domain: series,
          range: series.map(colorOf),
          legend: series.length > 1 ? colorLegend({ label: seriesLabel }) : undefined,
        },
        tooltip,
      });
  }, [bucket, points, buckets, series, seriesLabel]);

  const unit = bucket === 'day' ? 'day' : bucket === 'week' ? 'week' : 'month';
  return (
    <div data-slot="chart" className="text-muted-foreground">
      <Chart
        definition={definition}
        height={height}
        initialWidth={720}
        ariaLabel={`Cost per ${unit} by ${seriesLabel.toLowerCase()}`}
        ariaDescription={`Stacked bars of API list cost per ${unit}; series: ${series.join(', ')}.`}
      />
    </div>
  );
}
