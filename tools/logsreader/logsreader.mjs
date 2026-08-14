#!/usr/bin/env node
/**
 * Gipfel 商赛系统 — 服务端日志可视化读取工具（logsreader）
 *
 * 启动一个本地 HTTP 服务，浏览器打开 tools/logsreader/index.html，
 * 通过 /api/list 与 /api/query 读取并分析 server/logs 下的 Winston JSONL 日志。
 *
 * 用法：
 *   node tools/logsreader/logsreader.mjs                  # 默认端口 7799，自动打开浏览器
 *   node tools/logsreader/logsreader.mjs --port 9000
 *   node tools/logsreader/logsreader.mjs --no-open        # 不自动打开浏览器
 *   node tools/logsreader/logsreader.mjs --logs ../server/logs   # 指定日志目录
 */

import http from "node:http";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = resolve(__dirname, "index.html");
const REPO_ROOT = resolve(__dirname, "..", "..");

// Winston 标准级别（由严重到详细）。统计/过滤按此排序。
const LEVEL_ORDER = ["error", "warn", "info", "http", "verbose", "debug", "silly"];

function parseArgs(argv) {
  const opts = { port: 7799, open: true, logsDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") opts.port = Number(argv[++i]) || 7799;
    else if (a === "--no-open") opts.open = false;
    else if (a === "--logs") opts.logsDir = argv[++i];
    else if (a === "-h" || a === "--help") {
      console.log("Usage: node tools/logsreader/logsreader.mjs [--port 7799] [--logs <dir>] [--no-open]");
      process.exit(0);
    }
  }
  if (!opts.logsDir) opts.logsDir = process.env.LOG_READER_DIR || resolve(REPO_ROOT, "server", "logs");
  return opts;
}

