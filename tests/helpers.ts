const API_BASE = process.env.API_URL ?? 'http://localhost:8787';

export interface TestResult {
  name: string;
  group: string;
  passed: boolean;
  duration: number;
  error?: string;
}

const results: TestResult[] = [];
let currentGroup = '';

export function group(name: string) {
  currentGroup = name;
  console.log(`\n\x1b[36m━━ ${name} ━━\x1b[0m`);
}

export async function test(
  name: string,
  fn: () => Promise<void>,
): Promise<void> {
  const start = performance.now();
  try {
    await fn();
    const duration = performance.now() - start;
    results.push({ name, group: currentGroup, passed: true, duration });
    console.log(`  \x1b[32m✓\x1b[0m ${name} \x1b[90m(${duration.toFixed(0)}ms)\x1b[0m`);
  } catch (err: any) {
    const duration = performance.now() - start;
    const message = err?.message ?? String(err);
    results.push({ name, group: currentGroup, passed: false, duration, error: message });
    console.log(`  \x1b[31m✗\x1b[0m ${name} \x1b[90m(${duration.toFixed(0)}ms)\x1b[0m`);
    console.log(`    \x1b[31m${message}\x1b[0m`);
  }
}

export function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

export function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

export function assertExists(value: unknown, label: string): void {
  if (value === undefined || value === null) {
    throw new Error(`${label}: expected value to exist, got ${value}`);
  }
}

export function assertType(value: unknown, type: string, label: string): void {
  if (typeof value !== type) {
    throw new Error(
      `${label}: expected type ${type}, got ${typeof value}`,
    );
  }
}

export function assertArray(value: unknown, label: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`${label}: expected array, got ${typeof value}`);
  }
}

export function assertShape(
  obj: Record<string, unknown>,
  fields: Record<string, string>,
  label: string,
): void {
  for (const [key, expectedType] of Object.entries(fields)) {
    if (!(key in obj)) {
      throw new Error(`${label}: missing field "${key}"`);
    }
    const val = obj[key];
    if (expectedType === 'string|null') {
      if (typeof val !== 'string' && val !== null)
        throw new Error(`${label}.${key}: expected string|null, got ${typeof val}`);
    } else if (expectedType === 'number|null') {
      if (typeof val !== 'number' && val !== null)
        throw new Error(`${label}.${key}: expected number|null, got ${typeof val}`);
    } else if (expectedType === 'array') {
      if (!Array.isArray(val))
        throw new Error(`${label}.${key}: expected array, got ${typeof val}`);
    } else if (expectedType === 'object') {
      if (typeof val !== 'object' || val === null)
        throw new Error(`${label}.${key}: expected object, got ${typeof val}`);
    } else if (expectedType === 'boolean') {
      if (typeof val !== 'boolean')
        throw new Error(`${label}.${key}: expected boolean, got ${typeof val}`);
    } else {
      assertType(val, expectedType, `${label}.${key}`);
    }
  }
}

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  expectedStatus?: number;
}

export async function request(
  path: string,
  opts: RequestOptions = {},
): Promise<{ status: number; body: any; headers: Headers }> {
  const { method = 'GET', headers = {}, body, expectedStatus } = opts;

  const fetchOpts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body) fetchOpts.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${path}`, fetchOpts);
  let responseBody: any;
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('json')) {
    responseBody = await res.json();
  } else {
    responseBody = await res.text();
  }

  if (expectedStatus !== undefined && res.status !== expectedStatus) {
    throw new Error(
      `Expected status ${expectedStatus}, got ${res.status}: ${JSON.stringify(responseBody)}`,
    );
  }

  return { status: res.status, body: responseBody, headers: res.headers };
}

export function getResults(): TestResult[] {
  return results;
}

export function printSummary(): void {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const total = results.length;
  const totalTime = results.reduce((sum, r) => sum + r.duration, 0);

  console.log('\n\x1b[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
  console.log('\x1b[1m  TEST SUMMARY\x1b[0m');
  console.log('\x1b[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\n');

  // Group summary
  const groups = new Map<string, { passed: number; failed: number }>();
  for (const r of results) {
    const g = groups.get(r.group) ?? { passed: 0, failed: 0 };
    if (r.passed) g.passed++;
    else g.failed++;
    groups.set(r.group, g);
  }

  for (const [name, g] of groups) {
    const icon = g.failed === 0 ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(
      `  ${icon} ${name}: ${g.passed}/${g.passed + g.failed} passed`,
    );
  }

  console.log('');

  if (failed > 0) {
    console.log('\x1b[31m  FAILURES:\x1b[0m');
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`    \x1b[31m✗\x1b[0m [${r.group}] ${r.name}`);
      console.log(`      ${r.error}`);
    }
    console.log('');
  }

  const statusColor = failed === 0 ? '\x1b[32m' : '\x1b[31m';
  console.log(
    `  ${statusColor}${passed} passed\x1b[0m, ${failed > 0 ? `\x1b[31m${failed} failed\x1b[0m` : `${failed} failed`}, ${total} total`,
  );
  console.log(`  Time: ${(totalTime / 1000).toFixed(2)}s\n`);

  if (failed > 0) process.exit(1);
}

// Shared test state
export const state: Record<string, any> = {};
