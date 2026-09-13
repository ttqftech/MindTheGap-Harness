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
let FFBoxRadio = class extends i$1 {
  constructor() {
    super(...arguments);
    this.checked = false;
    this.disabled = false;
    this.theme = "light";
  }
  render() {
    const isSelected = this.checked === true || this.checked === "partial";
    return b`
			<div
				class=${["box", isSelected ? "boxSelected" : ""].filter(Boolean).join(" ")}
				@click=${this._handleClick}
				style="cursor: ${this.disabled ? "not-allowed" : "pointer"}"
			>
				<div class="round"></div>
			</div>
		`;
  }
  _handleClick() {
    if (this.disabled) return;
    const newValue = this.checked === true ? false : true;
    this.checked = newValue;
    this.dispatchEvent(new CustomEvent("change", {
      detail: newValue,
      bubbles: true,
      composed: true
    }));
  }
};
FFBoxRadio.styles = i`
		:host {
			display: inline-block;
			font-size: 0; /* 纯 HTML 状态下，代码中的换行会被渲染出来，需要设置为 0 来屏蔽 */
		}

		// :host([data-theme="dark"]) {
		// 	outline: red 1px solid;	// 测试 theme 响应
		// }

		.box {
			position: relative;
			box-sizing: border-box;
			width: 20px;
			height: 20px;
			display: inline-block;
			background-color: hwb(var(--bg98) / 0.8);
			border: hwb(0 80% 20%) 1px solid;
			border-radius: 10px;
			box-shadow: 0 2px 2px hwb(0 80% 20% / 0.2);
		}

		:host([disabled]) .box {
			cursor: not-allowed;
		}

		.round {
			position: absolute;
			left: 5px;
			top: 5px;
			width: 10px;
			height: 10px;
			border-radius: 5px;
			background-color: transparent;
		}

		.boxSelected {
			background-color: hwb(220 25% 10%);
			border: none;
			box-shadow: 0 2px 4px hwb(220 25% 10% / 0.2);
		}

		.boxSelected .round {
			background-color: #FFF;
		}
	`;
__decorateClass([
  n({
    reflect: true,
    converter: {
      fromAttribute: (value) => {
        if (value === null || value === "false") return false;
        if (value === "" || value === "true") return true;
        return value;
      },
      toAttribute: (value) => {
        if (value === false) return null;
        if (value === true) return "";
        return value;
      }
    }
  })
], FFBoxRadio.prototype, "checked", 2);
__decorateClass([
  n({ type: Boolean, reflect: true })
], FFBoxRadio.prototype, "disabled", 2);
__decorateClass([
  c({ context: themeContext, subscribe: true }),
  n({ reflect: true, attribute: "data-theme" })
], FFBoxRadio.prototype, "theme", 2);
FFBoxRadio = __decorateClass([
  t("ffbox-radio")
], FFBoxRadio);
export {
  FFBoxRadio
};
//# sourceMappingURL=ffbox-radio.js.map
