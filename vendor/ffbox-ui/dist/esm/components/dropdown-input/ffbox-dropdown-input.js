import "../theme-provider/ffbox-theme-provider.js";
import { FFBoxMenu } from "../menu/ffbox-menu.js";
import { a as i, c as n, d as c, r, e, i as i$1, h as o, b, t } from "../../lit.js";
import { t as themeContext } from "../../contexts/theme-context.js";
const menuButtonIcon = '<?xml version="1.0" standalone="no"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg t="1565771142011" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="2592" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><style type="text/css"></style></defs><path d="M230.4 588.8c42.415 0 76.8-34.385 76.8-76.8s-34.385-76.8-76.8-76.8-76.8 34.385-76.8 76.8 34.385 76.8 76.8 76.8zM512 588.8c42.415 0 76.8-34.385 76.8-76.8s-34.385-76.8-76.8-76.8-76.8 34.385-76.8 76.8 34.385 76.8 76.8 76.8zM793.6 588.8c42.415 0 76.8-34.385 76.8-76.8s-34.385-76.8-76.8-76.8-76.8 34.385-76.8 76.8 34.385 76.8 76.8 76.8z" fill="#7f7f7f" p-id="2593"></path></svg>';
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
let FFBoxDropdownInput = class extends i$1 {
  constructor() {
    super(...arguments);
    this.list = [];
    this.readonly = false;
    this.disabled = false;
    this.placeholder = "";
    this.theme = "light";
    this._focused = false;
    this._inputText = "-";
    this._invalidMsg = void 0;
    this._menuHandle = null;
    this._openMenu = () => {
      if (this.disabled) {
        return;
      }
      this._menuHandle = FFBoxMenu.showMenu({
        menu: this.list,
        type: "select",
        selectedValue: this.text,
        triggerElem: this._selectorEl,
        // 传入触发元素，菜单据此计算弹出位置与方向
        onSelect: (_event, value) => {
          this._inputText = value;
          this.text = value;
          this._validate();
          this._dispatchChange(value);
          this._menuHandle.setSelectedValue(value);
        },
        onClose: () => {
          this._menuHandle = null;
        },
        returnFocus: (_e) => {
          this._selectorEl.firstElementChild.focus();
        },
        onKeyDown: (e2) => {
          if (["ArrowLeft", "ArrowRight"].includes(e2.key)) {
            let selPos = this._selectorEl.firstChild.selectionStart || 0;
            if (e2.key === "ArrowLeft") {
              selPos--;
            } else if (e2.key === "ArrowRight") {
              selPos++;
            }
            this._selectorEl.firstChild.selectionStart = selPos;
            this._selectorEl.firstChild.selectionEnd = selPos;
          }
        }
      });
      this._selectorEl.firstElementChild.focus();
    };
  }
  willUpdate(changed) {
    if (changed.has("text")) {
      this._inputText = this.text !== void 0 ? this.text + "" : "";
      this._validate();
    }
    if (changed.has("validator")) {
      this._validate();
    }
  }
  render() {
    const classes = ["combobox-selector"];
    if (this._focused) classes.push("focused");
    if (this._invalidMsg) classes.push("invalid");
    return b`
			<div class=${classes.join(" ")} @click=${this._openMenu}>
				<input
					type="text"
					.value=${this._inputText}
					?readonly=${this.readonly || this.disabled}
					?disabled=${this.disabled}
					.placeholder=${this.placeholder}
					@blur=${this._handleBlur}
					@focus=${this._handleFocus}
					@input=${this._handleInput}
					@keydown=${this._handleKeydown}
				/>
				<span class="combobox-selector-img">${o(menuButtonIcon)}</span>
			</div>
		`;
  }
  _handleBlur() {
    this._focused = false;
  }
  _handleFocus() {
    this._focused = true;
  }
  _handleInput(event) {
    var _a;
    const input = event.target;
    this._inputText = this.inputFixer ? this.inputFixer(input.value) : input.value;
    this.text = this._inputText;
    let newValue = input.value;
    (_a = this._menuHandle) == null ? void 0 : _a.setSelectedValue(newValue);
    this._validate();
    this._dispatchChange(newValue);
  }
  _handleKeydown(event) {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Enter", "Escape"].includes(event.key)) {
      if (this._menuHandle) {
        this._menuHandle.triggerKeyboardEvent(event);
        event.preventDefault();
      } else {
        if (event.key === "Enter") {
          this.dispatchEvent(new CustomEvent("enter", {
            bubbles: true,
            composed: true
          }));
        }
        if (["ArrowUp", "ArrowDown", "Enter"].includes(event.key)) {
          this._openMenu();
          event.preventDefault();
        }
      }
    }
  }
  _validate() {
    if (this.validator) {
      this._invalidMsg = this.validator(this._inputText ?? "");
    } else {
      this._invalidMsg = void 0;
    }
  }
  _dispatchChange(value) {
    this.dispatchEvent(new CustomEvent("change", {
      detail: value,
      bubbles: true,
      composed: true
    }));
  }
};
FFBoxDropdownInput.styles = i`
		:host {
			display: inline-block;
		}

		.combobox-selector {
			position: relative;
			height: 24px;
			/* width: 122px; */
			flex-grow: 1;
			border-radius: 24px;
			background: var(--f7);
			border: #AAA 1px solid;
			box-shadow: 0px 4px 8px rgba(0, 0, 0, 0.1);
		}
		.combobox-selector:hover {
			background: var(--ff);
		}
		.combobox-selector:active {
			background: var(--e7);
		}
		.combobox-selector.focused {
			background: var(--ff);
		}
		/* 校验有误的情况下背景和边框都变红 */
		.combobox-selector.invalid {
			border: var(--errorBorder) 1px solid;
			box-shadow: 0 0 12px hsla(0, 100%, 60%, 0.3), 0px 4px 8px hwb(0 0 0 / 0.05);
		}
		.combobox-selector.invalid.focused {
			background: var(--errorBgActive);
		}
		.combobox-selector.invalid:not(.focused) {
			background: var(--errorBg);
		}
		/* 禁用的情况下整体变透明，并且固定背景颜色 */
		:host([disabled]) .combobox-selector {
			opacity: 0.6;
			color: var(--66); /* 默认，20% 亮度黑色，变灰 40% 亮度黑色 */
			background: var(--f7);
		}

		.combobox-selector input {
			position: absolute;
			left: 6px;
			width: calc(100% - 28px);
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

		.combobox-selector-img {
			position: absolute;
			right: 6px;
			top: 4px;
			width: 16px;
			height: 16px;
			font-size: 0; /* 纯 HTML 状态下，代码中的换行会被渲染出来，需要设置为 0 来屏蔽 */
		}
	`;
