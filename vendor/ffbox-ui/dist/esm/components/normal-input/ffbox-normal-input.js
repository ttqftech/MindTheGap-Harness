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
let FFBoxNormalInput = class extends i$1 {
  constructor() {
    super(...arguments);
    this.value = "";
    this.type = "text";
    this.disabled = false;
    this.placeholder = "";
    this.theme = "light";
    this._focused = false;
  }
  willUpdate(changed) {
    if (changed.has("value") || changed.has("validator")) {
      this._validate(this.value);
    }
  }
  render() {
    const classes = ["inputbox-selector"];
    if (this._focused) classes.push("focused");
    if (this._invalidMsg) classes.push("invalid");
    return b`
			<div class=${classes.join(" ")}>
				<input
					.type=${this.type}
					?disabled=${this.disabled}
					.value=${this.value}
					.placeholder=${this.placeholder}
					@blur=${this._handleBlur}
					@focus=${this._handleFocus}
					@input=${this._handleInput}
					@keydown=${this._handleKeydown}
				/>
			</div>
		`;
  }
  _handleBlur() {
    this._focused = false;
    this.requestUpdate();
  }
  _handleFocus(e) {
    const input = e.target;
    input.selectionEnd = input.selectionStart;
    this._focused = true;
    this.requestUpdate();
  }
  _handleInput(e) {
    const input = e.target;
    let newValue = input.value;
    if (this.inputFixer) {
      newValue = this.inputFixer(newValue);
    }
    this.value = newValue;
    this._validate(newValue);
    this.dispatchEvent(new CustomEvent("change", {
      detail: newValue,
      bubbles: true,
      composed: true
    }));
  }
  _handleKeydown(e) {
    if (e.key === "Enter") {
      this.dispatchEvent(new CustomEvent("enter", {
        bubbles: true,
        composed: true
      }));
    }
  }
  _validate(value) {
    if (this.validator) {
      this._invalidMsg = this.validator(value);
    } else {
      this._invalidMsg = void 0;
    }
  }
};
FFBoxNormalInput.styles = i`
		:host {
			display: inline-block;
		}

		.inputbox-selector {
			position: relative;
			height: 24px;
			flex-grow: 1;
			margin: 15px 0;
			border-radius: 24px;
			background: var(--f7);
			border: #AAA 1px solid;
			box-shadow: 0px 4px 8px rgba(0, 0, 0, 0.1);
			transition: box-shadow 0.2s linear, border 0.2s linear;
		}

		.inputbox-selector:hover {
			background: var(--ff);
		}

		// 这个其实会被 .focused 覆盖，Vue 那边一直有这个问题，而且是通过 style 而不是 class 控制的，代码上没这边好懂
		.inputbox-selector:active {
			background: var(--e7);
		}

		.inputbox-selector.focused {
			background: var(--ff);
		}

		.inputbox-selector.invalid {
			border: var(--errorBorder) 1px solid;
			box-shadow: 0 0 12px hsla(0, 100%, 60%, 0.3), 0px 4px 8px rgba(0, 0, 0, 0.05);
		}

		.inputbox-selector.invalid.focused {
			background: var(--errorBgActive);
		}

		.inputbox-selector.invalid:not(.focused) {
			background: var(--errorBg);
		}

		:host([disabled]) .inputbox-selector {
			opacity: 0.6;
			color: var(--66);
			background: var(--f7);
		}

		.inputbox-selector input {
			position: absolute;
			left: 6px;
			width: calc(100% - 12px);
			height: 24px;
			line-height: 24px;
			background: none;
			border: none;
			margin: 0;
			padding: 0;
			outline: none;
			font-family: inherit;
			font-size: 13px;
			color: inherit;
		}

		.inputbox-selector input::placeholder {
			font-size: 13px;
			opacity: 0.1;
			font-style: italic;
			transition: opacity 0.15s linear;
		}

		.inputbox-selector input:hover::placeholder {
			font-size: 13px;
			opacity: 0.25;
		}
	`;
__decorateClass([
  n({ reflect: true })
], FFBoxNormalInput.prototype, "value", 2);
__decorateClass([
  n({ reflect: true })
], FFBoxNormalInput.prototype, "type", 2);
__decorateClass([
  n({ type: Boolean, reflect: true })
], FFBoxNormalInput.prototype, "disabled", 2);
__decorateClass([
  n()
], FFBoxNormalInput.prototype, "placeholder", 2);
__decorateClass([
  n({ attribute: false })
], FFBoxNormalInput.prototype, "validator", 2);
__decorateClass([
  n({ attribute: false })
], FFBoxNormalInput.prototype, "inputFixer", 2);
__decorateClass([
  c({ context: themeContext, subscribe: true }),
  n({ reflect: true, attribute: "data-theme" })
], FFBoxNormalInput.prototype, "theme", 2);
FFBoxNormalInput = __decorateClass([
  t("ffbox-normal-input")
], FFBoxNormalInput);
export {
  FFBoxNormalInput
};
//# sourceMappingURL=ffbox-normal-input.js.map
