/* ==========================================================================
   FFBox-UI 类型声明（手写）

   FFBox-UI 尚未发布 npm，其构建产物只含 JS、不含 .d.ts，因此这里手工维护声明。
   来源：A:\Code\FFBox\FFBox-UI（版本 0.7.0），产物拷贝到 vendor/ffbox-ui/dist。

   注意：本文件是「全局脚本」（没有顶层 import / export），
   所以这里的 declare module 是环境模块声明（ambient module declaration）。
   Solid JSX 的 IntrinsicElements 扩展在 ffbox-ui-jsx.d.ts（那边必须写成模块才能做模块增强）。
   升级组件库后，请对照 A:\Code\FFBox\FFBox-UI\src 同步本文件。
   ========================================================================== */

declare module 'ffbox-ui' {
	/** 主题值 */
	export type Theme = 'light' | 'dark';

	/** 按钮类型 */
	export type ButtonType = 'normal' | 'primary' | 'danger' | 'noBg';
	/** 按钮尺寸 */
	export type ButtonSize = 'small' | 'normal' | 'large';

	/** Lit 模板结果。本项目不使用 lit，仅用于类型占位（菜单图标等） */
	export type TemplateResult = { readonly _$litType$?: unknown };

	/** 尺寸测量结果 */
	export interface Size {
		width: number;
		height: number;
	}

	/** 菜单项（联合类型） */
	export type MenuItem<E = any> =
		| {
				type: 'normal';
				value: any;
				label: string;
				icon?: TemplateResult;
				tooltip?: string;
				disabled?: boolean;
				onClick?: (event: Event, value: any) => boolean | void;
				extra?: E;
		  }
		| {
				type: 'separator';
		  }
		| {
				type: 'submenu';
				label: string;
				tooltip?: string;
				subMenu: MenuItem<E>[];
				disabled?: boolean;
				key?: number;
		  }
		| {
				type: 'checkbox' | 'radio';
				value: any;
				checked: boolean;
				label: string;
				tooltip?: string;
				disabled?: boolean;
				extra?: E;
		  };

	export type NarrowedMenuItem = Extract<MenuItem, { type: 'normal' }>;

	/** 深度优先搜索，根据 value 取得第一个匹配的菜单项 */
	export function getMenuItemByValue<E>(
		menu: MenuItem<E>[],
		value: any,
		compareFunc?: (itemValue: any, yourValue: any) => boolean,
	): Extract<MenuItem<E>, { type: 'normal' | 'checkbox' | 'radio' }> | undefined;

	/** 主题上下文（@lit/context），本项目仅透传，不直接使用 */
	export interface ThemeContext {
		readonly __brand: 'ffbox-theme';
	}
	export const themeContext: ThemeContext;

	/* ---------------- 基础组件 ---------------- */

	export class FFBoxThemeProvider extends HTMLElement {
		theme: Theme;
	}

	export class FFBoxButton extends HTMLElement {
		type: ButtonType;
		size: ButtonSize;
		disabled: boolean;
		theme: Theme;
	}

	export class FFBoxSwitch extends HTMLElement {
		checked: boolean;
		theme: Theme;
	}

	export class FFBoxCheckbox extends HTMLElement {
		checked: boolean | 'partial';
		disabled: boolean;
		theme: Theme;
	}

	export class FFBoxRadio extends HTMLElement {
		checked: boolean | 'partial';
		disabled: boolean;
		theme: Theme;
	}

	export class FFBoxRockerSwitch extends HTMLElement {
		size: 's' | 'm';
		disabledLeft: boolean;
		disabledRight: boolean;
		theme: Theme;
	}

	export class FFBoxSlider extends HTMLElement {
		value?: number | string;
		min: number;
		max: number;
		arrowKeyStep?: number;
		adsorption?: 'int' | 'tags' | ((value: number) => number);
		tags?: [number, string][] | Map<number, string>;
		mode?: 'number' | 'string';
		valueToDisplay?:
			| { base?: number; type?: 'bitrate' | 'integer' | 'revertInteger' }
			| ((value: number | string | undefined) => string);
		useIEC: boolean;
		theme: Theme;
	}

	export class FFBoxNormalInput extends HTMLElement {
		value: string;
		type: 'text' | 'password';
		disabled: boolean;
		placeholder: string;
		validator?: (value: string) => string | undefined;
		inputFixer?: (value: string) => string;
		theme: Theme;
	}

	export class FFBoxInputAutoSize extends HTMLElement {
		value: string;
		focusOnMounted: boolean;
		theme: Theme;
	}

	export class FFBoxControlBox extends HTMLElement {
		title: string;
		description: string;
		long: boolean;
		optional: boolean;
		hasValue: boolean;
		theme: Theme;
	}

	export interface RadioListItem {
		value: string;
		caption?: string;
		deletable?: boolean;
		editable?: boolean;
		disabled?: boolean;
	}

