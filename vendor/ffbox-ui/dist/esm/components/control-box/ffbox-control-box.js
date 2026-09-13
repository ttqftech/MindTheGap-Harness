import "../theme-provider/ffbox-theme-provider.js";
import "../checkbox/ffbox-checkbox.js";
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
let FFBoxControlBox = class extends i$1 {
  constructor() {
    super(...arguments);
    this.title = "";
    this.description = "";
    this.long = false;
    this.optional = false;
    this.hasValue = false;
    this.theme = "light";
  }
  render() {
    return b`
			<div class="controlBox">
				${this.optional ? b`<ffbox-checkbox
						.checked=${this.hasValue}
						@change=${this._handleCheckboxChange}
					></ffbox-checkbox>` : ""}
				<div
					class="controlBox-title"
					title=${this.description}
				>
					${this.title}
				</div>
				<slot></slot>
			</div>
		`;
  }
  _handleCheckboxChange(e) {
    this.hasValue = e.detail;
    this.dispatchEvent(new CustomEvent("enabledChange", {
      detail: e.detail,
      bubbles: true,
      composed: true
    }));
  }
};
FFBoxControlBox.styles = i`
		:host {
			display: block;
			width: 210px;
			margin: 4px 20px;
			margin-right: 28px;
		}
		:host([long]) {
			width: 100%;
		}
		:host(:not([long])[optional]),
		:host([long]:not([optional])) {
			margin-right: 20px;
		}
		:host([long][optional]) {
			margin-right: 8px;
		}

		.controlBox {
			height: 56px;
			width: 100%;
			display: flex;
			justify-content: space-between;
			align-items: center;
			gap: 4px;
		}

		.controlBox-title {
			min-width: 88px;
			font-size: 14px;
			text-align: center;
		}

		:host([optional]:not([has-value])) .controlBox-title {
			opacity: 0.5;
		}
	`;
__decorateClass([
  n({ reflect: true })
], FFBoxControlBox.prototype, "title", 2);
__decorateClass([
  n({ reflect: true })
], FFBoxControlBox.prototype, "description", 2);
__decorateClass([
  n({ type: Boolean, reflect: true })
], FFBoxControlBox.prototype, "long", 2);
__decorateClass([
  n({ type: Boolean, reflect: true })
], FFBoxControlBox.prototype, "optional", 2);
__decorateClass([
  n({ type: Boolean, reflect: true, attribute: "has-value" })
], FFBoxControlBox.prototype, "hasValue", 2);
__decorateClass([
  c({ context: themeContext, subscribe: true }),
  n({ reflect: true, attribute: "data-theme" })
], FFBoxControlBox.prototype, "theme", 2);
FFBoxControlBox = __decorateClass([
  t("ffbox-control-box")
], FFBoxControlBox);
export {
  FFBoxControlBox
};
//# sourceMappingURL=ffbox-control-box.js.map
