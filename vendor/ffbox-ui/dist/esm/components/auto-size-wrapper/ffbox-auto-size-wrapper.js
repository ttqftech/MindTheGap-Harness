import "../theme-provider/ffbox-theme-provider.js";
import { a as i, c as n, d as c, r, e, i as i$1, o, b, t } from "../../lit.js";
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
let FFBoxAutoSizeWrapper = class extends i$1 {
  constructor() {
    super(...arguments);
    this.useResizeObserver = false;
    this.theme = "light";
    this.width = 0;
    this.height = 0;
  }
  connectedCallback() {
    super.connectedCallback();
    if (!this._resizeObserver) {
      this._resizeObserver = new ResizeObserver(() => this._updateSize());
    }
  }
  firstUpdated() {
    requestAnimationFrame(() => this._updateSize());
    if (this.useResizeObserver) {
      this._observeSlot(true);
    }
  }
  updated(changed) {
    if (changed.has("useResizeObserver")) {
      this._observeSlot(this.useResizeObserver);
    }
  }
  disconnectedCallback() {
    this._observeSlot(false);
    super.disconnectedCallback();
  }
  _observeSlot(observe) {
    var _a;
    const target = (_a = this._containerEl) == null ? void 0 : _a.firstElementChild;
    if (!target || !this._resizeObserver) return;
    if (observe) {
      this._resizeObserver.observe(target);
    } else {
      this._resizeObserver.unobserve(target);
    }
  }
  /** 重新测量 slot 尺寸。外部在 slot 内容变化后也可主动调用 */
  updateSize() {
    this._updateSize();
  }
  _updateSize() {
    var _a;
    const target = (_a = this._containerEl) == null ? void 0 : _a.firstElementChild;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.dispatchEvent(new CustomEvent("resize", {
      detail: { width: this.width, height: this.height },
      bubbles: true,
      composed: true
    }));
  }
  render() {
    var _a;
    return b`
			<div class="autoSizeWrapper" style=${o(((_a = this.customStyle) == null ? void 0 : _a.call(this, { width: this.width, height: this.height })) || {})}>
				<div>
					<slot></slot>
				</div>
			</div>
		`;
  }
};
FFBoxAutoSizeWrapper.styles = i`
		:host {
			display: block;
		}

		.autoSizeWrapper > div {
			/* 测量层：宽度撑满以便反映 slot 的真实高度，不做任何裁剪 */
			display: block;
		}
	`;
__decorateClass([
  n({ type: Boolean, attribute: "use-resize-observer" })
], FFBoxAutoSizeWrapper.prototype, "useResizeObserver", 2);
__decorateClass([
  n({ attribute: false })
], FFBoxAutoSizeWrapper.prototype, "customStyle", 2);
__decorateClass([
  c({ context: themeContext, subscribe: true }),
  n({ reflect: true, attribute: "data-theme" })
], FFBoxAutoSizeWrapper.prototype, "theme", 2);
__decorateClass([
  r()
], FFBoxAutoSizeWrapper.prototype, "width", 2);
__decorateClass([
  r()
], FFBoxAutoSizeWrapper.prototype, "height", 2);
__decorateClass([
  e(".autoSizeWrapper")
], FFBoxAutoSizeWrapper.prototype, "_containerEl", 2);
FFBoxAutoSizeWrapper = __decorateClass([
  t("ffbox-auto-size-wrapper")
], FFBoxAutoSizeWrapper);
export {
  FFBoxAutoSizeWrapper
};
//# sourceMappingURL=ffbox-auto-size-wrapper.js.map
