import { test, expect } from "@playwright/test";

/* ==========================================================================
   三大问题的回归测试：
   1. AI 回复不再空白（真实 LLM 链路）
   2. 文件夹有删除按钮
   3. 新建对话出现在侧边栏
   ========================================================================== */

async function cleanState(page: import("@playwright/test").Page) {
	await page.goto("http://localhost:5173");
	await page.waitForLoadState("networkidle");
	// 清掉持久化状态，保证每次从干净状态开始
	await page.evaluate(() => localStorage.clear());
	await page.reload();
	await page.waitForLoadState("networkidle");
}

test("新建任务出现在侧边栏（本地文件夹下）", async ({ page }) => {
	await cleanState(page);

	// 初始：本地文件夹下应为空
	const treeItems = page.locator(".tree-folder .tree-item");
	await expect(treeItems).toHaveCount(0, { timeout: 5000 });

	// 点两次"新建任务"
	await page.locator(".sidebar-new-task").click();
	await expect(treeItems).toHaveCount(1, { timeout: 5000 });

	await page.locator(".sidebar-new-task").click();
	await expect(treeItems).toHaveCount(2, { timeout: 5000 });

	// 新任务的标题应显示
	const titles = await treeItems.allInnerTexts();
	console.log(`侧边栏会话标题: ${JSON.stringify(titles)}`);
	expect(titles.length).toBe(2);
});

test("文件夹可删除，本地文件夹不可删除", async ({ page }) => {
	await cleanState(page);

	// 新建文件夹：浏览器模式没有原生目录对话框，localBridge 走 window.prompt 兜底
	page.once("dialog", (dialog) => dialog.accept("C:\\test-folder"));
	await page.locator(".section-actions .icon-btn").nth(1).click();

	// 文件夹出现在侧边栏
	const folderNames = page.locator(".tree-folder-name");
	await expect(folderNames).toHaveCount(2, { timeout: 5000 }); // 本地 + test-folder

	// "本地" 文件夹不应该有删除按钮
	const localFolder = page.locator(".tree-folder", { hasText: "本地" }).first();
	await localFolder.hover();
	await expect(localFolder.locator(".tree-folder-delete")).toHaveCount(0);

	// 自定义文件夹 hover 后应出现删除按钮
	const customFolder = page.locator(".tree-folder", { hasText: "test-folder" }).first();
	await customFolder.hover();
	const deleteBtn = customFolder.locator(".tree-folder-delete");
	await expect(deleteBtn).toBeVisible();

	// 点击删除 → 文件夹消失
	await deleteBtn.click();
	await expect(folderNames).toHaveCount(1, { timeout: 5000 });
	await expect(page.locator(".tree-folder", { hasText: "test-folder" })).toHaveCount(0);
});

test("AI 回复不再空白（真实 LLM 链路）", async ({ page }) => {
	test.setTimeout(120000);
	await cleanState(page);

	// 发送一条极短消息
	const textarea = page.locator(".input-textarea");
	await expect(textarea).toBeVisible({ timeout: 5000 });
	await textarea.fill("请只回复两个字：收到");

	const sendBtn = page.locator(".input-send-btn");
	await expect(sendBtn).toBeEnabled();
	await sendBtn.click();

	// 等出现 assistant 回复（Agent 无气泡结构 .agent-reply）
	const assistantReply = page.locator(".agent-reply");
	await expect(assistantReply.first()).toBeVisible({ timeout: 15000 });

	// 等回复内容非空（不再空白）
	await expect
		.poll(
			async () => (await assistantReply.first().innerText()).trim().length,
			{ timeout: 90000, intervals: [1000] },
		)
		.toBeGreaterThan(0);

	const text = (await assistantReply.first().innerText()).trim();
	console.log(`AI 回复内容: ${JSON.stringify(text.slice(0, 200))}`);
	expect(text).toContain("收到");
});
