//// <reference types="vite/client" />
// 上面这行被注释掉了，因为我们自定义了一个 svg 导入插件，类型是 Component<ComponentProps<'span'>>
// 而 vite/client 中的定义是 string，会让 svg 组件的类型变成 string | Component<ComponentProps<'span'>>，导致 ts 报错
// 注释掉之后，CSS 导入也会随之失效，所以要在下面重新导出

type CSSModuleClasses = { readonly [key: string]: string }

declare module '*.module.css' {
	const classes: CSSModuleClasses
	export default classes
}
declare module '*.module.scss' {
	const classes: CSSModuleClasses
	export default classes
}
declare module '*.module.sass' {
	const classes: CSSModuleClasses
	export default classes
}
declare module '*.module.less' {
	const classes: CSSModuleClasses
	export default classes
}
declare module '*.module.styl' {
	const classes: CSSModuleClasses
	export default classes
}
declare module '*.module.stylus' {
	const classes: CSSModuleClasses
	export default classes
}
declare module '*.module.pcss' {
	const classes: CSSModuleClasses
	export default classes
}
declare module '*.module.sss' {
	const classes: CSSModuleClasses
	export default classes
}

declare module '*.css' {}
declare module '*.scss' {}
declare module '*.sass' {}
declare module '*.less' {}
declare module '*.styl' {}
declare module '*.stylus' {}
declare module '*.pcss' {}
declare module '*.sss' {}