	export class FFBoxRadioList extends HTMLElement {
		list: RadioListItem[];
		value: string;
		placeholder: string;
		theme: Theme;
	}

	export class FFBoxAutoSizeWrapper extends HTMLElement {
		useResizeObserver: boolean;
		customStyle?: (size: Size) => Record<string, string>;
		readonly width: number;
		readonly height: number;
		theme: Theme;
		updateSize(): void;
	}

	export type CutTimeValue = [string | undefined, string | undefined];

	export class FFBoxCutTimeInput extends HTMLElement {
		value: CutTimeValue;
		disabled: boolean;
		placeholder: [string, string];
		theme: Theme;
	}

	/* ---------------- 命令式组件 ---------------- */

	export interface MsgboxButton {
		text: string;
		/** 返回 false 保持打开；返回 Promise 则 resolve 后关闭 */
		callback?: () => boolean | Promise<void> | void;
		type?: ButtonType;
		role?: 'confirm' | 'cancel';
	}

	export interface MsgboxOptions {
		container?: HTMLElement;
		image?: TemplateResult;
		title?: string;
		content?: string | TemplateResult | (() => TemplateResult);
		buttons?: MsgboxButton[];
	}

	export class FFBoxMsgbox extends HTMLElement {
		/** 创建并显示一个对话框，返回组件实例（关闭动画结束后自行从 DOM 移除） */
		static show: (options?: MsgboxOptions) => FFBoxMsgbox;
		title: string;
		content?: MsgboxOptions['content'];
		buttons?: MsgboxButton[];
		theme: Theme;
	}

	export interface PopupOptions {
		message: string;
		/** 0 白 | 1 绿 | 2 黄 | 3 红 */
		level?: 0 | 1 | 2 | 3;
	}

	export class FFBoxPopup extends HTMLElement {
		/** 显示一条气泡通知（自动排队、自动倒计时关闭） */
		static show: (options: PopupOptions) => FFBoxPopup;
		message: string;
		level: 0 | 1 | 2 | 3;
		theme: Theme;
	}

	export interface TooltipOptions {
		[key: string]: unknown;
	}

	export class FFBoxTooltip extends HTMLElement {
		theme: Theme;
	}

	export type TooltipPosition = string;
	export type TooltipStyleName = string;

	export function tooltip(...args: unknown[]): unknown;
	export function useTooltip(...args: unknown[]): unknown;
	export function enableTooltipAutoscan(): void;
	export function disableTooltipAutoscan(): void;

	/** FFBoxMenu.showMenu() 的选项 */
	export interface MenuOptions {
		menu: MenuItem[];
		/** select 类型在键盘方向键操作时也会触发 onSelect */
		type?: 'action' | 'select';
		selectedValue?: any;
		/** 挂载容器，不指定则挂到 document.body */
		container?: HTMLElement;
		/** 触发控件坐标，用于计算弹出方向和大小 */
		triggerRect?: { xMin: number; yMin: number; xMax: number; yMax: number };
		/** 触发控件元素；未显式传 triggerRect 时以其 getBoundingClientRect() 计算 */
		triggerElem?: HTMLElement;
		disableOnClick?: boolean;
		/** action 模式下不定义此项或返回 false 则转而触发 menuItem 的 onClick */
		onSelect?: (event: Event, value: any, checked?: boolean) => void | false;
		/** 遮罩点击 / Esc 时触发，返回 false 不关闭 */
		onCancel?: (event: Event) => void | false;
		onClose?: () => void;
		onKeyDown?: (event: KeyboardEvent) => void;
		returnFocus?: (event: Event) => void;
	}

	/** FFBoxMenu.showMenu() 的返回句柄 */
	export interface FFBoxMenuHandle {
		menu: FFBoxMenu;
		close: () => void;
		triggerKeyboardEvent: (event: KeyboardEvent) => void;
		setSelectedValue: (value: any) => void;
	}

	export class FFBoxMenu extends HTMLElement {
		/** 创建并显示一个命令式菜单 */
		static showMenu: (options: MenuOptions) => FFBoxMenuHandle;
		theme: Theme;
	}

	export class FFBoxDropdownInput extends HTMLElement {
		/** 当前值，同时驱动菜单的选中高亮；选中/输入时组件会同步回写该属性 */
		text?: string | number;
		list: MenuItem[];
		readonly: boolean;
		disabled: boolean;
		placeholder: string;
		validator?: (value: string) => string | undefined;
		inputFixer?: (value: string) => string;
		theme: Theme;
	}

	/* ---------------- 校验 / 修正工具 ---------------- */

	export function durationValidator(value: string): string | undefined;
	export function durationFixer(value: string): string;
	export function numberValidator(value: string): string | undefined;
	export function notEmptyValidator(value: string): string | undefined;
}
