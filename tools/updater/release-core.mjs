/**
 * Gipfel 商赛系统 — 发布核心逻辑（被 CLI 与可视化界面共用）
 *
 * 暴露：
 *   getCurrentVersion()      读取当前 client 版本号
 *   runRelease(opts)         执行发布（校验 / 写入 / 可选 git 提交），返回结构化结果
 *
 * opts:
 *   version       新版本号（必填，x.y.z）
 *   title         公告标题（默认 更新公告 v<x.y.z>）
 *   date          发布日期（默认 今天）
 *   notes         更新要点数组（每行一条；"- "/"* " 开头转列表）
 *   notesFile     要点文件路径（UTF-8，每行一条），与 notes 合并
 *   html          将 notes 作为原始 HTML 直接写入 content
 *   noChangelog   不更新 CHANGELOG.md
 *   noAnnouncement 不更新 in-app announcements
 *   dryRun        仅预览，不写入任何文件
 *   force         允许新版本号不大于当前版本
 *   commit        写入后执行 git add + commit
 *
 * 返回：
 *   { ok, current, version, changes:[{file,type,label,preview?}], wrote, committed, commitError?, error? }
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const SERVER_PKG = resolve(ROOT, "server/package.json");
const CLIENT_PKG = resolve(ROOT, "client/package.json");
const ANNOUNCEMENT = resolve(ROOT, "client/src/data/announcement.ts");
const CHANGELOG = resolve(ROOT, "CHANGELOG.md");

const SEMVER = /^\d+\.\d+\.\d+$/;

export function getCurrentVersion() {
  const clientPkg = JSON.parse(readFileSync(CLIENT_PKG, "utf8"));
  return clientPkg.version;
}

/** 备份文件（写入前调用，失败时可恢复）。备份文件名加 .bak 后缀。 */
function backupFile(filePath) {
  if (existsSync(filePath)) {
    copyFileSync(filePath, filePath + ".bak");
  }
}

/** 恢复备份文件（写入失败时调用）。 */
function restoreFile(filePath) {
  const bakPath = filePath + ".bak";
  if (existsSync(bakPath)) {
    copyFileSync(bakPath, filePath);
  }
}

/** 清理备份文件（写入成功后调用）。 */
function cleanupBackups(files) {
  for (const f of files) {
    const bakPath = f + ".bak";
    if (existsSync(bakPath)) {
      try { writeFileSync(bakPath, ""); } catch { /* 忽略 */ }
    }
  }
}

