import { test, expect } from "@playwright/test";

test("model dropdown 不超出窗口", async ({ page }) => {
	// 打开 Vite dev server 上的页面
	await page.goto("http://localhost:5173");
	await page.waitForLoadState("networkidle");

	// 等模型下拉框出现（ffbox-dropdown-input）
	const modelInput = page.locator("ffbox-dropdown-input");
	await expect(modelInput).toBeVisible({ timeout: 5000 });

	// 点击打开下拉菜单
	await modelInput.click();

	// 等 menu 出现（FFBoxMenu 渲染成 ffbox-menu）
	const dropdown = page.locator("ffbox-menu");
	await expect(dropdown).toBeVisible();

	// 检查 dropdown 是否超出视口底部
	const box = await dropdown.boundingBox();
	const viewport = page.viewportSize();
	if (box && viewport) {
		const overflowBottom = box.y + box.height - viewport.height;
		console.log(`Dropdown box: y=${box.y}, height=${box.height}, bottom=${box.y + box.height}`);
		console.log(`Viewport height: ${viewport.height}`);
		console.log(`Overflow bottom: ${overflowBottom}px`);

		// dropdown 不应该超出视口
		expect(overflowBottom).toBeLessThanOrEqual(5); // 允许最多 5px 误差
	}
});

test("sidebar 折叠后展开按钮可见", async ({ page }) => {
	await page.goto("http://localhost:5173");
	await page.waitForLoadState("networkidle");

	// 折叠侧边栏
	const collapseBtn = page.locator(".sidebar-toggle-btn").first();
	await collapseBtn.click();

	// 验证 collapsed class
	await expect(page.locator(".sidebar")).toHaveClass(/collapsed/);

	// 验证展开按钮在 logo 位置可见
	const expandBtn = page.locator(".logo-collapsed");
	await expect(expandBtn).toBeVisible();
});
