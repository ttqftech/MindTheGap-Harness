import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./tests",
	timeout: 15000,
	use: {
		headless: false,
		viewport: { width: 1280, height: 800 },
	},
});
