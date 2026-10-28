const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');

var HUTCH = path.join(os.homedir(), '.hutch', 'bin', 'hutch.exe');
var CODE_ROOT = path.resolve(__dirname, '..');
var BUILD_DIR = path.join(CODE_ROOT, 'build', 'dev-win-x64', 'MindTheGap-Harness-dev');
var LAUNCHER = path.join(BUILD_DIR, 'bin', 'launcher.exe');
var COMPILED_INDEX = path.join(BUILD_DIR, 'Resources', 'app', 'bun', 'index.js');
var BACKEND_PORT = 18999;
var SRC_DIR = path.join(CODE_ROOT, 'src', 'desktop');      // 主进程壳（electrobun 侧）
var SERVICE_SRC_DIR = path.join(CODE_ROOT, 'src', 'service');  // Service（独立进程侧）
var SERVICE_BUNDLE = path.join(CODE_ROOT, 'dist', 'MTGService', 'MTGService.mjs');

var args = process.argv.slice(2);
var noWatch = args.includes('--no-watch');
var noBuild = args.includes('--no-build');

function log(msg) { console.log('[launcher] ' + msg); }

/**
 * 定向收 Service 子进程（node 跑 dist/MTGService/MTGService.mjs）。
 * 不杀的后果：① 孤儿占着 18999，重启后的应用 adopt 到旧代码；② 下次 spawn 撞 EADDRINUSE。
 */
function killServices() {
	try {
		execSync(
			`Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*MTGService.mjs*' } | Stop-Process -Force`,
			{ shell: 'pwsh.exe', stdio: 'ignore', timeout: 5000 }
		);
	} catch(e) {}
}

function killAll() {
	try {
		execSync(
			`Get-Process -Name "hutch","hutch-engine","cottontail","launcher" -ErrorAction SilentlyContinue | Stop-Process -Force`,
			{ shell: 'pwsh.exe', stdio: 'ignore', timeout: 5000 }
		);
	} catch(e) {}
	killServices();
}

function checkBackend() {
	return new Promise(function(resolve) {
		var req = http.get('http://localhost:' + BACKEND_PORT + '/api/health', function(res) {
			res.resume();
			resolve(true);
		});
		req.on('error', function() { resolve(false); });
		req.setTimeout(2000, function() { req.destroy(); resolve(false); });
	});
}

var launcherProc = null;

function startLauncher() {
	if (!fs.existsSync(LAUNCHER)) {
		log('错误：找不到 launcher.exe，路径：' + LAUNCHER);
		log('请先运行 "hutch electrobun dev" 进行构建。');
		return false;
	}
	log('正在启动 launcher.exe...');
	launcherProc = spawn(LAUNCHER, [], {
		cwd: path.join(BUILD_DIR, 'bin'),
		detached: true,
		stdio: 'ignore',
		windowsHide: false
	});
	launcherProc.unref();
	log('launcher 进程 PID：' + launcherProc.pid);

	var checkCount = 0;
	var checkInterval = setInterval(function() {
		checkCount++;
		checkBackend().then(function(ok) {
			if (ok) {
				log('后端已就绪，端口：' + BACKEND_PORT + '（Service 由应用 adopt 或 spawn）');
				clearInterval(checkInterval);
			} else if (checkCount > 20) {
				log('后端 60 秒内未就绪，放弃等待');
				clearInterval(checkInterval);
			}
		});
	}, 3000);

	return true;
}

function stopLauncher() {
	if (launcherProc && launcherProc.pid) {
		try { process.kill(-launcherProc.pid); } catch(e) {}
		try { process.kill(launcherProc.pid); } catch(e) {}
	}
	try {
		execSync(
			`Get-Process -Name "cottontail","launcher" -ErrorAction SilentlyContinue | Stop-Process -Force`,
			{ shell: 'pwsh.exe', stdio: 'ignore', timeout: 3000 }
		);
	} catch(e) {}
	// launcher 被强杀时它 spawn 的 Service 收不到 /api/shutdown，这里补刀
	killServices();
}

