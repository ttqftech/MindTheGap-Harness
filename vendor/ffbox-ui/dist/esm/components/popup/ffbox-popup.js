import "../theme-provider/ffbox-theme-provider.js";
import { a as i, c as n, d as c, r, e, i as i$1, h as o, b, t } from "../../lit.js";
import { t as themeContext } from "../../contexts/theme-context.js";
const closeIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="48" height="48"><path d="M743.2 701.21a37.84 37.84 0 0 1-0.39 52.88l5.51-5.51a36.5 36.5 0 0 1-52.19-0.3L281.64 322.79a37.84 37.84 0 0 1 0.39-52.88l-5.5 5.51a36.5 36.5 0 0 1 52.19 0.3z" fill="currentColor"></path><path d="M701.21 284.3a37.84 37.84 0 0 1 52.88 0.39l-5.51-5.51a36.5 36.5 0 0 1-0.3 52.19L322.79 745.86a37.84 37.84 0 0 1-52.88-0.39l5.51 5.51a36.5 36.5 0 0 1 0.3-52.19z" fill="currentColor"></path></svg>\n';
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
const instances = [];
let seed = 0;
let container;
let FFBoxPopup = class extends i$1 {
  constructor() {
    super(...arguments);
    this.message = "";
    this.level = 0;
    this.verticalOffset = 0;
    this.index = 0;
    this.theme = "light";
    this._show = false;
    this._duration = 0;
    this._timeLeft = 0;
    this._mouseIn = false;
    this._delayedVerticalOffset = 0;
    this._userClosing = false;
    this._leaving = false;
    this._handleMouseEnter = () => {
      this._mouseIn = true;
    };
    this._handleMouseLeave = () => {
      this._mouseIn = false;
    };
  }
  get _bgClass() {
    switch (this.level) {
      case 1:
        return "popup-box popup-ok";
      case 2:
        return "popup-box popup-warning";
      case 3:
        return "popup-box popup-error";
      default:
        return "popup-box";
    }
  }
  get _strokeColor() {
    switch (this.level) {
      case 1:
        return "#FFFFFF";
      case 2:
        return "#3F330D";
      case 3:
        return "#FFFFFF";
      default:
        return "currentColor";
    }
  }
  connectedCallback() {
    super.connectedCallback();
    this.addEventListener("mouseenter", this._handleMouseEnter);
    this.addEventListener("mouseleave", this._handleMouseLeave);
  }
  firstUpdated() {
    this._show = true;
    this._duration = 2500 + this.message.length * 100;
    this._timeLeft = this._duration;
    let lastTime = (/* @__PURE__ */ new Date()).getTime();
    const count = () => {
      const now = (/* @__PURE__ */ new Date()).getTime();
      if (!this._mouseIn) {
        this._timeLeft = this._timeLeft - (now - lastTime);
        if (this._timeLeft <= 0) {
          this._close();
        }
      } else {
        this._timeLeft += (this._duration - this._timeLeft) * 0.2;
      }
      if (this._show) {
        {
          this._timerId = setTimeout(count, 67);
        }
      }
      lastTime = now;
    };
    count();
  }
  disconnectedCallback() {
    this.removeEventListener("mouseenter", this._handleMouseEnter);
    this.removeEventListener("mouseleave", this._handleMouseLeave);
    this._show = false;
    if (this._timerId !== void 0) clearTimeout(this._timerId);
    super.disconnectedCallback();
  }
  willUpdate(changed) {
    if (changed.has("verticalOffset")) {
      setTimeout(() => {
        this._delayedVerticalOffset = this.verticalOffset;
      }, 33 * this.index);
    }
  }
  updated() {
    this.style.transform = `translateY(${-this._delayedVerticalOffset}px)`;
    this.style.pointerEvents = this._show ? "auto" : "none";
  }
  render() {
    const lines = this.message.split("\n");
    const boxClasses = [this._bgClass, this._show && !this._leaving ? "entered" : "", this._leaving ? "leaving" : "", this._leaving && this._userClosing ? "user" : ""].filter(Boolean).join(" ");
    const dashOffset = -125.664 * (1 - this._timeLeft / (this._duration || 1));
    return b`
			<div class=${boxClasses} @mousedown=${this._handleMouseDown} @mouseup=${this._handleMouseUp}>
				<div class="popup-progress">
					<svg viewBox="-24 -24 48 48" class="popup-progress-circle">
						<circle
							fill="transparent"
							stroke-width="6"
							stroke=${this._strokeColor}
							stroke-dasharray="125.664"
							stroke-dashoffset=${dashOffset}
							r="20"
						></circle>
					</svg>
					<div class="popup-progress-x" style="color: ${this._strokeColor}" @click=${() => this._close(true)}>${o(closeIcon)}</div>
				</div>
				<div class="popup-message">
					${lines.map((line, i2) => b`${line}${i2 < lines.length - 1 ? b`<br/>` : ""}`)}
				</div>
			</div>
		`;
  }
  _handleMouseDown(event) {
    if (event.button === 1) {
      event.preventDefault();
    }
  }
  _handleMouseUp(event) {
    if (event.button === 1) {
      this._close(true);
    }
  }
  _close(isUserInteraction) {
    var _a;
    if (this._leaving) return;
    if (isUserInteraction) {
      this._userClosing = true;
    }
    this._show = false;
    this._leaving = true;
    this.dispatchEvent(new CustomEvent("will-close", {
      detail: { isUserInteraction: isUserInteraction ?? false },
      bubbles: true,
      composed: true
    }));
    const finish = () => {
      this.dispatchEvent(new CustomEvent("closed", { bubbles: true, composed: true }));
    };
    let done = false;
    const once = (e2) => {
      if (e2.target !== this._boxEl || done) return;
      done = true;
      finish();
    };
    (_a = this._boxEl) == null ? void 0 : _a.addEventListener("transitionend", once);
    setTimeout(() => {
      if (done) return;
      done = true;
      finish();
    }, this._userClosing ? 550 : 750);
  }
};
FFBoxPopup.styles = i`
		:host {
			display: block;
			position: absolute;
			bottom: 10%;
			left: 0;
			right: 0;
			width: fit-content;
			max-width: 60%;
			background: none;
			border: none;
			margin: auto;
			padding: 0;
			transition: transform 0.7s cubic-bezier(0.35, 1.4, 0.2, 0.95);
			z-index: 10;
		}

		.popup-box {
			width: fit-content;
			display: flex;
			align-items: stretch;
			padding: 8px;
			background: hwb(var(--bg98));
			border: hsl(0, 0%, 67%) 1px solid;
			border-radius: 12px;
			overflow: hidden;
			box-shadow: 0px 4px 8px hwb(0 0% 100% / 0.3);
			/* 对应 popupanimate-enter-from */
			opacity: 0;
			transform: scale(0) translateY(120px);
		}
		.popup-box.entered {
			/* 对应 popupanimate-enter-active + enter-to */
			transition: transform 0.5s cubic-bezier(0.4, 1.3, 0.4, 1), opacity 0.2s linear;
			opacity: 1;
			transform: scale(1);
		}
		.popup-box.leaving {
			/* 对应 popupanimate-leave-active + leave-to */
			transition: opacity 0.7s ease-out, transform 0.6s cubic-bezier(1, 0, 1, 1) 0.1s;
			opacity: 0;
			transform: scale(0.5);
		}
		.popup-box.leaving.user {
			/* 对应 popupanimateUser-leave-active + leave-to */
			transition: all 0.5s linear;
			opacity: 0;
			transform: scale(0.5) translateX(calc(100vw + 400px));
		}

		.popup-box:hover .popup-progress .popup-progress-circle {
			opacity: 0;
			transform: rotate(-90deg) scale(0.5);
		}
		.popup-box:hover .popup-progress .popup-progress-x {
			opacity: 1;
			transform: translateX(0);
		}

		.popup-message {
			margin: 4px;
			font-size: 16px;
			line-height: 1.3em;
			text-align: center;
			word-break: break-word;
		}

		.popup-progress {
			position: relative;
			width: 24px;
			height: auto;
			display: flex;
			justify-content: center;
			align-items: center;
			opacity: 0.8;
		}
		.popup-progress-circle {
			width: 16px;
			height: 16px;
			transform: rotate(-90deg) scale(1);
			transition: transform 0.3s cubic-bezier(0.1, 0.8, 0.3, 1), opacity 0.3s cubic-bezier(0.1, 0.8, 0.3, 1);
		}
		.popup-progress-circle:hover {
			visibility: hidden;
		}
		.popup-progress-x {
			position: absolute;
			width: 24px;
			height: 100%;
			margin: auto;
			border-radius: 4px;
			opacity: 0;
			transform: translateX(-32px);
			transition: transform 0.3s cubic-bezier(0.1, 0.8, 0.3, 1), opacity 0.3s cubic-bezier(0.1, 0.8, 0.3, 1);
			cursor: pointer;
		}
		.popup-progress-x svg {
			width: 100%;
			height: 100%;
			color: inherit;
		}
		.popup-progress-x:hover {
			box-shadow: 0 1px 4px hwb(var(--hoverShadow) / 0.2),
						0 4px 2px -2px hwb(var(--highlight) / 0.5) inset;
		}
		.popup-progress-x:active {
			box-shadow: 0 0px 1px hwb(var(--hoverShadow) / 0.2),
						0 15px 20px -10px hwb(var(--hoverShadow) / 0.15) inset;
			transform: translateY(0.25px);
		}

		/* 主题 */
		:host([data-theme="light"]) .popup-ok {
			background: linear-gradient(180deg, hwb(120 40% 10%), hwb(120 20% 20%));
			border-color: hwb(120 15% 35%);
			box-shadow: 0px 4px 8px hwb(120 10% 35% / 0.4);
			color: #FFF;
		}
		:host([data-theme="light"]) .popup-warning {
			background: linear-gradient(180deg, hwb(45 50% 0%), hwb(45 30% 0%));
			border-color: hwb(45 30% 10%);
			box-shadow: 0px 4px 8px hwb(45 10% 35% / 0.4);
			color: hsl(46, 66%, 15%);
		}
		:host([data-theme="light"]) .popup-error {
			background: hwb(0 35% 5%);
			border-color: hwb(0 20% 20%);
			box-shadow: 0px 4px 8px hwb(0 5% 40% / 0.4);
			color: #FFF;
		}

		:host([data-theme="dark"]) .popup-ok {
			background: linear-gradient(180deg, hwb(120 30% 15%), hwb(120 10% 25%));
			border-color: hwb(120 10% 45%);
			box-shadow: 0px 4px 8px hwb(120 5% 45% / 0.4);
			color: #FFF;
		}
		:host([data-theme="dark"]) .popup-warning {
			background: linear-gradient(180deg, hwb(45 40% 0%), hwb(45 20% 0%));
			border-color: hwb(45 25% 15%);
			box-shadow: 0px 4px 8px hwb(45 10% 30% / 0.4);
			color: hsl(46, 66%, 15%);
		}
		:host([data-theme="dark"]) .popup-error {
			background: hwb(0 30% 10%);
			border-color: hwb(0 20% 30%);
			box-shadow: 0px 4px 8px hwb(0 5% 40% / 0.4);
			color: #FFF;
		}
	`;
