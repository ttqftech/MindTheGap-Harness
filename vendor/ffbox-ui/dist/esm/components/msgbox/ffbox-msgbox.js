import "../theme-provider/ffbox-theme-provider.js";
import "../button/ffbox-button.js";
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
const defaultButton = {
  text: "好嘅",
  type: "normal",
  callback: () => console.log("cancelled")
};
let FFBoxMsgbox = class extends i$1 {
  constructor() {
    super(...arguments);
    this.title = "";
    this.theme = "light";
    this._entered = false;
    this._leaving = false;
    this._disable = false;
    this._backgroundMouseDown = false;
    this.previousActiveElement = null;
    this._handleKeyPress = (e2) => {
      const buttons = this._buttons;
      if (buttons.length === 1 && (e2.key === "Escape" || e2.key === "Enter")) {
        this._handleButtonClick(buttons[0]);
        e2.stopPropagation();
      } else if (e2.key === "Escape") {
        const button = buttons.find((button2) => button2.role === "cancel");
        if (button) {
          this._handleButtonClick(button);
          e2.stopPropagation();
        }
      } else if (e2.key === "Enter") {
        const button = buttons.find((button2) => button2.role === "confirm");
        if (button) {
          this._handleButtonClick(button);
          e2.stopPropagation();
        }
      }
    };
  }
  get _mouseDownTransformStyle() {
    return this._backgroundMouseDown ? { transform: "scale(0.97)", transition: "all cubic-bezier(0.1, 2.5, 0.6, 1) 0.5s" } : {};
  }
  firstUpdated() {
    requestAnimationFrame(() => {
      this.previousActiveElement = document.activeElement;
      this._entered = true;
      this.addEventListener("keydown", this._handleKeyPress);
      this.tabIndex = -1;
      this.focus();
    });
  }
  disconnectedCallback() {
    this.removeEventListener("keydown", this._handleKeyPress);
    if (this.previousActiveElement && typeof this.previousActiveElement.focus === "function") {
      this.previousActiveElement.focus();
    }
    super.disconnectedCallback();
  }
  get _buttons() {
    return this.buttons || [defaultButton];
  }
  _handleButtonClick(button) {
    if (button.callback) {
      this._disable = true;
      const ret = button.callback();
      if (ret === void 0 || ret === true) {
        this.close();
      } else if (ret instanceof Promise) {
        ret.then(() => this.close());
      } else {
        this._disable = false;
      }
    } else {
      this.close();
    }
  }
  /** 播放离场动画，动画结束后组件自行从 DOM 移除并派发 closed 事件 */
  close() {
    var _a;
    if (this._leaving) return;
    this._leaving = true;
    this.removeEventListener("keydown", this._handleKeyPress);
    const finish = () => {
      this.dispatchEvent(new CustomEvent("closed", { bubbles: true, composed: true }));
      this.remove();
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
    }, 300);
  }
  render() {
    const buttons = this._buttons;
    const backgroundClasses = ["background", this._entered && !this._leaving ? "entered" : ""].filter(Boolean).join(" ");
    const boxClasses = ["box", this._entered && !this._leaving ? "entered" : "", this._leaving ? "leaving" : ""].filter(Boolean).join(" ");
    const content = typeof this.content === "function" ? this.content() : this.content;
    return b`
			<dialog class="dialog">
				<div
					class=${backgroundClasses}
					@mousedown=${() => this._backgroundMouseDown = true}
					@mouseup=${() => this._backgroundMouseDown = false}
				></div>
				<div class=${boxClasses} style=${o(this._mouseDownTransformStyle)}>
					${this.image ? b`<div class="image">${this.image}</div>` : ""}
					${this.title ? b`<div class="title">${this.title}</div>` : ""}
					${content ? b`<div class="content">${content}</div>` : ""}
					<div class="buttons">
						${buttons.map((button) => b`
							<ffbox-button
								type=${button.type ?? "normal"}
								?disabled=${this._disable}
								@click=${() => this._handleButtonClick(button)}
							>${button.text}</ffbox-button>
						`)}
					</div>
				</div>
			</dialog>
		`;
  }
};
FFBoxMsgbox.styles = i`
		:host {
			/* host 承担原版 <dialog> 的铺满定位（Web Component 多了一层宿主，若不做定位则高度为 0） */
			display: block;
			position: fixed;
			top: 0;
			left: 0;
			width: 100%;
			height: 100%;
			color: inherit;
			outline: none;
			z-index: 5;
		}

		.dialog {
			display: flex;
			justify-content: center;
			align-items: center;
			background: none;
			border: none;
			margin: 0;
			padding: 0;
			position: relative;
			width: 100%;
			height: 100%;
			overflow: hidden;
			color: inherit;
		}

		.background {
			position: absolute;
			top: 0;
			left: 0;
			width: 100%;
			height: 100%;
			will-change: opacity;
			background-color: hwb(var(--bg90) / 0.3);
			backdrop-filter: blur(1.5px);
			opacity: 0;
			transition: opacity 0.2s ease-out;	/* 对应 bganimate-leave-active */
		}
		.background.entered {
			opacity: 1;
			transition: opacity 0.3s ease-out;	/* 对应 bganimate-enter-active */
		}

		.box {
			display: flex;
			flex-direction: column;
			align-items: center;
			min-width: 200px;
			padding: 16px 24px;
			border-radius: 8px;
			background-color: hwb(var(--bg97) / 0.8);
			box-shadow: 0 3px 2px -2px hwb(var(--highlight)) inset,	/* 上亮光 */
					0 16px 32px 0px hwb(var(--hoverShadow) / 0.02),
					0 6px 6px 0px hwb(var(--hoverShadow) / 0.02),
					0 0 0 1px hwb(var(--highlight) / 0.9);	/* 包边 */
			transition: transform cubic-bezier(0.33, 1, 1, 1) 0.3s, opacity linear 0.2s;
			z-index: 0;	/* 可能是由于 chromium 的 bug，不加这个会导致背景的 backdrop-filter 应用到 box 上 */
			/* 对应 boxanimate-enter-from */
			transform: scale(1.1);
			opacity: 0;
		}
		.box > *:not(:last-child) {
			margin-bottom: 12px;
		}
		.box.entered {
			/* 对应 boxanimate-enter-to / boxanimate-leave-from */
			transform: scale(1);
			opacity: 1;
		}
		.box.leaving {
			/* 对应 boxanimate-leave-active + boxanimate-leave-to */
			transition: all linear 0.2s;
			transform: scale(0.9);
			opacity: 0;
		}

		.image {
			height: 96px;
		}
		.image > * {
			height: 100%;
		}
		.title {
			font-size: 17px;
			font-weight: 500;
		}
		.content {
			font-size: 14px;
			margin: 4px 0 24px;
		}
		.buttons {
			display: flex;
		}
	`;
