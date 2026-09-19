/* ==========================================================================
   FFBox-UI × Solid.js 的 JSX 类型增强（本文件必须保留 —— 组件库不会提供它）

   为什么需要本文件：
   FFBox-UI 是 Web Component（Lit 实现），在 TS 眼里组件类只是 HTMLElement，
   无法推断 <ffbox-xxx> 在 JSX 里能写哪些属性 / 事件。而 Solid 的自定义元素
   JSX 类型完全由使用方声明（IntrinsicElements），所以这份映射只能手写。
   升级组件库只需保证下面 import type 的名字仍存在，映射本身不变。

   类型来源：FFBox-UI 0.7.0 起 dist 自带 .d.ts（vendor/ffbox-ui/dist），
   经根 tsconfig paths 的 "ffbox-ui" 映射解析（TS 不认 vite alias，见易错点）。

   本文件**必须**是模块（有顶层 import），这样下面的 declare module 'solid-js'
   才是「模块增强」而不是把 solid-js 整个替换成环境模块声明。

   Solid 要点：
   - 自定义元素（标签名含 `-`）的属性默认走 setAttribute。传对象 / 布尔值时必须用
     `prop:` 前缀（如 `prop:list`、`prop:checked`），否则会被转成字符串。
     尤其布尔属性：Lit 的 Boolean converter 是 `value !== null`，
     setAttribute('disabled', false) 依然会判定为 true，`prop:` 才能正确关闭。
   - 事件统一写成 onXXX，Solid 会 addEventListener(去掉 on 并小写的名字)。
     组件派发的都是 CustomEvent，detail 即载荷。

   ⚠️ style 对象（csstype 的用途）：
   项目约定 style 用小驼峰（AGENTS.md），但 Solid 自带 JSX.CSSProperties
   只收 kebab-case（其底层就是 csstype 的 PropertiesHyphen）。这里把 camelCase
   版 csstype.Properties 合并进来，两种写法都合法（运行时 Solid 两种都能设置）。
   csstype 是 CSS 类型的标准定义包，纯类型、零运行时开销，且本来就是 solid-js
   的传递依赖（solid-js 依赖 csstype），这里只是显式声明为 devDependency 以便 import。
   ========================================================================== */

import type {
	ButtonSize,
	ButtonType,
	CutTimeValue,
	FFBoxAutoSizeWrapper,
	FFBoxButton,
	FFBoxCheckbox,
	FFBoxControlBox,
	FFBoxCutTimeInput,
	FFBoxDropdownInput,
	FFBoxInputAutoSize,
	FFBoxMenu,
	FFBoxMsgbox,
	FFBoxNormalInput,
	FFBoxPopup,
	FFBoxRadio,
	FFBoxRadioList,
	FFBoxRockerSwitch,
	FFBoxSlider,
	FFBoxSwitch,
	FFBoxThemeProvider,
	FFBoxTooltip,
	MenuItem,
	RadioListItem,
	Size,
	Theme,
} from 'ffbox-ui';
import type { Properties as CssProperties } from 'csstype';

declare module 'solid-js' {
	namespace JSX {
		/** camelCase 兼容（见文件头说明），与 Solid 自带的 kebab-case 版声明合并 */
		interface CSSProperties extends CssProperties {}

		/** 所有 ffbox 自定义元素共有的原生属性 */
		interface FFBoxElementBaseProps<T> {
			ref?: T | ((el: T) => void);
			class?: string;
			classList?: Record<string, boolean | undefined>;
			style?: string | JSX.CSSProperties;
			id?: string;
			title?: string;
			children?: JSX.Element;
		}

		interface IntrinsicElements {
			'ffbox-theme-provider': FFBoxElementBaseProps<FFBoxThemeProvider> & {
				theme?: Theme;
				'prop:theme'?: Theme;
			};

			'ffbox-button': FFBoxElementBaseProps<FFBoxButton> & {
				type?: ButtonType;
				size?: ButtonSize;
				'prop:disabled'?: boolean;
				onclick?: (e: MouseEvent) => void;
			};

