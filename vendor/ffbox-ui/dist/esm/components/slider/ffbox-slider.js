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
let FFBoxSlider = class extends i$1 {
  constructor() {
    super(...arguments);
    this.min = 0;
    this.max = 1;
    this.useIEC = false;
    this.theme = "light";
  }
  get _sortedTags() {
    if (this._tagsRef !== this.tags) {
      this._tagsRef = this.tags;
      if (this.tags instanceof Map) {
        this._sortedTagsCache = [...this.tags.entries()].sort((a, b2) => a[0] - b2[0]);
      } else if (Array.isArray(this.tags)) {
        this._sortedTagsCache = [...this.tags].sort((a, b2) => a[0] - b2[0]);
      } else {
        this._sortedTagsCache = void 0;
      }
    }
    return this._sortedTagsCache;
  }
  get _numericalValue() {
    var _a;
    if (typeof this.value === "string") {
      if ((_a = this._sortedTags) == null ? void 0 : _a.length) {
        const item = this._sortedTags.find((item2) => item2[1] === this.value);
        return item == null ? void 0 : item[0];
      }
      return void 0;
    } else {
      return this.value;
    }
  }
  get _limitedValue() {
    if (typeof this._numericalValue === "number") {
      return (this._numericalValue - this.min) / (this.max - this.min);
    }
    return 0;
  }
  _valueToDisplayConverter(setting) {
    var _a;
    if (setting instanceof Function) {
      return setting(this.value);
    } else if (setting) {
      if (setting.type === "bitrate") {
        const bps = Math.round((setting.base ?? 0) * 2 ** this.value);
        if (this.useIEC) {
          if (bps >= 10 * 1024 ** 2) {
            return (bps / 1024 ** 2).toFixed(1) + " Mibps";
          } else {
            return (bps / 1024).toFixed(0) + " kibps";
          }
        } else {
          if (bps >= 10 * 1e3 ** 2) {
            return (bps / 1e3 ** 2).toFixed(1) + " Mbps";
          } else {
            return (bps / 1e3).toFixed(0) + " Kbps";
          }
        }
      } else if (setting.type === "integer") {
        return this.value.toFixed(0);
      } else if (setting.type === "revertInteger") {
        return (this.max - this.value).toFixed(0);
      } else {
        return String(this.value ?? "");
      }
    } else {
      if (this.mode === "string") {
        if ((_a = this._sortedTags) == null ? void 0 : _a.length) {
          const numVal = this._numericalValue;
          if (numVal !== void 0) {
            const item2 = this._sortedTags.find((item3) => item3[0] === numVal);
            if (item2) return item2[1];
          }
          const item = this._sortedTags.find((item2) => item2[1] === this.value);
          if (item) return item[1];
        }
      }
      return String(this.value ?? "");
    }
  }
  render() {
    var _a;
    const limitedPct = Math.max(0, this._limitedValue * 100);
    const slipperLeft = this._limitedValue * 100;
    return b`
			<div class="slider">
				<div class="slider-module" @mousedown=${this._handleDragStart} @touchstart=${this._handleDragStart}>
					<div class="slider-module-track"></div>
					<div class="slider-module-track-background" style="width: ${limitedPct}%"></div>
					${(_a = this._sortedTags) == null ? void 0 : _a.map(([tagValue, tagLabel]) => {
      const left = (tagValue - this.min) / (this.max - this.min) * 100;
      return b`<span class="slider-module-mark" style="left: ${left}%">${tagLabel}</span>`;
    })}
					${this.value !== void 0 ? b`
						<button
							class="slider-module-slipper"
							style="left: ${slipperLeft}%"
							@keydown=${this._handleKeydown}
							aria-label="滑块"
						></button>
					` : ""}
				</div>
				<div class="slider-text">${this._valueToDisplayConverter(this.valueToDisplay)}</div>
			</div>
		`;
  }
  _emitNewValue(realValue) {
    var _a;
    const clamped = Math.max(this.min, Math.min(this.max, realValue));
    let emitValue;
    if (this.mode === "string") {
      if ((_a = this._sortedTags) == null ? void 0 : _a.length) {
        const item = this._sortedTags.find((item2) => item2[0] === clamped);
        emitValue = (item == null ? void 0 : item[1]) ?? clamped;
      } else {
        emitValue = clamped;
      }
    } else {
      emitValue = clamped;
    }
    this.value = emitValue;
    this.dispatchEvent(new CustomEvent("change", {
      detail: emitValue,
      bubbles: true,
      composed: true
    }));
  }
  _adsorb(realValue) {
    var _a, _b, _c;
    if (this.adsorption === "int") {
      return Math.round(realValue);
    } else if (this.adsorption === "tags") {
      if ((_a = this._sortedTags) == null ? void 0 : _a.length) {
        let minDist = Number.MAX_VALUE;
        let closest = realValue;
        for (const [tagValue] of this._sortedTags) {
          const dist = Math.abs(realValue - tagValue);
          if (dist <= minDist) {
            minDist = dist;
            closest = tagValue;
          }
        }
        return closest;
      }
      return realValue;
    } else if (typeof this.adsorption === "function") {
      return this.adsorption(realValue);
    } else if (this.mode === "string") {
      if ((_b = this._sortedTags) == null ? void 0 : _b.length) {
        let minDist = Number.MAX_VALUE;
        let closest = realValue;
        for (const [tagValue] of this._sortedTags) {
          const dist = Math.abs(realValue - tagValue);
          if (dist <= minDist) {
            minDist = dist;
            closest = tagValue;
          }
        }
        return closest;
      }
      return realValue;
    } else if ((_c = this._sortedTags) == null ? void 0 : _c.length) {
      const range = this.max - this.min;
      const threshold = 0.01 * range;
      for (const [tagValue] of this._sortedTags) {
        if (Math.abs(tagValue - realValue) < threshold) {
          realValue = tagValue;
        }
      }
      return realValue;
    }
    return realValue;
  }
  _handleDragStart(event) {
    event.preventDefault();
    const mouseDownX = event.pageX ?? event.touches[0].pageX;
    const target = event.target;
    let sliderLeft, sliderWidth, slipperOffsetX;
    const isSlipper = target.classList.contains("slider-module-slipper");
    if (isSlipper) {
      sliderLeft = target.parentElement.getBoundingClientRect().left;
      sliderWidth = target.parentElement.offsetWidth;
      slipperOffsetX = event.offsetX - target.offsetWidth / 2;
      target.focus();
    } else {
      sliderLeft = target.getBoundingClientRect().left;
      sliderWidth = target.offsetWidth;
      slipperOffsetX = 0;
    }
    let lastValue = NaN;
    const handleMouseMove = (e) => {
      var _a, _b;
      const pageX = e.pageX ?? ((_b = (_a = e.touches) == null ? void 0 : _a[0]) == null ? void 0 : _b.pageX) ?? mouseDownX;
      let limitedValue = (Math.floor(pageX) - sliderLeft - slipperOffsetX) / sliderWidth;
      limitedValue = Math.max(0, Math.min(1, limitedValue));
      const range = this.max - this.min;
      let realValue = this.min + range * limitedValue;
      realValue = range <= 1 ? Number(realValue.toFixed(6)) : Number(realValue.toFixed(3));
      realValue = this._adsorb(realValue);
      if (realValue !== lastValue) {
        this._emitNewValue(realValue);
        lastValue = realValue;
      }
    };
    const handleMouseUp = () => {
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
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const originalValue = this._numericalValue ?? (this.max + this.min) / 2;
      const range = this.max - this.min;
      const delta = this.arrowKeyStep ? range / this.arrowKeyStep : 1;
      let newRealValue = Number((originalValue + direction * delta).toFixed(6));
      newRealValue = Math.max(this.min, Math.min(this.max, newRealValue));
      this._emitNewValue(newRealValue);
    }
  }
};
FFBoxSlider.styles = i`
		:host {
			display: block;
		}

		.slider {
			position: relative;
			flex-grow: 1;
			height: 56px;
			display: flex;
			align-items: center;
		}

		.slider-module {
			position: relative;
			flex-grow: 1;
			height: 100%;
			margin: 0 16px;
			font-size: 14px;
		}

		.slider-module-track {
			position: absolute;
			top: 17px;
			width: 100%;
			height: 6px;
			border-radius: 8px;
			box-shadow: 0px 2px 2px 0px rgba(0, 0, 0, 0.15) inset;
		}

		.slider-module-track-background {
			position: absolute;
			top: 17px;
			height: 6px;
			background: #49e;
			border-radius: 8px;
			box-shadow: 0px 2px 2px 0px rgba(0, 0, 0, 0.15) inset;
			pointer-events: none;
		}

		.slider-module-slipper {
			position: absolute;
			top: 4px;
			transform: translateX(-50%);
			width: 18px;
			height: 30px;
			background: linear-gradient(180deg, #fefefe, #f0f0f0);
			border-radius: 4px;
			box-shadow: 0px 2px 2px 0px rgba(0, 0, 0, 0.2);
			border: none;
			outline: none;
		}

		.slider-module-slipper:hover {
			background: linear-gradient(180deg, #ffffff, #fefefe);
		}

		.slider-module-slipper:active {
			background: linear-gradient(180deg, #f0f0f0, #ededed);
		}

		.slider-module-mark {
			position: absolute;
			bottom: 0px;
			transform: translateX(-50%);
			width: max-content;
			font-size: 10px;
			text-align: center;
			opacity: 0.7;
			pointer-events: none;
		}

		.slider-module-mark::before {
			content: "";
			position: absolute;
			left: calc(50% - 2px);
			top: -8px;
			width: 4px;
			height: 4px;
			border-radius: 4px;
			box-shadow: 0px 1px 1px 0px rgba(0, 0, 0, 0.2) inset;
			z-index: -10;
		}

		.slider-text {
			width: 88px;
			font-size: 14px;
			text-align: center;
		}

		:host([data-theme="light"]) .slider-module-track {
			background: #FFF;
		}
		:host([data-theme="light"]) .slider-module-mark::before {
			background: #FFF;
		}

		:host([data-theme="dark"]) .slider-module-track {
			background: #444;
		}
		:host([data-theme="dark"]) .slider-module-mark::before {
			background: #777;
		}
	`;
