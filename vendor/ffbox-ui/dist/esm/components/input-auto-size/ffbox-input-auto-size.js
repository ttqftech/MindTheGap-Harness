import "../theme-provider/ffbox-theme-provider.js";
import { a as i, c as n, d as c, e, i as i$1, b, t } from "../../lit.js";
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
let FFBoxInputAutoSize = class extends i$1 {
  constructor() {
    super(...arguments);
    this.value = "";
    this.focusOnMounted = false;
    this.theme = "light";
    this._inputWidth = 8;
  }
  connectedCallback() {
    super.connectedCallback();
    this._resizeObserver = new ResizeObserver(() => {
      this._refreshSize();
    });
  }
  firstUpdated() {
    if (this._hiddenDivEl && this._resizeObserver) {
      this._resizeObserver.observe(this._hiddenDivEl);
      this._hiddenDivEl.style.fontFamily = getComputedStyle(this._inputEl).fontFamily;
    }
    if (this.focusOnMounted && this._inputEl) {
      this._inputEl.focus();
    }
  }
  disconnectedCallback() {
    var _a;
    (_a = this._resizeObserver) == null ? void 0 : _a.disconnect();
    super.disconnectedCallback();
  }
  _refreshSize() {
    var _a;
    const rect = (_a = this._hiddenDivEl) == null ? void 0 : _a.getBoundingClientRect();
    if (rect) {
      this._inputWidth = Math.max(8, rect.width);
      this.requestUpdate();
    }
  }
  render() {
    return b`
			<div>
				<input
					type="text"
					.value=${this.value}
					style=${`width: ${this._inputWidth}px`}
					@keydown=${this._handleKeydown}
					@input=${this._handleInput}
					@blur=${this._handleBlur}
					@change=${this._handleChange}
				/>
				<div class="hidden-div">${this.value}</div>
			</div>
		`;
  }
  _handleInput(e2) {
    this.value = e2.target.value;
  }
  _handleKeydown(e2) {
    if (e2.key === "Enter") {
      this.dispatchEvent(new CustomEvent("press-enter", {
        detail: this.value,
        bubbles: true,
        composed: true
      }));
    }
  }
  _handleBlur(e2) {
    e2.stopPropagation();
    this.dispatchEvent(new CustomEvent("blur", {
      detail: this.value,
      bubbles: true,
      composed: true
    }));
  }
  _handleChange(e2) {
    e2.stopPropagation();
    this.dispatchEvent(new CustomEvent("change", {
      detail: this.value,
      bubbles: true,
      composed: true
    }));
  }
};
FFBoxInputAutoSize.styles = i`
		:host {
			display: inline-block;
		}

		.hidden-div {
			display: inline-block;
			position: fixed;
			visibility: hidden;
			font-size: inherit;
		}

		input {
			font-size: inherit;
			font-family: inherit;
		}
	`;
__decorateClass([
  n({ reflect: true })
], FFBoxInputAutoSize.prototype, "value", 2);
__decorateClass([
  n({ type: Boolean, attribute: "focus-on-mounted" })
], FFBoxInputAutoSize.prototype, "focusOnMounted", 2);
__decorateClass([
  c({ context: themeContext, subscribe: true }),
  n({ reflect: true, attribute: "data-theme" })
], FFBoxInputAutoSize.prototype, "theme", 2);
__decorateClass([
  e("input")
], FFBoxInputAutoSize.prototype, "_inputEl", 2);
__decorateClass([
  e(".hidden-div")
], FFBoxInputAutoSize.prototype, "_hiddenDivEl", 2);
FFBoxInputAutoSize = __decorateClass([
  t("ffbox-input-auto-size")
], FFBoxInputAutoSize);
export {
  FFBoxInputAutoSize
};
//# sourceMappingURL=ffbox-input-auto-size.js.map
