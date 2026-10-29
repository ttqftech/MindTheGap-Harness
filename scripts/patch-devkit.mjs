/* 修补 hutch sync 出来的 electrobun devkit，让 composite 项目能通过类型检查。
   跑法：node scripts/patch-devkit.mjs（幂等，devkit 不存在时静默跳过）

   背景：devkit 的 api/sdks/main/proc/native.ts 里 SessionCookies 有一个 private 字段，
   而 Session 又以「导出对象字面量」的形式暴露 SessionCookies 实例的匿名类类型 →
   composite 项目（tsconfig.desktop.json 把 devkit 源码纳入 include）报 TS4094。
   electrobun 2.0.1 / 2.0.4 / 2.0.5 的这段代码逐字节相同，降级无法规避；
   去掉 private 修饰符不影响运行时（该字段只在类内部使用，TS 结构兼容）。
   ⚠️ 每次 hutch electrobun sync / prepare 会覆盖 devkit，所以脚本挂在 postinstall 与 typecheck 前。 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TARGET = path.join(ROOT, '.hutch/devkit/api/sdks/main/proc/native.ts');
const FROM = 'private partitionId: string;';
const TO = 'partitionId: string;';

if (!fs.existsSync(TARGET)) {
	console.log('[patch-devkit] 没有 .hutch/devkit，跳过（先跑 hutch electrobun sync）');
	process.exit(0);
}

const source = fs.readFileSync(TARGET, 'utf8');
if (!source.includes(FROM)) {
	console.log('[patch-devkit] 无需修补');
	process.exit(0);
}

// 只替换 field 声明那一处；用行首缩进锚定，避免误伤别处同名文本
fs.writeFileSync(TARGET, source.replace(`\t${FROM}`, `\t${TO}`), 'utf8');
console.log('[patch-devkit] 已修补 SessionCookies.partitionId（TS4094）');