FFBoxSlider._numberOrStringConverter = {
  fromAttribute(value) {
    if (value === null) return void 0;
    const num = Number(value);
    return isNaN(num) ? value : num;
  },
  toAttribute(value) {
    return (value == null ? void 0 : value.toString()) ?? null;
  }
};
__decorateClass([
  n({ reflect: true, converter: FFBoxSlider._numberOrStringConverter })
], FFBoxSlider.prototype, "value", 2);
__decorateClass([
  n({ type: Number })
], FFBoxSlider.prototype, "min", 2);
__decorateClass([
  n({ type: Number })
], FFBoxSlider.prototype, "max", 2);
__decorateClass([
  n({ type: Number })
], FFBoxSlider.prototype, "arrowKeyStep", 2);
__decorateClass([
  n()
], FFBoxSlider.prototype, "adsorption", 2);
__decorateClass([
  n({ attribute: false })
], FFBoxSlider.prototype, "tags", 2);
__decorateClass([
  n()
], FFBoxSlider.prototype, "mode", 2);
__decorateClass([
  n({ attribute: false })
], FFBoxSlider.prototype, "valueToDisplay", 2);
__decorateClass([
  n({ type: Boolean, attribute: false })
], FFBoxSlider.prototype, "useIEC", 2);
__decorateClass([
  c({ context: themeContext, subscribe: true }),
  n({ reflect: true, attribute: "data-theme" })
], FFBoxSlider.prototype, "theme", 2);
FFBoxSlider = __decorateClass([
  t("ffbox-slider")
], FFBoxSlider);
export {
  FFBoxSlider
};
//# sourceMappingURL=ffbox-slider.js.map