__decorateClass([
  n({ reflect: true })
], FFBoxMsgbox.prototype, "title", 2);
__decorateClass([
  n({ attribute: false })
], FFBoxMsgbox.prototype, "image", 2);
__decorateClass([
  n({ attribute: false })
], FFBoxMsgbox.prototype, "content", 2);
__decorateClass([
  n({ attribute: false })
], FFBoxMsgbox.prototype, "buttons", 2);
__decorateClass([
  c({ context: themeContext, subscribe: true }),
  n({ reflect: true, attribute: "data-theme" })
], FFBoxMsgbox.prototype, "theme", 2);
__decorateClass([
  r()
], FFBoxMsgbox.prototype, "_entered", 2);
__decorateClass([
  r()
], FFBoxMsgbox.prototype, "_leaving", 2);
__decorateClass([
  r()
], FFBoxMsgbox.prototype, "_disable", 2);
__decorateClass([
  r()
], FFBoxMsgbox.prototype, "_backgroundMouseDown", 2);
__decorateClass([
  e(".box")
], FFBoxMsgbox.prototype, "_boxEl", 2);
FFBoxMsgbox = __decorateClass([
  t("ffbox-msgbox")
], FFBoxMsgbox);
function _detectTheme() {
  const provider = document.querySelector("ffbox-theme-provider");
  if (provider) return provider.theme === "dark" ? "dark" : "light";
  return "light";
}
FFBoxMsgbox.show = function(options = {}) {
  const el = document.createElement("ffbox-msgbox");
  el.title = options.title ?? "";
  el.image = options.image;
  el.content = options.content;
  el.buttons = options.buttons;
  el.theme = _detectTheme();
  const container = options.container || document.body;
  container.appendChild(el);
  return el;
};
export {
  FFBoxMsgbox
};
//# sourceMappingURL=ffbox-msgbox.js.map