__decorateClass([
  n({ attribute: false })
], FFBoxDropdownInput.prototype, "text", 2);
__decorateClass([
  n({ attribute: false })
], FFBoxDropdownInput.prototype, "list", 2);
__decorateClass([
  n({ type: Boolean, reflect: true })
], FFBoxDropdownInput.prototype, "readonly", 2);
__decorateClass([
  n({ type: Boolean, reflect: true })
], FFBoxDropdownInput.prototype, "disabled", 2);
__decorateClass([
  n()
], FFBoxDropdownInput.prototype, "placeholder", 2);
__decorateClass([
  n({ attribute: false })
], FFBoxDropdownInput.prototype, "validator", 2);
__decorateClass([
  n({ attribute: false })
], FFBoxDropdownInput.prototype, "inputFixer", 2);
__decorateClass([
  c({ context: themeContext, subscribe: true }),
  n({ reflect: true, attribute: "data-theme" })
], FFBoxDropdownInput.prototype, "theme", 2);
__decorateClass([
  r()
], FFBoxDropdownInput.prototype, "_focused", 2);
__decorateClass([
  r()
], FFBoxDropdownInput.prototype, "_inputText", 2);
__decorateClass([
  r()
], FFBoxDropdownInput.prototype, "_invalidMsg", 2);
__decorateClass([
  e(".combobox-selector")
], FFBoxDropdownInput.prototype, "_selectorEl", 2);
FFBoxDropdownInput = __decorateClass([
  t("ffbox-dropdown-input")
], FFBoxDropdownInput);
export {
  FFBoxDropdownInput
};
//# sourceMappingURL=ffbox-dropdown-input.js.map
