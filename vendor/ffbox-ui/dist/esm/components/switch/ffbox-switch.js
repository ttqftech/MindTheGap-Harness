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
let FFBoxSwitch = class extends i$1 {
  constructor() {
    super(...arguments);
    this.checked = false;
    this.theme = "light";
  }
  render() {
    return b`
			<div class="switch-track" @mousedown=${this._handleDragStart} @touchstart=${this._handleDragStart}>
				<div
					class="switch-track-background"
					style="width: ${this.checked ? "100%" : "0%"}"
				></div>
				<button
					class="switch-slipper"
					style="left: ${this.checked ? "64px" : "0px"}"
					@keydown=${this._handleKeydown}
					@keyup=${this._handleKeyup}
					aria-label="开关"
					role="switch"
					aria-checked=${this.checked}
				></button>
			</div>
		`;
  }
  _handleDragStart(event) {
    event.preventDefault();
    const beforeChecked = this.checked;
    const mouseDownX = event.pageX ?? event.touches[0].pageX;
    let sliderLeft, sliderWidth;
    const target = event.target;
    if (target === this.slipperEl) {
      sliderLeft = target.parentElement.getBoundingClientRect().left;
      sliderWidth = target.parentElement.offsetWidth;
    } else {
      sliderLeft = target.getBoundingClientRect().left;
      sliderWidth = target.offsetWidth;
    }
    let lastValue = NaN;
    const handleMouseMove = (e2) => {
      var _a, _b;
      const pageX = e2.pageX ?? ((_b = (_a = e2.touches) == null ? void 0 : _a[0]) == null ? void 0 : _b.pageX) ?? mouseDownX;
      let valueX = Math.floor(pageX) - sliderLeft;
      let newValue;
      if (valueX < sliderWidth / 2) {
        newValue = false;
      } else {
        newValue = true;
      }
      if (newValue !== lastValue) {
        this._emitChange(newValue);
        lastValue = newValue;
      }
    };
    const handleMouseUp = (e2) => {
      var _a, _b;
      const pageX = e2.pageX ?? ((_b = (_a = e2.changedTouches) == null ? void 0 : _a[0]) == null ? void 0 : _b.pageX) ?? mouseDownX;
      if (Math.abs(mouseDownX - Math.floor(pageX)) <= 3) {
        if (this.checked && beforeChecked) {
          this._emitChange(false);
        } else if (!this.checked && !beforeChecked) {
          this._emitChange(true);
        }
      }
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("touchmove", handleMouseMove);
      document.removeEventListener("touchend", handleMouseUp);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("touchmove", handleMouseMove);
    document.addEventListener("touchend", handleMouseUp);
    handleMouseMove({ pageX: mouseDownX });
  }
  _handleKeydown(event) {
    if (event.key === "ArrowLeft") {
      this._emitChange(false);
    } else if (event.key === "ArrowRight") {
      this._emitChange(true);
    }
  }
  _handleKeyup(event) {
    if (event.key === " " || event.key === "Enter") {
      this._emitChange(!this.checked);
    }
  }
  _emitChange(value) {
    this.checked = value;
    this.dispatchEvent(new CustomEvent("change", {
      detail: value,
      bubbles: true,
      composed: true
    }));
  }
};
FFBoxSwitch.styles = i`
		:host {
			display: inline-block;
		}

		// :host([data-theme="dark"]) {
		// 	outline: red 1px solid;	// 测试 theme 响应
		// }
	
		.switch-track {
			position: relative;
			height: 24px;
			width: 88px;
			border-radius: 24px;
			background: var(--f7, #F7F7F7);
			border: #CCC 1px solid;
			box-shadow: 0px 4px 4px rgba(0, 0, 0, 0.1) inset;
			cursor: pointer;
			user-select: none;
		}

		.switch-track-background {
			position: absolute;
			height: 24px;
			border-radius: 24px;
			background: hsl(210, 85%, 60%);
			box-shadow: 0px 4px 4px rgba(0, 0, 0, 0.1) inset;
			transition: all 0.15s ease-out;
		}

		.switch-slipper {
			position: absolute;
			top: 0;
			height: 24px;
			width: 24px;
			border-radius: 50%;
			background: linear-gradient(180deg, #fefefe, #f0f0f0);
			box-shadow: 0px 1px 3px 0px rgba(0, 0, 0, 0.3);
			transform: scale(1.25);
			transition: all 0.15s ease-out;
			border: none;
			outline: none;
			cursor: pointer;
		}

		.switch-slipper:hover {
			background: linear-gradient(180deg, #ffffff, #fefefe);
		}

		.switch-slipper:active {
			background: linear-gradient(180deg, #f0f0f0, #ededed);
		}
	`;
__decorateClass([
  n({ type: Boolean, reflect: true })
], FFBoxSwitch.prototype, "checked", 2);
__decorateClass([
  c({ context: themeContext, subscribe: true }),
  n({ reflect: true, attribute: "data-theme" })
], FFBoxSwitch.prototype, "theme", 2);
__decorateClass([
  e(".switch-slipper")
], FFBoxSwitch.prototype, "slipperEl", 2);
FFBoxSwitch = __decorateClass([
  t("ffbox-switch")
], FFBoxSwitch);
export {
  FFBoxSwitch
};
//# sourceMappingURL=ffbox-switch.js.map
