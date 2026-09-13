import "../theme-provider/ffbox-theme-provider.js";
import "../button/ffbox-button.js";
import { a as i, c as n, d as c, r, i as i$1, o, b, t } from "../../lit.js";
import { t as themeContext } from "../../contexts/theme-context.js";
import { a as durationValidator, d as durationFixer } from "../../utils/ffbox-utils.js";
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
let FFBoxCutTimeInput = class extends i$1 {
  constructor() {
    super(...arguments);
    this.value = [void 0, void 0];
    this.disabled = false;
    this.theme = "light";
    this._inputText = [void 0, void 0];
    this._focused = [false, false];
  }
  /** 两个输入框任一校验不通过时的提示文本 */
  get _invalidMsg() {
    return durationValidator(this._inputText[0] ?? "") || durationValidator(this._inputText[1] ?? "");
  }
  get _selectorStyle() {
    const ret = {};
    if (this._invalidMsg) {
      ret.border = "var(--errorBorder) 1px solid";
      ret.boxShadow = "0 0 12px hsla(0, 100%, 60%, 0.3), 0px 4px 8px rgba(0, 0, 0, 0.05)";
      if (this._focused[0] || this._focused[1]) {
        ret.background = "var(--errorBgActive)";
      } else {
        ret.background = "var(--errorBg)";
      }
    } else {
      if (this._focused[0] || this._focused[1]) {
        ret.background = "var(--ff)";
      }
    }
    if (this.disabled) {
      ret.opacity = "0.6";
      ret.color = "var(--66)";
      ret.background = "var(--f7)";
    }
    return ret;
  }
  // 监听 value，并在其更新时依此更新内部 inputText（与输入框双向绑定）
  willUpdate(changed) {
    if (changed.has("value")) {
      const [from, to] = this.value ?? [void 0, void 0];
      if (this._inputText[0] !== from || this._inputText[1] !== to) {
        this._inputText = [from, to];
      }
    }
  }
  render() {
    var _a, _b;
    return b`
			<div class="inputbox-selector">
				<div class="inputbox-selectorBackground-wrapper">
					<div style=${o(this._selectorStyle)}></div>
				</div>
				<input
					?disabled=${this.disabled}
					.value=${this._inputText[0] ?? ""}
					.placeholder=${((_a = this.placeholder) == null ? void 0 : _a[0]) ?? ""}
					@blur=${() => this._handleBlur(0)}
					@focus=${() => this._handleFocus(0)}
					@input=${(e) => this._handleInput(e, 0)}
					@keydown=${this._handleKeydown}
				>
				<div class="opButton">
					<div class="hiddenButton">
						<ffbox-button size="small" type="danger" @click=${this._handleClear}>清空</ffbox-button>
					</div>
					<ffbox-button size="small" @click=${this._handleButtonClick}>编✂️辑</ffbox-button>
				</div>
				<input
					?disabled=${this.disabled}
					.value=${this._inputText[1] ?? ""}
					.placeholder=${((_b = this.placeholder) == null ? void 0 : _b[1]) ?? ""}
					@blur=${() => this._handleBlur(1)}
					@focus=${() => this._handleFocus(1)}
					@input=${(e) => this._handleInput(e, 1)}
					@keydown=${this._handleKeydown}
				>
			</div>
		`;
  }
  _handleBlur(index) {
    this._focused = index === 0 ? [false, this._focused[1]] : [this._focused[0], false];
  }
  _handleFocus(index) {
    this._focused = index === 0 ? [true, this._focused[1]] : [this._focused[0], true];
  }
  _handleInput(event, index) {
    const input = event.target;
    const fixed = durationFixer(input.value);
    const newValue = [this._inputText[0], this._inputText[1]];
    newValue[index] = fixed;
    this._inputText = newValue;
    if (input.value !== fixed) {
      input.value = fixed;
    }
    this.value = newValue;
    this._emitChange();
  }
  _handleKeydown(event) {
    if (event.key === "Enter") {
      this.dispatchEvent(new CustomEvent("enter", { bubbles: true, composed: true }));
    }
  }
  _handleClear(e) {
    e.stopImmediatePropagation();
    this._inputText = ["", ""];
    this.value = ["", ""];
    this._emitChange();
  }
  _handleButtonClick(e) {
    e.stopImmediatePropagation();
    this.dispatchEvent(new CustomEvent("button-click", { bubbles: true, composed: true }));
  }
  _emitChange() {
    this.dispatchEvent(new CustomEvent("change", {
      detail: [this._inputText[0], this._inputText[1]],
      bubbles: true,
      composed: true
    }));
  }
};
FFBoxCutTimeInput.styles = i`
		:host {
			display: inline-block;
		}

		.inputbox-selector {
			position: relative;
			display: flex;
			justify-content: center;
			align-items: center;
			gap: 6px;
			height: 24px;
			flex-grow: 1;
			margin: 15px 0;
		}

		.inputbox-selector:hover .inputbox-selectorBackground-wrapper > div {
			background: var(--ff);
		}

		.inputbox-selectorBackground-wrapper {
			position: absolute;
			top: -4px;
			left: -8px;
			width: calc(100% + 16px);
			height: calc(100% + 16px);
			-webkit-mask-image: linear-gradient(to right, black calc(50% - 34px), #0003 calc(50% - 18px), #0003 calc(50% + 18px), black calc(50% + 34px));
			z-index: -1;
		}

		.inputbox-selectorBackground-wrapper > div {
			position: absolute;
			top: 3px;	/* border 有 1px 往下顶，所以这里减去 1px */
			left: 8px;
			width: calc(100% - 16px);
			height: calc(100% - 16px);
			border-radius: 24px;
			background: var(--f7);
			border: #AAA 1px solid;
			box-shadow: 0px 4px 8px rgba(0, 0, 0, 0.1);
			transition: box-shadow 0.2s linear, border 0.2s linear;
		}

		.inputbox-selector > input {
			width: calc(50% - 28px - 12px);
			height: 24px;
			line-height: 24px;
			background: none;
			border: none;
			margin: 0;
			padding: 0;
			outline: none;
			font-family: inherit;
			font-size: 13px;
			text-align: center;
			color: inherit;
		}

		.inputbox-selector > input::placeholder {
			font-size: 13px;
			opacity: 0.1;
			font-style: italic;
			transition: opacity 0.15s linear;
		}

		.inputbox-selector > input:hover::placeholder {
			font-size: 13px;
			opacity: 0.25;
		}

		.opButton {
			position: relative;
			display: flex;
			align-items: center;
		}

		.opButton ffbox-button {
			width: 60px; /* TODO: 由于 Shadow DOM 机制，此设定失效 */
		}

		.opButton:hover .hiddenButton {
			height: calc(24px + 24px);
			transform: translateY(-24px);
			opacity: 1;
			pointer-events: auto;
			/* outline: red 1px solid; */
			transition: transform 0.4s cubic-bezier(0.2, 1.5, 0.3, 1);
		}

		.hiddenButton {
			position: absolute;
			top: 0;
			left: 0;
			height: 24px;
			opacity: 0;
			/* 原版未处理：opacity 为 0 时仍会拦截点击，此处补充 pointer-events */
			pointer-events: none;
			transition: transform 0.4s, opacity 0.1s;
		}
	`;
__decorateClass([
  n({ attribute: false })
], FFBoxCutTimeInput.prototype, "value", 2);
__decorateClass([
  n({ type: Boolean, reflect: true })
], FFBoxCutTimeInput.prototype, "disabled", 2);
__decorateClass([
  n({ attribute: false })
], FFBoxCutTimeInput.prototype, "placeholder", 2);
__decorateClass([
  c({ context: themeContext, subscribe: true }),
  n({ reflect: true, attribute: "data-theme" })
], FFBoxCutTimeInput.prototype, "theme", 2);
__decorateClass([
  r()
], FFBoxCutTimeInput.prototype, "_inputText", 2);
__decorateClass([
  r()
], FFBoxCutTimeInput.prototype, "_focused", 2);
FFBoxCutTimeInput = __decorateClass([
  t("ffbox-cut-time-input")
], FFBoxCutTimeInput);
export {
  FFBoxCutTimeInput
};
//# sourceMappingURL=ffbox-cut-time-input.js.map
