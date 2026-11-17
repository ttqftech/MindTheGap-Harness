/* ==========================================================================
   一次性迁移：ctx.json 里的 taskList → todoList

   「任务清单」在 2026-11-04 统一改名「待办清单」，字段从 `AgentCtx.taskList` 改成
   `AgentCtx.todoList`。代码里不再保留旧字段的兜底读，所以存量会话需要就地转一次。

   做法：
   - 扫 `<数据目录>/conversations/`（`<id>/ctx.json` 和更老的 `<id>.json` 两种形态都认）
   - 只有 `agentCtx` 直接挂着 `taskList` 的才动；已有 `todoList` 的不覆盖（以新字段为准）
   - 改之前先把原文件复制到 `<数据目录>/tasklist-migration-backup-<日期>/`
   - 写回去用 2 空格缩进、不加结尾换行 —— 与 storage 的落盘格式一致

   用法：node scripts/migrate-tasklist-to-todolist.mjs [--dry]
   ========================================================================== */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DRY = process.argv.includes('--dry');
const DATA_DIR = join(homedir(), '.mindthegap-harness');
const CONV_DIR = join(DATA_DIR, 'conversations');
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const BACKUP_DIR = join(DATA_DIR, `tasklist-migration-backup-${stamp}`);

/** 把 ctx（可能包着 meta 外壳）里的 taskList 挪到 todoList。返回是否改过 */
function migrateCtx(ctx) {
	if (!ctx || typeof ctx !== 'object') return false;
	if (!('taskList' in ctx)) return false;
	if (typeof ctx.todoList !== 'string') ctx.todoList = typeof ctx.taskList === 'string' ? ctx.taskList : '';
	delete ctx.taskList;
	return true;
}

function handle(file, rel) {
	let raw;
	try {
		raw = readFileSync(file, 'utf8');
	} catch {
		return false;
	}
	let doc;
	try {
		doc = JSON.parse(raw);
	} catch (err) {
		console.log(`  ! 跳过（JSON 解析失败）：${rel} — ${err.message}`);
		return false;
	}

	// 两种外壳：完整会话 { agentCtx, ... } / 更老的直接是 ctx 本身
	const targets = [doc.agentCtx, doc].filter((t) => t && typeof t === 'object');
	let changed = false;
	for (const t of targets) if (migrateCtx(t)) changed = true;
	if (!changed) return false;

	if (DRY) {
		console.log(`  · 待转换：${rel}`);
		return true;
	}
	const dest = join(BACKUP_DIR, rel);
	mkdirSync(join(dest, '..'), { recursive: true });
	copyFileSync(file, dest);
	writeFileSync(file, JSON.stringify(doc, null, 2));
	console.log(`  ✓ ${rel}`);
	return true;
}

if (!existsSync(CONV_DIR)) {
	console.log(`找不到会话目录：${CONV_DIR}`);
	process.exit(1);
}

let total = 0;
for (const name of readdirSync(CONV_DIR)) {
	const full = join(CONV_DIR, name);
	if (statSync(full).isDirectory()) {
		const file = join(full, 'ctx.json');
		if (existsSync(file) && handle(file, join(name, 'ctx.json'))) total++;
	} else if (name.endsWith('.json')) {
		if (handle(full, name)) total++;
	}
}

console.log(
	DRY
		? `\n共 ${total} 个会话需要转换（--dry，未写入）`
		: `\n已转换 ${total} 个会话${total ? `，原文件备份在 ${BACKUP_DIR}` : ''}`,
);