/** 跑一条构建命令：进程退出或超时后看产出文件在不在 */
function runBuild(label, command, commandArgs, doneMarker, timeoutMs) {
	return new Promise(function(resolve) {
		log('正在' + label + '...');
		var proc = spawn(command, commandArgs, {
			cwd: CODE_ROOT,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: Object.assign({}, process.env)
		});

		proc.stdout.on('data', function(d) { process.stdout.write(d); });
		proc.stderr.on('data', function(d) { process.stderr.write(d); });

		var done = false;
		var checkInterval = setInterval(function() {
			if (done) return;
			if (proc.exitCode !== null) {
				done = true;
				clearInterval(checkInterval);
				var success = fs.existsSync(doneMarker);
				log(label + (success ? '完成' : '失败') + '（退出码 ' + proc.exitCode + '）');
				resolve(success);
			}
		}, 500);

		setTimeout(function() {
			if (!done) {
				done = true;
				clearInterval(checkInterval);
				if (fs.existsSync(doneMarker)) {
					log(label + '完成（超时，但输出文件已存在）');
					try { proc.kill(); } catch(e) {}
					resolve(true);
				} else {
					log(label + '超时，正在终止');
					try { proc.kill(); } catch(e) {}
					resolve(false);
				}
			}
		}, timeoutMs);
	});
}

function buildService() {
	return runBuild(
		'构建 Service（vite）',
		'pnpm', ['exec', 'vite', 'build', '--config', 'config/vite.service.ts'],
		SERVICE_BUNDLE, 60000
	);
}

function build() {
	return runBuild(
		'运行 hutch electrobun dev（仅构建）',
		HUTCH, ['electrobun', 'dev'],
		COMPILED_INDEX, 60000
	);
}

async function main() {
	log('=== MindTheGap-Harness 开发启动器 ===');
	log('工作目录：' + CODE_ROOT);

	killAll();

	if (!noBuild) {
		var needService = !fs.existsSync(SERVICE_BUNDLE);
		var needShell = !fs.existsSync(COMPILED_INDEX);
		if (!needService) log('Service 产物已存在，跳过构建');
		if (!needShell) log('主进程编译输出已存在，跳过构建');
		if (needService || needShell) {
			if (needService) {
				log('未找到 Service 产物，正在构建...');
				var serviceOk = await buildService();
				if (!serviceOk) {
					log('Service 构建失败，退出');
					process.exit(1);
				}
				log('Service 产物构建完成');
			}
			if (needShell) {
				log('未找到主进程编译输出，正在构建...');
				var ok = await build();
				if (!ok) {
					log('构建失败，退出');
					process.exit(1);
				}
				log('主进程编译输出构建完成');
			}
		}
	}

	startLauncher();

	if (!noWatch) {
		log('正在监听 ' + SRC_DIR + ' 与 ' + SERVICE_SRC_DIR + ' 的文件变更...');
		var rebuildPending = false;
		var lastRebuild = 0;

		function onChange(label) {
			return function(event, filename) {
				if (!filename) return;
				if (!filename.match(/\.(ts|js|mjs|json)$/)) return;

				var now = Date.now();
				if (now - lastRebuild < 3000) return;
				if (rebuildPending) return;

				log('检测到变更：' + label + '/' + filename + '（' + event + '）');
				rebuildPending = true;
				lastRebuild = now;

				stopLauncher();

				// 两边都重建：壳改动要 hutch，agent 改动要 vite；无依赖关系，并行更快
				Promise.all([buildService(), build()]).then(function(results) {
					if (results[0] && results[1]) {
						startLauncher();
					} else {
						log('重新构建失败，不重启');
					}
					rebuildPending = false;
				});
			};
		}

		try {
			fs.watch(SRC_DIR, { recursive: true }, onChange('src/desktop'));
		} catch(e) {
			log('文件监听错误（src/desktop）: ' + e.message);
		}
		try {
			fs.watch(SERVICE_SRC_DIR, { recursive: true }, onChange('src/service'));
		} catch(e) {
			log('文件监听错误（src/service）: ' + e.message);
		}
	}

	process.on('SIGINT', function() {
		log('正在关闭...');
		stopLauncher();
		killAll();
		process.exit(0);
	});
}

main();