			'ffbox-switch': FFBoxElementBaseProps<FFBoxSwitch> & {
				'prop:checked'?: boolean;
				onchange?: (e: CustomEvent<boolean>) => void;
			};

			'ffbox-checkbox': FFBoxElementBaseProps<FFBoxCheckbox> & {
				'prop:checked'?: boolean | 'partial';
				'prop:disabled'?: boolean;
				onchange?: (e: CustomEvent<boolean | 'partial'>) => void;
			};

			'ffbox-radio': FFBoxElementBaseProps<FFBoxRadio> & {
				'prop:checked'?: boolean | 'partial';
				'prop:disabled'?: boolean;
				onchange?: (e: CustomEvent<boolean | 'partial'>) => void;
			};

			'ffbox-rocker-switch': FFBoxElementBaseProps<FFBoxRockerSwitch> & {
				size?: 's' | 'm';
				'prop:disabledLeft'?: boolean;
				'prop:disabledRight'?: boolean;
			};

			'ffbox-slider': FFBoxElementBaseProps<FFBoxSlider> & {
				'prop:value'?: number | string;
				'prop:min'?: number;
				'prop:max'?: number;
				'prop:tags'?: [number, string][] | Map<number, string>;
				onchange?: (e: CustomEvent<number | string>) => void;
			};

			'ffbox-normal-input': FFBoxElementBaseProps<FFBoxNormalInput> & {
				value?: string;
				type?: 'text' | 'password';
				placeholder?: string;
				'prop:value'?: string;
				'prop:disabled'?: boolean;
				'prop:validator'?: (value: string) => string | undefined;
				'prop:inputFixer'?: (value: string) => string;
				onchange?: (e: CustomEvent<string>) => void;
				onenter?: (e: CustomEvent<void>) => void;
			};

			'ffbox-input-auto-size': FFBoxElementBaseProps<FFBoxInputAutoSize> & {
				value?: string;
				'prop:value'?: string;
			};

			'ffbox-control-box': FFBoxElementBaseProps<FFBoxControlBox> & {
				title?: string;
				description?: string;
			};

			'ffbox-radio-list': FFBoxElementBaseProps<FFBoxRadioList> & {
				placeholder?: string;
				'prop:list'?: RadioListItem[];
				'prop:value'?: string;
				onchange?: (e: CustomEvent<string>) => void;
			};

			'ffbox-auto-size-wrapper': FFBoxElementBaseProps<FFBoxAutoSizeWrapper> & {
				'use-resize-observer'?: boolean;
				'prop:customStyle'?: (size: Size) => Record<string, string>;
				onresize?: (e: CustomEvent<Size>) => void;
			};

			'ffbox-cut-time-input': FFBoxElementBaseProps<FFBoxCutTimeInput> & {
				'prop:value'?: CutTimeValue;
				'prop:disabled'?: boolean;
				'prop:placeholder'?: [string, string];
				onchange?: (e: CustomEvent<CutTimeValue>) => void;
			};

			/** 下拉输入框：list / validator 是对象属性，必须用 prop: 前缀 */
			'ffbox-dropdown-input': FFBoxElementBaseProps<FFBoxDropdownInput> & {
				placeholder?: string;
				readonly?: boolean;
				'prop:text'?: string | number;
				'prop:list'?: MenuItem[];
				'prop:readonly'?: boolean;
				'prop:disabled'?: boolean;
				'prop:validator'?: (value: string) => string | undefined;
				'prop:inputFixer'?: (value: string) => string;
				onchange?: (e: CustomEvent<string>) => void;
				onenter?: (e: CustomEvent<void>) => void;
			};

			'ffbox-menu': FFBoxElementBaseProps<FFBoxMenu> & {
				'prop:menu'?: MenuItem[];
			};

			'ffbox-msgbox': FFBoxElementBaseProps<FFBoxMsgbox> & {
				title?: string;
			};

			'ffbox-popup': FFBoxElementBaseProps<FFBoxPopup> & {
				message?: string;
				level?: 0 | 1 | 2 | 3;
			};

			'ffbox-tooltip': FFBoxElementBaseProps<FFBoxTooltip> & {
				content?: string;
			};
		}
	}
}
