import { useEffect, useRef } from 'react';
import { createChart, type IChartApi } from 'lightweight-charts';
import type { CandlestickData } from '@pumpmyclaw/shared';

interface TokenChartProps {
  data: CandlestickData[];
  height?: number;
}

/**
 * Determine the number of decimal places needed to show meaningful price diffs.
 * For micro-cap tokens with prices like 0.000005, we need 8+ decimals.
 */
function getPriceDecimals(data: CandlestickData[]): number {
  if (data.length === 0) return 2;

  // Use the median close price to determine scale
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

  // For very small numbers, use subscript notation: 0.0₅48
  // Count leading zeros after decimal point
  const str = price.toFixed(decimals);
  const match = str.match(/^0\.(0+)(\d+)$/);
  if (match) {
    const zeroCount = match[1].length;
    const significand = match[2].slice(0, 4); // show 4 significant digits
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

export function TokenChart({ data, height = 400 }: TokenChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    const decimals = getPriceDecimals(data);

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { color: '#0a0a0a' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: '#1f2937' },
        horzLines: { color: '#1f2937' },
      },
      timeScale: {
        borderColor: '#374151',
        timeVisible: true,
      },
      rightPriceScale: {
        borderColor: '#374151',
      },
      localization: {
        priceFormatter: (price: number) => formatPrice(price, decimals),
      },
    });

    const series = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
      priceFormat: {
        type: 'price',
        precision: decimals,
        minMove: 1 / Math.pow(10, decimals),
      },
    });

    series.setData(
      data.map((d) => ({
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

  return <div ref={containerRef} />;
}