const LOGS_DIR = (() => {
  const p = resolve(parseArgs(process.argv.slice(2)).logsDir);
  return p;
})();

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 4e6) reject(new Error("request body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/** 列出日志目录下所有 Winston 滚动日志文件（排除 Prisma 的 .audit.json 等）。 */
function listLogs() {
  if (!existsSync(LOGS_DIR)) return [];
  const entries = readdirSync(LOGS_DIR).filter(
    (f) => (f.startsWith("app-") || f.startsWith("error-")) && f.endsWith(".log"),
  );
  const files = entries
    .map((f) => {
      let size = 0;
      try {
        size = statSync(resolve(LOGS_DIR, f)).size;
      } catch {
        size = 0;
      }
      // 从文件名提取日期：app-YYYY-MM-DD.log
      const m = f.match(/^(\w+)-(\d{4}-\d{2}-\d{2})\.log$/);
      return { name: f, size, date: m ? m[2] : "", kind: m ? m[1] : "app" };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return files;
}

/**
 * 按字节边界读取日志文件为行数组。每行记录起止字节位置（follow 增量用），
 * 并尝试解析为 JSON；解析失败的行以 level="raw" 兜底返回。
 */
function readLogLines(absPath) {
  let buf;
  try {
    buf = readFileSync(absPath);
  } catch {
    return [];
  }
  const lines = [];
  let start = 0;
  let idx;
  while ((idx = buf.indexOf(0x0a, start)) !== -1) {
    const chunk = buf.subarray(start, idx);
    lines.push({ startByte: start, endByte: idx + 1, raw: chunk.toString("utf8") });
    start = idx + 1;
  }
  if (start < buf.length) {
    const chunk = buf.subarray(start);
    if (chunk.length > 0) lines.push({ startByte: start, endByte: buf.length, raw: chunk.toString("utf8") });
  }
  return lines;
}

function parseLine(line) {
  let parsed = null;
  try {
    parsed = JSON.parse(line.raw);
  } catch {
    parsed = null;
  }
  if (parsed && typeof parsed === "object") {
    // operator 在 JSON 日志里是对象 {id,role,username,operatorLabel?}，
    // 统一归一化为可读字符串，供过滤/下拉/表格展示使用。
    let operator = parsed.operator;
    if (operator && typeof operator === "object") {
      operator = operator.operatorLabel || operator.username || operator.id || "";
    }
    return {
      ...parsed,
      operator: operator || null,
      _file: line._file || null,
      _seq: line.seq,
      _startByte: line.startByte,
      _endByte: line.endByte,
    };
  }
  // 非 JSON 行兜底
  return {
    level: "raw",
    message: line.raw,
    timestamp: "",
    context: "",
    operator: null,
    requestId: null,
    ip: null,
    _file: line._file || null,
    _seq: line.seq,
    _startByte: line.startByte,
    _endByte: line.endByte,
  };
}

function tsToMs(ts) {
  if (!ts) return null;
  // "YYYY-MM-DD HH:mm:ss" -> 本地时间毫秒
  const m = String(ts).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d.getTime();
  }
  const [, y, mo, d, h, mi, s] = m;
  return new Date(+y, +mo - 1, +d, +h, +mi, +(s || 0)).getTime();
}

function inRange(ts, from, to) {
  const ms = tsToMs(ts);
  if (ms == null) return true; // 无时间戳不参与区间过滤（放行）
  if (from != null) {
    const f = tsToMs(from);
    if (f != null && ms < f) return false;
  }
  if (to != null) {
    const t = tsToMs(to);
    if (t != null && ms > t) return false;
  }
  return true;
}

function matchText(obj, q) {
  if (!q) return true;
  const hay = [
    obj.message,
    obj.context,
    obj.operator,
    obj.requestId,
    obj.ip,
    JSON.stringify(obj),
  ]
    .filter(Boolean)
    .join(" ");
  return hay.toLowerCase().includes(q.toLowerCase());
}

/** 选择时间线分桶粒度（毫秒）。 */
function chooseBucket(from, to) {
  let span = Infinity;
  if (from != null && to != null) {
    const f = tsToMs(from),
      t = tsToMs(to);
    if (f != null && t != null) span = t - f;
  }
  const MIN = 60 * 1000,
    HOUR = 60 * MIN,
    DAY = 24 * HOUR;
  if (span <= 2 * HOUR) return 5 * MIN;
  if (span <= 12 * HOUR) return 15 * MIN;
  if (span <= 2 * DAY) return HOUR;
  return DAY;
}

function bucketKey(ms, bucket) {
  return Math.floor(ms / bucket) * bucket;
}

function fmtBucket(ms, bucket) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  const base = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  if (bucket >= 24 * 60 * 60 * 1000) return base;
  return `${base} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function runQuery(body) {
  const files = Array.isArray(body.files) && body.files.length ? body.files : listLogs().map((f) => f.name);
  const levels = Array.isArray(body.levels) ? body.levels : [];
  const contexts = Array.isArray(body.contexts) ? body.contexts : [];
  const operators = Array.isArray(body.operators) ? body.operators : [];
  const q = typeof body.q === "string" ? body.q.trim() : "";
  const from = body.from || null;
  const to = body.to || null;
  // limit 为 0 / 空 / 非正数 时表示「不限制」（返回全部匹配行）。
  // 仅保留一个极大的内部安全上限以防极端滥用导致 OOM，对真实日志等于无限制。
  const rawLimit = Number(body.limit);
  const limit = !rawLimit || rawLimit <= 0 ? Infinity : Math.min(rawLimit, 200000);
  const offset = Math.max(Number(body.offset) || 0, 0);
  const order = body.order === "asc" ? "asc" : "desc";
  const follow = !!body.follow;
  const afterOffset = Number(body.afterOffset) || 0;

  // 1) 收集候选行（按 file），并打全局行序号 seq
  //    seq 跨所有选中文件单调递增，用于 follow 增量游标（避免多文件字节偏移串号）。
  let collected = [];
  let seq = 0;
  for (const fname of files) {
    const abs = resolve(LOGS_DIR, fname);
    if (!existsSync(abs)) continue;
    const lines = readLogLines(abs);
    for (const ln of lines) {
      ln._file = fname;
      ln.seq = seq++;
      collected.push(ln);
    }
  }

  // 2) 解析 + 过滤
  const matched = [];
  const levelSet = new Set(levels);
  const ctxSet = new Set(contexts);
  const opSet = new Set(operators);

  for (const ln of collected) {
    // follow 增量：仅取 afterOffset（全局行序号）之后的新行
    if (follow && ln.seq <= afterOffset) continue;
    const obj = parseLine(ln);
    const lvl = (obj.level || "").toLowerCase();
    if (levelSet.size && !levelSet.has(lvl)) continue;
    if (ctxSet.size) {
      const c = obj.context || "";
      if (!ctxSet.has(c)) continue;
    }
    if (opSet.size) {
      const o = obj.operator || "";
      if (!opSet.has(o)) continue;
    }
    if (!inRange(obj.timestamp, from, to)) continue;
    if (!matchText(obj, q)) continue;
    matched.push(obj);
  }

  // 3) 排序（按时间戳；无时间戳的排最后）
  matched.sort((a, b) => {
    const ma = tsToMs(a.timestamp) ?? (order === "desc" ? -Infinity : Infinity);
    const mb = tsToMs(b.timestamp) ?? (order === "desc" ? -Infinity : Infinity);
    return order === "desc" ? mb - ma : ma - mb;
  });

  const total = matched.length;
  const page = matched.slice(offset, offset + limit);
  // 用于 follow 的全局行序号游标：本页最后一行之后的位置
  const endOffset = page.length ? page[page.length - 1]._seq : afterOffset;

  // 4) 统计（基于 matched 全集）
  const byLevel = {};
  const ctxCount = new Map();
  const opSet2 = new Set();
  let pktUp = 0,
    pktDown = 0,
    pktCnt = 0; // 数据包大小合计（上行/下行/含包大小记录数）
  for (const o of matched) {
    const lvl = (o.level || "raw").toLowerCase();
    byLevel[lvl] = (byLevel[lvl] || 0) + 1;
    const c = o.context || "(none)";
    ctxCount.set(c, (ctxCount.get(c) || 0) + 1);
    if (o.operator) opSet2.add(o.operator);
    const u = typeof o.requestBodySize === "number" ? o.requestBodySize : 0;
    const d = typeof o.responseBodySize === "number" ? o.responseBodySize : 0;
    if (u || d) {
      pktUp += u;
      pktDown += d;
      pktCnt++;
    }
  }
  const byContext = [...ctxCount.entries()]
    .map(([context, count]) => ({ context, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  // 4.5) URL 统计：按「路径（去除 ?query 参数）」聚合，反映各 API 端点被访问次数；
  //      仅统计含 url 字段的 HTTP 请求日志，无 url 的非请求业务日志不计入该维度
  //      （否则会混入海量"(非请求日志)"使条形图失效）；完整 URL 仍保留在明细行与详情中展示。
  const urlCount = new Map();
  for (const o of matched) {
    const raw = o.url || "";
    if (!raw) continue; // 跳过无 url 的非请求日志
    const path = raw.split("?")[0];
    urlCount.set(path, (urlCount.get(path) || 0) + 1);
  }
  const byUrl = [...urlCount.entries()]
    .map(([url, count]) => ({ url, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  // 5) 时间线堆叠
  const bucket = chooseBucket(from, to);
  const tlMap = new Map(); // bucketStart -> { bucket, level counts }
  for (const o of matched) {
    const ms = tsToMs(o.timestamp);
    if (ms == null) continue;
    const k = bucketKey(ms, bucket);
    if (!tlMap.has(k)) tlMap.set(k, { bucket: fmtBucket(k, bucket), _ms: k });
    const slot = tlMap.get(k);
    const lvl = (o.level || "raw").toLowerCase();
    slot[lvl] = (slot[lvl] || 0) + 1;
  }
  const timeline = [...tlMap.values()].sort((a, b) => a._ms - b._ms).map(({ _ms, ...rest }) => rest);

  // 6) facets：可选值（基于全部日志，便于下拉填充）
  const facets = { levels: [], contexts: [], operators: [] };
  const fctx = new Map();
  const fop = new Set();
  for (const ln of collected) {
    const o = parseLine(ln);
    const lvl = (o.level || "raw").toLowerCase();
    if (!facets.levels.includes(lvl)) facets.levels.push(lvl);
    const c = o.context || "";
    if (c && !fctx.has(c)) fctx.set(c, true);
    if (o.operator) fop.add(o.operator);
  }
  facets.levels.sort((a, b) => LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(b));
  facets.contexts = [...fctx.keys()].sort();
  facets.operators = [...fop].sort();

  return {
    ok: true,
    total,
    count: page.length,
    endOffset,
    pktTotals: { up: pktUp, down: pktDown, cnt: pktCnt },
    rows: page.map(({ _startByte, _endByte, _file, _seq, ...rest }) => ({ file: _file, ...rest })),
    byLevel,
    byContext,
    byUrl,
    timeline,
    facets,
    files,
    bucketMs: bucket,
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const remote = req.socket.remoteAddress || "";
  if (
    !remote.includes("127.0.0.1") &&
    !remote.includes("::1") &&
    remote !== "::ffff:127.0.0.1"
  ) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("only local access allowed");
    return;
  }

  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      if (!existsSync(INDEX_HTML)) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("index.html not found");
        return;
      }
      const html = readFileSync(INDEX_HTML, "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/list") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, logsDir: LOGS_DIR, files: listLogs() }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/query") {
      const raw = await readBody(req);
      let body = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "request body is not valid JSON" }));
        return;
      }
      const result = runQuery(body);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(result));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
});

const opts = parseArgs(process.argv.slice(2));
server.listen(opts.port, "127.0.0.1", () => {
  const addr = `http://127.0.0.1:${opts.port}/`;
  console.log(`日志读取工具已启动: ${addr}`);
  console.log(`日志目录: ${LOGS_DIR}`);
  console.log("(only accessible from this machine, Ctrl+C to exit)");
  if (opts.open) {
    try {
      const cmd =
        process.platform === "win32"
          ? `start "" "${addr}"`
          : process.platform === "darwin"
            ? `open "${addr}"`
            : `xdg-open "${addr}"`;
      execSync(cmd);
    } catch {
      console.log("无法自动打开浏览器，请手动访问上面的地址。");
    }
  }
});
