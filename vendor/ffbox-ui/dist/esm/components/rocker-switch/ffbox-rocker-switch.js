import "../theme-provider/ffbox-theme-provider.js";
import { a as i, c as n, d as c, i as i$1, b, t } from "../../lit.js";
import { t as themeContext } from "../../contexts/theme-context.js";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i2 = decorators.length - 1, decorator; i2 >= 0; i2--)
    if (decorator = decorators[i2])
      result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};
let FFBoxRockerSwitch = class extends i$1 {
  constructor() {
    super(...arguments);
    this.size = "s";
    this.disabledLeft = false;
    this.disabledRight = false;
    this.theme = "light";
  }
  render() {
    return b`
			<div class="rockerSwitch">
				<div class="buttonWrapper">
					<button class="arrow arrowLeft" ?disabled=${this.disabledLeft} @click=${this._goLeft}>&#9664;</button>
					<button class="arrow arrowRight" ?disabled=${this.disabledRight} @click=${this._goRight}>&#9654;</button>
				</div>
				<span class="label"><slot></slot></span>
			</div>
		`;
  }
  _goLeft() {
    if (this.disabledLeft) return;
    this.dispatchEvent(new CustomEvent("left", { bubbles: true, composed: true }));
  }
  _goRight() {
    if (this.disabledRight) return;
    this.dispatchEvent(new CustomEvent("right", { bubbles: true, composed: true }));
  }
};
FFBoxRockerSwitch.styles = i`
		:host {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			isolation: isolate;
			opacity: 0.7;
		}

		// :host([data-theme="dark"]) {
		// 	outline: red 1px solid;	// 测试 theme 响应
		// }

		.rockerSwitch {
			position: relative;
			// height: 取决于尺寸;
			// flex: 0 0 auto;
			display: flex;
			align-items: center;
			justify-content: center;
			isolation: isolate;
			opacity: 0.7;
		}

		.buttonWrapper {
			position: absolute;
			width: 100%;
			height: 100%;
			display: flex;
			align-items: center;
			justify-content: stretch;
			z-index: -1;
			-webkit-mask-image: linear-gradient(to right, black 25%, transparent 50%, black 75%);
		}

		.arrow {
			flex: 1 1 auto;
			margin: 0 4px;
			border: none;
			background: none;
			color: inherit;
			border-radius: 4px;
			line-height: 1;
			cursor: pointer;
			font-family: inherit;
		}

		.arrow:hover:not(:disabled) {
			background-color: hwb(var(--bg99) / 0.4);
			box-shadow:
				0 1px 4px hwb(var(--hoverShadow) / 0.2),
				0 4px 2px -2px hwb(var(--highlight) / 0.5) inset;
		}

		.arrow:active:not(:disabled) {
			box-shadow:
				0 0px 1px hwb(var(--hoverShadow) / 0.2),
				0 20px 15px -10px hwb(var(--hoverShadow) / 0.15) inset;
			transform: translateY(0.25px);
		}

		.arrow:disabled {
			opacity: 0.3;
			cursor: default;
		}

		.arrowLeft { text-align: left; }
		.arrowRight { text-align: right; }

		.label {
			pointer-events: none;
		}

		/* Size: s */
		:host([size="s"]) .rockerSwitch { height: 30px; }
		:host([size="s"]) .arrow { height: 22px; font-size: 12px; }
		:host([size="s"]) .label { font-size: 12px; padding: 0 26px; }

		/* Size: m */
		:host([size="m"]) .rockerSwitch { height: 35px; }
		:host([size="m"]) .arrow { height: 26px; font-size: 13.5px; }
		:host([size="m"]) .label { font-size: 13.5px; padding: 0 30px; }
	`;
__decorateClass([
  n({ reflect: true })
], FFBoxRockerSwitch.prototype, "size", 2);
__decorateClass([
  n({ type: Boolean, attribute: "disabled-left" })
], FFBoxRockerSwitch.prototype, "disabledLeft", 2);
__decorateClass([
  n({ type: Boolean, attribute: "disabled-right" })
], FFBoxRockerSwitch.prototype, "disabledRight", 2);
__decorateClass([
  c({ context: themeContext, subscribe: true }),
  n({ reflect: true, attribute: "data-theme" })
], FFBoxRockerSwitch.prototype, "theme", 2);
FFBoxRockerSwitch = __decorateClass([
  t("ffbox-rocker-switch")
], FFBoxRockerSwitch);
export {
  FFBoxRockerSwitch
};
//# sourceMappingURL=ffbox-rocker-switch.js.map
