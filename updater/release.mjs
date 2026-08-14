#!/usr/bin/env node
/**
 * Gipfel 商赛系统 — 快速发布小工具（命令行版）
 *
 * 发布逻辑见 ./release-core.mjs（本文件只负责参数解析 / 交互 / 打印）。
 *
 * 用法：
 *   交互模式（推荐）：
 *     node updater/release.mjs
 *   参数模式：
 *     node updater/release.mjs --version 1.1.0 --title "v1.1.0 更新" --date 2026-08-14 \
 *          --notes "修复登录失败" --notes "新增导出功能"
 *   仅预览不写入：
 *     node updater/release.mjs --version 1.1.0 --dry-run
 *   写入后顺便 git 提交：
 *     node updater/release.mjs --version 1.1.0 --commit
 *
 * 图形界面：运行 node updater/ui.mjs，浏览器自动打开发布助手。
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { runRelease, getCurrentVersion } from "./release-core.mjs";

function printHelp() {
  console.log(`
Gipfel 商赛系统 — 快速发布小工具（命令行版）

用法:
  node updater/release.mjs [选项]

选项:
  --version <x.y.z>      新版本号（必填，除非交互模式）
  --title   <string>     公告标题（默认: 更新公告 v<x.y.z>）
  --date    <yyyy-mm-dd> 发布日期（默认: 今天）
  --notes   <string>     更新要点（可重复；"- " 开头转列表，否则转段落）；\\n 换行
  --notes-file <path>    从文件读取要点（UTF-8，每行一条）
  --html                 将 notes 作为原始 HTML 直接写入 content
  --no-changelog         不更新 CHANGELOG.md
  --no-announcement      不更新 in-app announcements
  --dry-run              仅预览，不写入任何文件
  --force                允许新版本号不大于当前版本
  --commit               写入后执行 git add + commit
  -h, --help             显示本帮助

不带 --version 时进入交互模式，逐项询问。
`);
}

function parseArgs(argv) {
  const opts = {
    version: undefined,
    title: undefined,
    date: undefined,
    notes: [],
    notesFile: undefined,
    html: false,
    noChangelog: false,
    noAnnouncement: false,
    dryRun: false,
    force: false,
    commit: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
        break;
      case "--version":
        opts.version = argv[++i];
        break;
      case "--title":
        opts.title = argv[++i];
        break;
      case "--date":
        opts.date = argv[++i];
        break;
      case "--notes":
        opts.notes.push(argv[++i]);
        break;
      case "--notes-file":
        opts.notesFile = argv[++i];
        break;
      case "--html":
        opts.html = true;
        break;
      case "--no-changelog":
        opts.noChangelog = true;
        break;
      case "--no-announcement":
        opts.noAnnouncement = true;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--force":
        opts.force = true;
        break;
      case "--commit":
        opts.commit = true;
        break;
      default:
        console.error(`未知参数: ${a}`);
        process.exit(1);
    }
  }
  return opts;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

async function question(rl, prompt) {
  return (await rl.question(prompt)).trim();
}

async function interactive(opts) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    if (!opts.version) {
      opts.version = await question(rl, "新版本号 (x.y.z): ");
    }
    if (!opts.title) {
      const def = `更新公告 v${opts.version}`;
      const t = await question(rl, `公告标题 [${def}]: `);
      opts.title = t || def;
    }
    if (!opts.date) {
      const def = todayStr();
      const d = await question(rl, `发布日期 [${def}]: `);
      opts.date = d || def;
    }
    if (opts.notes.length === 0 && !opts.notesFile) {
      console.log("输入更新要点（每行一条，空行结束）：");
      const notes = [];
      while (true) {
        const line = await rl.question("  > ");
        if (line.trim() === "") break;
        notes.push(line);
      }
      opts.notes = notes;
    }
  } finally {
    rl.close();
  }
}

function renderResult(r) {
  if (!r.ok) {
    console.error(`错误：${r.error}`);
    return;
  }
  console.log("==================== 发布预览 ====================");
  console.log(`版本: ${r.version}  (当前 client: ${r.current})`);
  console.log(`标题: ${r.title}`);
  console.log(`日期: ${r.date}`);
  console.log(`要点: ${r.notes.length ? r.notes.length + " 条" : "无"}`);
  console.log("--------------------------------------------------");
  for (const c of r.changes) {
    console.log(`• ${c.label}`);
    if (c.preview) {
      console.log("  ---- 写入内容 ----");
      console.log(
        c.preview
          .split("\n")
          .map((l) => "  " + l)
          .join("\n")
      );
      console.log("  ------------------");
    }
  }
  console.log("==================================================");
  if (r.dryRun) {
    console.log("[dry-run] 未写入任何文件。");
  } else {
    console.log(r.wrote ? "已写入上述文件。" : "未写入文件。");
    if (r.committed) console.log("已提交 git。");
    if (r.commitError) console.error("git 提交失败（请手动提交）：", r.commitError);
    console.log(`\n完成！版本 v${r.version} 已就绪。`);
    console.log("提示：打包发布请运行 client 的 electron:build；");
    console.log("部署服务端后，旧版本客户端将自动提示「联系管理员获取最新安装包」。");
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.version) {
    await interactive(opts);
  }
  const result = await runRelease(opts);
  renderResult(result);
  if (!result.ok) process.exit(1);
}

main().catch((e) => {
  console.error("发布失败:", e.message);
  process.exit(1);
});
