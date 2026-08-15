#!/usr/bin/env node
/**
 * Gipfel 商赛系统 — 发布助手（可视化界面）
 *
 * 启动一个本地 HTTP 服务，浏览器打开 tools/updater/index.html，
 * 通过 /api/info 与 /api/release 调用 release-core.mjs 完成发布。
 *
 * 用法：
 *   node tools/updater/ui.mjs            # 默认端口 7788，自动打开浏览器
 *   node tools/updater/ui.mjs --port 9000
 *   node tools/updater/ui.mjs --no-open  # 不自动打开浏览器
 */

import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { execSync } from "node:child_process";
import { getCurrentVersion, runRelease, todayStr } from "./release-core.mjs";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = resolve(__dirname, "index.html");
const ROOT = resolve(__dirname, "..", "..");

function parseArgs(argv) {
  const opts = { port: 7788, open: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") opts.port = Number(argv[++i]) || 7788;
    else if (a === "--no-open") opts.open = false;
    else if (a === "-h" || a === "--help") {
      console.log("用法: node tools/updater/ui.mjs [--port 7788] [--no-open]");
      process.exit(0);
    }
  }
  return opts;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e6) reject(new Error("请求体过大"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  // 仅允许本地访问
  const remote = req.socket.remoteAddress || "";
  if (!remote.includes("127.0.0.1") && !remote.includes("::1") && remote !== "::ffff:127.0.0.1") {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("仅允许本地访问");
    return;
  }

  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      if (!existsSync(INDEX_HTML)) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("未找到 index.html");
        return;
      }
      const html = readFileSync(INDEX_HTML, "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/info") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      // today：服务端（发布实际执行环境）的系统日期，供前端日期选择自动同步，避免浏览器时区偏差。
      // recentCommits：最近 20 条提交记录，供前端自动建议更新要点。
      let recentCommits = [];
      try {
        const log = execFileSync("git", ["log", "--oneline", "-20", "--no-merges"], { cwd: ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
        recentCommits = log.trim().split("\n").filter(Boolean).map((line) => {
          const m = line.match(/^([a-f0-9]+)\s+(.*)$/);
          return m ? { hash: m[1], message: m[2] } : { hash: "", message: line };
        });
      } catch { /* git 不可用时忽略 */ }
      res.end(JSON.stringify({ currentVersion: getCurrentVersion(), today: todayStr(), recentCommits }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/release") {
      const body = await readBody(req);
      let payload = {};
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "请求体不是合法 JSON。" }));
        return;
      }
      const result = await runRelease(payload);
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
  console.log(`发布助手已启动: ${addr}`);
  console.log("（仅本机可访问，Ctrl+C 退出）");
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
