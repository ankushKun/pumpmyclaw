import { useEffect, useRef } from 'react';
import { createChart, type IChartApi } from 'lightweight-charts';
import type { CandlestickData } from '@pumpmyclaw/shared';

interface TokenChartProps {
  data: CandlestickData[];
  height?: number;
}

function getPriceDecimals(data: CandlestickData[]): number {
  if (data.length === 0) return 2;
  const prices = data.map((d) => d.close).filter((p) => p > 0).sort((a, b) => a - b);
  if (prices.length === 0) return 2;
  const median = prices[Math.floor(prices.length / 2)];
  if (median >= 1) return 2;
  if (median >= 0.01) return 4;
  if (median >= 0.0001) return 6;
  if (median >= 0.000001) return 8;
  return 10;
}

function formatPrice(price: number, decimals: number): string {
  if (price === 0) return '0';
  if (decimals <= 4) return price.toFixed(decimals);
  const str = price.toFixed(decimals);
  const match = str.match(/^0\.(0+)(\d+)$/);
  if (match) {
    const zeroCount = match[1].length;
    const significand = match[2].slice(0, 4);
    if (zeroCount >= 3) {
      return `0.0\u2080${subscriptDigit(zeroCount)}${significand}`;
    }
  }
  return price.toFixed(decimals);
}

function subscriptDigit(n: number): string {
  const subscripts = '\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089';
  return String(n).split('').map((d) => subscripts[parseInt(d)]).join('');
}

export function TokenChart({ data, height = 350 }: TokenChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    const decimals = getPriceDecimals(data);

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { color: '#0B0B0B' },
        textColor: '#A8A8A8',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        timeVisible: true,
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
      },
      localization: {
        priceFormatter: (price: number) => formatPrice(price, decimals),
      },
    });

    const series = chart.addCandlestickSeries({
      upColor: '#10B981',
      downColor: '#F43F5E',
      borderUpColor: '#10B981',
      borderDownColor: '#F43F5E',
      wickUpColor: '#10B981',
      wickDownColor: '#F43F5E',
      priceFormat: {
        type: 'price',
        precision: decimals,
        minMove: 1 / Math.pow(10, decimals),
      },
    });

    // Deduplicate by time (keep last entry for each timestamp) and ensure ascending order
    const deduped = new Map<number, CandlestickData>();
    for (const d of data) {
      deduped.set(d.time, d);
    }
    const sorted = Array.from(deduped.values()).sort((a, b) => a.time - b.time);

    series.setData(
      sorted.map((d) => ({
        time: d.time as any,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      })),
    );

    chart.timeScale().fitContent();
    chartRef.current = chart;

    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [data, height]);

  return (
    <div className="cyber-card overflow-hidden">
      <div ref={containerRef} />
    </div>
  );
}