__decorateClass([
  n({ reflect: true })
], FFBoxPopup.prototype, "message", 2);
__decorateClass([
  n({ type: Number })
], FFBoxPopup.prototype, "level", 2);
__decorateClass([
  n({ type: Number })
], FFBoxPopup.prototype, "verticalOffset", 2);
__decorateClass([
  n({ type: Number })
], FFBoxPopup.prototype, "index", 2);
__decorateClass([
  c({ context: themeContext, subscribe: true }),
  n({ reflect: true, attribute: "data-theme" })
], FFBoxPopup.prototype, "theme", 2);
__decorateClass([
  r()
], FFBoxPopup.prototype, "_show", 2);
__decorateClass([
  r()
], FFBoxPopup.prototype, "_duration", 2);
__decorateClass([
  r()
], FFBoxPopup.prototype, "_timeLeft", 2);
__decorateClass([
  r()
], FFBoxPopup.prototype, "_mouseIn", 2);
__decorateClass([
  r()
], FFBoxPopup.prototype, "_delayedVerticalOffset", 2);
__decorateClass([
  r()
], FFBoxPopup.prototype, "_userClosing", 2);
__decorateClass([
  r()
], FFBoxPopup.prototype, "_leaving", 2);
__decorateClass([
  e(".popup-box")
], FFBoxPopup.prototype, "_boxEl", 2);
FFBoxPopup = __decorateClass([
  t("ffbox-popup")
], FFBoxPopup);
function _getContainer() {
  if (!container) {
    container = document.createElement("div");
    container.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;";
    document.body.appendChild(container);
  }
  return container;
}
function _detectTheme() {
  const provider = document.querySelector("ffbox-theme-provider");
  if (provider) return provider.theme === "dark" ? "dark" : "light";
  return "light";
}
function _handleOnWillClose(id, isUserInteraction) {
  const index = instances.findIndex((item) => item.id === id);
  if (index === -1) return;
  instances.splice(index, 1);
  setTimeout(() => {
    _reCalcVerticalOffset();
  }, isUserInteraction ? 0 : 300);
}
function _reCalcVerticalOffset() {
  for (let i2 = 0, totalHeight = 0; i2 < instances.length; i2++) {
    const instance = instances[i2];
    instance.el.index = i2;
    instance.el.verticalOffset = totalHeight;
    totalHeight += instances[i2].el.offsetHeight + 16;
  }
}
FFBoxPopup.show = function(options) {
  const el = document.createElement("ffbox-popup");
  el.message = options.message;
  el.level = options.level ?? 0;
  el.verticalOffset = 0;
  el.index = instances.length;
  el.theme = _detectTheme();
  const id = seed++;
  el.addEventListener("will-close", (e2) => {
    var _a;
    return _handleOnWillClose(id, (_a = e2.detail) == null ? void 0 : _a.isUserInteraction);
  });
  el.addEventListener("closed", () => {
    var _a;
    (_a = el.parentElement) == null ? void 0 : _a.removeChild(el);
  });
  _getContainer().appendChild(el);
  instances.unshift({ el, id });
  if (instances.length > 30) {
    const oldest = instances.pop();
    oldest.el.remove();
  }
  el.updateComplete.then(_reCalcVerticalOffset);
  return el;
};
export {
  FFBoxPopup
};
//# sourceMappingURL=ffbox-popup.js.map
