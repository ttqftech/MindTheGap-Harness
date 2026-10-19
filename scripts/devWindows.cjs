const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');

var HUTCH = path.join(os.homedir(), '.hutch', 'bin', 'hutch.exe');
var WS = path.resolve(__dirname, '..');
var BUILD_DIR = path.join(WS, 'build', 'dev-win-x64', 'MindTheGap-Harness-dev');
var LAUNCHER = path.join(BUILD_DIR, 'bin', 'launcher.exe');
var COMPILED_INDEX = path.join(BUILD_DIR, 'Resources', 'app', 'bun', 'index.js');
var BACKEND_PORT = 18999;
var SRC_DIR = path.join(WS, 'src', 'bun');

var args = process.argv.slice(2);
var noWatch = args.includes('--no-watch');
var noBuild = args.includes('--no-build');

function log(msg) { console.log('[launcher] ' + msg); }

function killAll() {
	try {
		execSync(
			`Get-Process -Name "hutch","hutch-engine","cottontail","launcher" -ErrorAction SilentlyContinue | Stop-Process -Force`,
			{ shell: 'pwsh.exe', stdio: 'ignore', timeout: 5000 }
		);
	} catch(e) {}
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
				log('后端已就绪，端口：' + BACKEND_PORT);
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
}

function build() {
	return new Promise(function(resolve) {
		log('正在运行 hutch electrobun dev（仅构建）...');
		var hutch = spawn(HUTCH, ['electrobun', 'dev'], {
			cwd: WS,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: Object.assign({}, process.env)
		});

		var stdout = '';
		var stderr = '';
		hutch.stdout.on('data', function(d) { stdout += d; process.stdout.write(d); });
		hutch.stderr.on('data', function(d) { stderr += d; process.stderr.write(d); });

		var done = false;
		var checkInterval = setInterval(function() {
			if (done) return;
			if (hutch.exitCode !== null) {
				done = true;
				clearInterval(checkInterval);
				var success = fs.existsSync(COMPILED_INDEX);
				log('构建' + (success ? '完成' : '失败') + '（退出码 ' + hutch.exitCode + '）');
				resolve(success);
			}
		}, 500);

		setTimeout(function() {
			if (!done) {
				done = true;
				clearInterval(checkInterval);
				if (fs.existsSync(COMPILED_INDEX)) {
					log('构建完成（超时，但输出文件已存在）');
					try { hutch.kill(); } catch(e) {}
					resolve(true);
				} else {
					log('构建超时，正在终止 hutch');
					try { hutch.kill(); } catch(e) {}
					resolve(false);
				}
			}
		}, 60000);
	});
}

async function main() {
	log('=== MindTheGap-Harness 开发启动器 ===');
	log('工作目录：' + WS);

	killAll();

	if (!noBuild) {
		if (!fs.existsSync(COMPILED_INDEX)) {
			log('未找到编译输出，正在构建...');
			var ok = await build();
			if (!ok) {
				log('构建失败，退出');
				process.exit(1);
			}
		} else {
			log('编译输出已存在，跳过构建');
		}
	}

	startLauncher();

	if (!noWatch) {
		log('正在监听 ' + SRC_DIR + ' 的文件变更...');
		var rebuildPending = false;
		var lastRebuild = 0;

		var watcher;
		try {
			watcher = fs.watch(SRC_DIR, { recursive: true }, function(event, filename) {
				if (!filename) return;
				if (!filename.match(/\.(ts|js|mjs|json)$/)) return;

				var now = Date.now();
				if (now - lastRebuild < 3000) return;
				if (rebuildPending) return;

				log('检测到变更：' + filename + '（' + event + '）');
				rebuildPending = true;
				lastRebuild = now;

				stopLauncher();

				build().then(function(ok) {
					if (ok) {
						startLauncher();
					} else {
						log('重新构建失败，不重启');
					}
					rebuildPending = false;
				});
			});
		} catch(e) {
			log('文件监听错误：' + e.message);
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
