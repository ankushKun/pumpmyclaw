/**
 * Standalone DB Admin GUI
 *
 * Run:  bun run db            (starts on port 4983)
 *       DB_PORT=9999 bun run db  (custom port)
 *
 * Provides a web UI to browse and edit the users, instances, and subscriptions tables.
 * Kill the process (Ctrl-C) when done — there is no auth, so don't leave it running.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";

const dbPath = process.env.DATABASE_URL || "./data/pmc.db";
mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.exec("PRAGMA journal_mode = WAL;");

const port = parseInt(process.env.DB_PORT || "4983");

// ── Helpers ────────────────────────────────────────────────────────

function getTables(): string[] {
  const rows = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}

function getRows(table: string): { columns: string[]; rows: any[] } {
  // Validate table name to prevent SQL injection
  const tables = getTables();
  if (!tables.includes(table)) throw new Error(`Unknown table: ${table}`);

  const cols = sqlite.prepare(`PRAGMA table_info("${table}")`).all() as {
    name: string;
    type: string;
    pk: number;
  }[];
  const columns = cols.map((c) => c.name);
  const rows = sqlite.prepare(`SELECT * FROM "${table}" ORDER BY id DESC`).all();
  return { columns, rows };
}

function getTableInfo(
  table: string
): { name: string; type: string; pk: number; notnull: number; dflt_value: string | null }[] {
  const tables = getTables();
  if (!tables.includes(table)) throw new Error(`Unknown table: ${table}`);
  return sqlite.prepare(`PRAGMA table_info("${table}")`).all() as any;
}

function updateRow(
  table: string,
  id: number,
  updates: Record<string, string | null>
) {
  const tables = getTables();
  if (!tables.includes(table)) throw new Error(`Unknown table: ${table}`);

  const info = getTableInfo(table);
  const validCols = new Set(info.map((c) => c.name));

  const sets: string[] = [];
  const values: any[] = [];

  for (const [col, val] of Object.entries(updates)) {
    if (!validCols.has(col) || col === "id") continue;
    sets.push(`"${col}" = ?`);
    // Coerce types
    const colInfo = info.find((c) => c.name === col);
    if (val === "" || val === null) {
      values.push(null);
    } else if (colInfo?.type === "INTEGER") {
      values.push(parseInt(val, 10));
    } else {
      values.push(val);
    }
  }

  if (sets.length === 0) return;

  values.push(id);
  sqlite.prepare(`UPDATE "${table}" SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

function deleteRow(table: string, id: number) {
  const tables = getTables();
  if (!tables.includes(table)) throw new Error(`Unknown table: ${table}`);
  sqlite.prepare(`DELETE FROM "${table}" WHERE id = ?`).run(id);
}

function runQuery(sql: string): { columns: string[]; rows: any[]; changes: number; error?: string } {
  try {
    const trimmed = sql.trim();
    const isSelect = /^SELECT/i.test(trimmed);
    if (isSelect) {
      const stmt = sqlite.prepare(trimmed);
      const rows = stmt.all();
      const columns = rows.length > 0 ? Object.keys(rows[0] as any) : [];
      return { columns, rows, changes: 0 };
    } else {
      const result = sqlite.run(trimmed);
      return { columns: [], rows: [], changes: result.changes };
    }
  } catch (e: any) {
    return { columns: [], rows: [], changes: 0, error: e.message };
  }
}

// ── HTML Template ──────────────────────────────────────────────────

function renderPage(
  activeTable: string | null,
  tables: string[],
  data?: { columns: string[]; rows: any[] },
  queryResult?: { columns: string[]; rows: any[]; changes: number; error?: string },
  queryInput?: string
): string {
  const tableNav = tables
    .map(
      (t) =>
        `<a href="/?table=${t}" class="tab ${t === activeTable ? "active" : ""}">${t}</a>`
    )
    .join("");

  let tableHTML = "";
  if (data && activeTable) {
    const { columns, rows } = data;
    const info = getTableInfo(activeTable);
    const pkCol = info.find((c) => c.pk)?.name || "id";

    tableHTML = `
      <div class="table-header">
        <h2>${activeTable}</h2>
        <span class="row-count">${rows.length} row${rows.length !== 1 ? "s" : ""}</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              ${columns.map((c) => `<th>${esc(c)}</th>`).join("")}
              <th class="actions-col">actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (row: any) => `
              <tr data-id="${(row as any)[pkCol]}">
                ${columns
                  .map((c) => {
                    const val = (row as any)[c];
                    const display = val === null ? '<span class="null">NULL</span>' : esc(String(val));
                    const isSensitive = c.includes("key") || c.includes("token") || c === "wallet_json";
                    return `<td class="cell ${c === pkCol ? "pk" : ""}" data-col="${esc(c)}" ${c !== pkCol ? 'contenteditable="true"' : ""}>
                      ${isSensitive && val ? '<span class="sensitive">' + display.slice(0, 12) + "..." + "</span>" : display}
                    </td>`;
                  })
                  .join("")}
                <td class="actions-col">
                  <button class="btn-save" onclick="saveRow(this)" title="Save changes">save</button>
                  <button class="btn-del" onclick="deleteRow(this, '${activeTable}', ${(row as any)[pkCol]})" title="Delete row">del</button>
                </td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`;
  }

  let queryHTML = "";
  if (queryResult) {
    if (queryResult.error) {
      queryHTML = `<div class="query-error">${esc(queryResult.error)}</div>`;
    } else if (queryResult.columns.length > 0) {
      queryHTML = `
        <div class="query-result">
          <span class="row-count">${queryResult.rows.length} row${queryResult.rows.length !== 1 ? "s" : ""}</span>
          <table>
            <thead><tr>${queryResult.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
            <tbody>${queryResult.rows
              .map(
                (r: any) =>
                  `<tr>${queryResult.columns
                    .map((c) => `<td>${(r as any)[c] === null ? '<span class="null">NULL</span>' : esc(String((r as any)[c]))}</td>`)
                    .join("")}</tr>`
              )
              .join("")}</tbody>
          </table>
        </div>`;
    } else {
      queryHTML = `<div class="query-ok">${queryResult.changes} row${queryResult.changes !== 1 ? "s" : ""} affected</div>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PMC DB Admin</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace; background: #0a0a0a; color: #e0e0e0; font-size: 13px; }
  .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
  header { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; border-bottom: 1px solid #222; padding-bottom: 16px; }
  header h1 { color: #B6FF2E; font-size: 16px; font-weight: 600; }
  header .db-path { color: #666; font-size: 11px; }
  .tabs { display: flex; gap: 4px; margin-bottom: 16px; }
  .tab { padding: 8px 16px; background: #141414; border: 1px solid #222; color: #888; text-decoration: none; border-radius: 6px 6px 0 0; font-size: 12px; transition: all .15s; }
  .tab:hover { background: #1a1a1a; color: #ccc; }
  .tab.active { background: #1a1a1a; color: #B6FF2E; border-bottom-color: #1a1a1a; }
  .table-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  .table-header h2 { font-size: 14px; color: #B6FF2E; }
  .row-count { font-size: 11px; color: #666; background: #141414; padding: 2px 8px; border-radius: 4px; }
  .table-wrap { overflow-x: auto; border: 1px solid #222; border-radius: 8px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #141414; color: #888; font-weight: 500; text-align: left; padding: 8px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #222; white-space: nowrap; position: sticky; top: 0; }
  td { padding: 6px 12px; border-bottom: 1px solid #1a1a1a; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  td.pk { color: #666; }
  td[contenteditable="true"] { cursor: text; }
  td[contenteditable="true"]:focus { outline: 1px solid #B6FF2E; outline-offset: -1px; background: #111; white-space: normal; word-break: break-all; }
  td[contenteditable="true"].modified { background: #1a1800; }
  tr:hover { background: #111; }
  .null { color: #444; font-style: italic; }
  .sensitive { color: #666; }
  .actions-col { width: 100px; text-align: center; white-space: nowrap; }
  button { font-family: inherit; font-size: 11px; cursor: pointer; border: none; border-radius: 4px; padding: 3px 8px; transition: all .15s; }
  .btn-save { background: #1a2e00; color: #B6FF2E; margin-right: 4px; }
  .btn-save:hover { background: #2a4a00; }
  .btn-del { background: #2e0000; color: #ff4444; }
  .btn-del:hover { background: #4a0000; }
  .sql-section { margin-top: 24px; border-top: 1px solid #222; padding-top: 16px; }
  .sql-section h3 { font-size: 12px; color: #888; margin-bottom: 8px; }
  .sql-form { display: flex; gap: 8px; }
  .sql-input { flex: 1; background: #111; border: 1px solid #222; color: #e0e0e0; padding: 10px 12px; border-radius: 6px; font-family: inherit; font-size: 13px; resize: vertical; min-height: 38px; }
  .sql-input:focus { outline: none; border-color: #B6FF2E; }
  .btn-run { background: #B6FF2E; color: #000; font-weight: 600; padding: 8px 16px; border-radius: 6px; font-size: 12px; }
  .btn-run:hover { background: #c8ff5e; }
  .query-result { margin-top: 12px; border: 1px solid #222; border-radius: 8px; overflow-x: auto; }
  .query-result table { font-size: 12px; }
  .query-error { margin-top: 12px; padding: 10px 14px; background: #2e0000; border: 1px solid #4a0000; border-radius: 6px; color: #ff4444; }
  .query-ok { margin-top: 12px; padding: 10px 14px; background: #1a2e00; border: 1px solid #2a4a00; border-radius: 6px; color: #B6FF2E; }
  .toast { position: fixed; bottom: 20px; right: 20px; padding: 10px 16px; border-radius: 6px; font-size: 12px; opacity: 0; transition: opacity .3s; pointer-events: none; }
  .toast.show { opacity: 1; }
  .toast.ok { background: #1a2e00; border: 1px solid #2a4a00; color: #B6FF2E; }
  .toast.err { background: #2e0000; border: 1px solid #4a0000; color: #ff4444; }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>PMC DB Admin</h1>
    <span class="db-path">${esc(dbPath)}</span>
  </header>

  <nav class="tabs">${tableNav}</nav>

  ${tableHTML}

  <div class="sql-section">
    <h3>Raw SQL</h3>
    <form method="POST" action="/query" class="sql-form">
      <textarea name="sql" class="sql-input" placeholder="SELECT * FROM users LIMIT 10" rows="1">${queryInput ? esc(queryInput) : ""}</textarea>
      <button type="submit" class="btn-run">Run</button>
    </form>
    ${queryHTML}
  </div>
</div>

<div id="toast" class="toast"></div>

<script>
function showToast(msg, ok) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + (ok ? 'ok' : 'err');
  setTimeout(() => t.className = 'toast', 2000);
}

// Track edits
document.querySelectorAll('td[contenteditable]').forEach(td => {
  td.dataset.original = td.textContent;
  td.addEventListener('input', () => {
    td.classList.toggle('modified', td.textContent !== td.dataset.original);
  });
});

async function saveRow(btn) {
  const tr = btn.closest('tr');
  const id = tr.dataset.id;
  const table = new URLSearchParams(location.search).get('table');
  const updates = {};
  let hasChanges = false;
  tr.querySelectorAll('td.cell[contenteditable]').forEach(td => {
    if (td.classList.contains('modified')) {
      updates[td.dataset.col] = td.textContent.trim() || null;
      hasChanges = true;
    }
  });
  if (!hasChanges) return showToast('No changes', true);
  const res = await fetch('/api/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ table, id: parseInt(id), updates })
  });
  if (res.ok) {
    showToast('Saved', true);
    tr.querySelectorAll('td.modified').forEach(td => {
      td.classList.remove('modified');
      td.dataset.original = td.textContent;
    });
  } else {
    const e = await res.json();
    showToast(e.error || 'Error', false);
  }
}

async function deleteRow(btn, table, id) {
  if (!confirm('Delete row ' + id + ' from ' + table + '?')) return;
  const res = await fetch('/api/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ table, id })
  });
  if (res.ok) {
    btn.closest('tr').remove();
    showToast('Deleted', true);
  } else {
    const e = await res.json();
    showToast(e.error || 'Error', false);
  }
}

// Auto-resize textarea
document.querySelector('.sql-input')?.addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = this.scrollHeight + 'px';
});
</script>
</body>
</html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Server ─────────────────────────────────────────────────────────

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);

    // ── GUI page ───────────────────────────────────
    if (req.method === "GET" && url.pathname === "/") {
      const tables = getTables();
      const activeTable = url.searchParams.get("table") || tables[0] || null;
      const data = activeTable ? getRows(activeTable) : undefined;
      return new Response(renderPage(activeTable, tables, data), {
        headers: { "Content-Type": "text/html" },
      });
    }

    // ── Raw SQL query ──────────────────────────────
    if (req.method === "POST" && url.pathname === "/query") {
      const form = await req.formData();
      const sql = form.get("sql") as string;
      const tables = getTables();
      const activeTable = tables[0] || null;
      const data = activeTable ? getRows(activeTable) : undefined;
      const result = sql ? runQuery(sql) : undefined;
      return new Response(renderPage(activeTable, tables, data, result, sql || ""), {
        headers: { "Content-Type": "text/html" },
      });
    }

    // ── API: update row ────────────────────────────
    if (req.method === "POST" && url.pathname === "/api/update") {
      try {
        const body = (await req.json()) as {
          table: string;
          id: number;
          updates: Record<string, string | null>;
        };
        updateRow(body.table, body.id, body.updates);
        return Response.json({ ok: true });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 400 });
      }
    }

    // ── API: delete row ────────────────────────────
    if (req.method === "POST" && url.pathname === "/api/delete") {
      try {
        const body = (await req.json()) as { table: string; id: number };
        deleteRow(body.table, body.id);
        return Response.json({ ok: true });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 400 });
      }
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(
  `\n  PMC DB Admin running at http://localhost:${port}\n  Database: ${dbPath}\n  Tables: ${getTables().join(", ")}\n\n  Press Ctrl-C to stop.\n`
);