/** 校验 announcement.ts 文件格式是否正确（检查标记是否存在）。 */
function validateAnnouncementFormat(content) {
  const marker = "export const announcements: Announcement[] = [";
  return content.includes(marker);
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 将要点行转换为受信任的 HTML（<p> 段落 + <ul><li> 列表）。 */
function notesToHtml(notes) {
  const lines = [];
  let listOpen = false;
  const flush = () => {
    if (listOpen) {
      lines.push("      </ul>");
      listOpen = false;
    }
  };
  for (const raw of notes) {
    const t = raw.trim();
    if (t === "") continue;
    const m = t.match(/^[-*]\s+(.*)$/);
    if (m) {
      if (!listOpen) {
        lines.push("      <ul>");
        listOpen = true;
      }
      lines.push(`        <li>${escapeHtml(m[1])}</li>`);
    } else {
      flush();
      lines.push(`      <p>${escapeHtml(t)}</p>`);
    }
  }
  flush();
  if (lines.length === 0) lines.push("      <p>（无详细说明）</p>");
  return lines;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function compareVersion(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

/** 在 announcements 数组最前面插入新条目。 */
function insertAnnouncement(content, entry) {
  const marker = "export const announcements: Announcement[] = [";
  const idx = content.indexOf(marker);
  if (idx === -1) throw new Error("未找到 announcements 数组标记，无法写入。");
  const lineEnd = content.indexOf("\n", idx);
  const before = content.slice(0, lineEnd + 1);
  const after = content.slice(lineEnd + 1);
  return before + entry + after;
}

function buildEntry(version, title, date, htmlLines) {
  // 转义模板字面量中的特殊字符：反引号和 ${ 插值，防止 announcement.ts 语法错误
  const inner = htmlLines.join("\n").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  return (
    "  {\n" +
    `    version: ${JSON.stringify(version)},\n` +
    `    title: ${JSON.stringify(title)},\n` +
    `    date: ${JSON.stringify(date)},\n` +
    "    content: `\n" +
    inner +
    "\n" +
    "    `,\n" +
    "  },\n"
  );
}

function buildChangelogSection(version, date, notes) {
  const strip = (n) => n.replace(/^[-*]\s+/, "").trim();
  const items = notes.length
    ? notes.map((n) => `- ${strip(n)}`).join("\n")
    : "- （无详细说明）";
  return `## v${version} (${date})\n\n${items}\n\n`;
}

function updateChangelog(existing, section) {
  if (!existing) {
    return (
      "# 更新日志 (Changelog)\n\n" +
      "所有重要变更记录于此。版本号与 server/client 的 package.json 保持一致。\n\n" +
      section
    );
  }
  const idx = existing.indexOf("\n## ");
  if (idx === -1) return existing.replace(/\s*$/, "\n\n") + section;
  const head = existing.slice(0, idx + 1);
  const tail = existing.slice(idx + 1);
  return head + "\n" + section + tail;
}

export async function runRelease(input = {}) {
  const opts = {
    version: input.version,
    title: input.title,
    date: input.date,
    notes: Array.isArray(input.notes) ? input.notes : [],
    notesFile: input.notesFile,
    html: !!input.html,
    noChangelog: !!input.noChangelog,
    noAnnouncement: !!input.noAnnouncement,
    dryRun: !!input.dryRun,
    force: !!input.force,
    commit: !!input.commit,
  };

  if (!opts.version || !SEMVER.test(opts.version)) {
    return { ok: false, error: "版本号格式必须为 x.y.z（如 1.1.0）。" };
  }
  if (!opts.title) opts.title = `更新公告 v${opts.version}`;
  if (!opts.date) opts.date = todayStr();

  let notes = opts.notes.flatMap((n) => String(n).split("\n"));
  if (opts.notesFile && existsSync(opts.notesFile)) {
    notes = notes.concat(
      readFileSync(opts.notesFile, "utf8").split(/\r?\n/).filter((l) => l.trim() !== "")
    );
  }
  notes = notes.map((n) => String(n).trim()).filter((n) => n !== "");

  const current = getCurrentVersion();
  if (compareVersion(opts.version, current) <= 0 && !opts.force) {
    return {
      ok: false,
      current,
      error: `新版本 ${opts.version} 须严格大于当前版本 ${current}（使用 force 可跳过）。`,
    };
  }

  const htmlLines = opts.html
    ? notes.length
      ? ["      " + notes.join("\n      ")]
      : ["      <p>（无详细说明）</p>"]
    : notesToHtml(notes);

  const changes = [];

  const clientPkg = readJson(CLIENT_PKG);
  const serverPkg = readJson(SERVER_PKG);

  if (clientPkg.version !== opts.version) {
    clientPkg.version = opts.version;
    changes.push({ file: CLIENT_PKG, type: "package", label: `client version → ${opts.version}` });
  }
  if (serverPkg.version !== opts.version) {
    serverPkg.version = opts.version;
    changes.push({ file: SERVER_PKG, type: "package", label: `server version → ${opts.version}` });
  }

  let annContent;
  if (!opts.noAnnouncement) {
    annContent = readFileSync(ANNOUNCEMENT, "utf8");
    // 校验 announcement.ts 格式，避免写入后破坏语法
    if (!validateAnnouncementFormat(annContent)) {
      return { ok: false, current, error: "announcement.ts 格式异常：未找到 announcements 数组标记，无法写入。请检查文件。" };
    }
    const entry = buildEntry(opts.version, opts.title, opts.date, htmlLines);
    annContent = insertAnnouncement(annContent, entry);
    changes.push({
      file: ANNOUNCEMENT,
      type: "announcement",
      label: `prepend announcement v${opts.version}`,
      preview: entry,
    });
  }

  let clContent;
  if (!opts.noChangelog) {
    const section = buildChangelogSection(opts.version, opts.date, notes);
    const existing = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, "utf8") : null;
    clContent = updateChangelog(existing, section);
    changes.push({
      file: CHANGELOG,
      type: "changelog",
      label: `prepend CHANGELOG v${opts.version}`,
      preview: section,
    });
  }

  let wrote = false;
  let committed = false;
  let commitError = undefined;

  if (!opts.dryRun) {
    // 写入前备份所有待修改文件
    const filesToWrite = changes.map((c) => c.file);
    for (const f of filesToWrite) backupFile(f);

    try {
      for (const c of changes) {
        if (c.type === "package") {
          if (c.file === CLIENT_PKG) writeJson(CLIENT_PKG, clientPkg);
          else writeJson(SERVER_PKG, serverPkg);
        } else if (c.type === "announcement") {
          writeFileSync(ANNOUNCEMENT, annContent, "utf8");
        } else if (c.type === "changelog") {
          writeFileSync(CHANGELOG, clContent, "utf8");
        }
      }
      wrote = true;
      // 写入成功，清理备份文件
      cleanupBackups(filesToWrite);
    } catch (e) {
      // 写入失败，恢复备份
      for (const f of filesToWrite) restoreFile(f);
      cleanupBackups(filesToWrite);
      return { ok: false, current, error: `写入文件失败: ${e.message}，已恢复备份。` };
    }

    if (opts.commit) {
      try {
        // 使用 execFileSync 数组形式避免命令注入（路径含空格/特殊字符时安全）
        execFileSync("git", ["add", ...changes.map((c) => c.file)], { cwd: ROOT, stdio: "pipe" });
        execFileSync("git", ["commit", "-m", `release: v${opts.version}`], { cwd: ROOT, stdio: "pipe" });
        committed = true;
      } catch (e) {
        commitError = e.message;
      }
    }
  }

  return {
    ok: true,
    current,
    version: opts.version,
    title: opts.title,
    date: opts.date,
    notes,
    dryRun: opts.dryRun,
    wrote,
    committed,
    commitError,
    changes,
  };
}
