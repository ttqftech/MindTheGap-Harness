# ffbox-ui（本地 vendor 副本）

FFBox-UI 尚未发布到 npm，因此把其构建产物 `dist/` 直接拷贝到本目录，通过 Vite alias 以包名 `ffbox-ui` 引用。

- 来源仓库：`A:\Code\FFBox\FFBox-UI`
- 拷贝内容：仅 `dist/`（esm / iife / themes）
- 版本：0.7.0

## 接入方式

- Vite：`vite.config.ts` 中 `resolve.alias` 把 `ffbox-ui` 指向 `vendor/ffbox-ui/dist/esm/ffbox-ui-autoregister.js`
- TypeScript：`tsconfig.json` 的 `paths` 指向 `vendor/ffbox-ui/dist/esm/ffbox-ui-autoregister.d.ts`
- 类型声明：dist 未产出 `.d.ts`，声明由本项目维护，见 `src/types/ffbox-ui.d.ts`
- 主题样式：`dist/themes/light.css` 与 `dist/themes/dark.css`，在 `src/mainview/main.tsx` 中引入

## 升级方式

重新拷贝 `A:\Code\FFBox\FFBox-UI\dist` 覆盖本目录的 `dist/`，然后检查 `src/types/ffbox-ui.d.ts` 是否需要同步新增的组件 / 属性 / 事件。

## 备注

ESM 产物已内联 lit（`dist/esm/lit.js`），无需额外安装 `lit` / `@lit/context` 依赖。
