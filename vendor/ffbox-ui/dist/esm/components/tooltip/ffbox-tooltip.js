import { k as e, l as i, m as t, E, a as i$1, c as n, i as i$2, b, t as t$1 } from "../../lit.js";
function computeTooltipStyle(position, e2) {
  const rect = e2.target.getBoundingClientRect();
  switch (position) {
    case "mtl":
      return { top: `${e2.clientY}px`, right: `${window.innerWidth - e2.clientX}px` };
    case "t":
      return { bottom: `${window.innerHeight - rect.top}px`, left: `${rect.left + rect.width / 2}px`, transform: "translateX(-50%)" };
    case "tl":
      return { bottom: `${window.innerHeight - rect.top}px`, left: `${rect.left}px` };
    case "tr":
      return { bottom: `${window.innerHeight - rect.top}px`, right: `${window.innerWidth - rect.right}px` };
    case "r":
      return { top: `${rect.top + rect.height / 2}px`, left: `${rect.left + rect.width}px`, transform: "translateY(-50%)" };
    case "br":
    default:
      return { top: `${rect.top + rect.height}px`, right: `${window.innerWidth - rect.right}px` };
  }
}
class TooltipDirective extends i {
  constructor(partInfo) {
    super(partInfo);
    this._onMouseenter = null;
    this._onMouseleave = null;
    if (partInfo.type !== t.ELEMENT) {
      throw new Error("tooltip 指令只能用于元素");
    }
  }
  update(part, [content, position, styleName]) {
    const el = part.element;
    if (this._onMouseenter) {
      el.removeEventListener("mouseenter", this._onMouseenter);
      el.removeEventListener("mouseleave", this._onMouseleave);
    }
    this._onMouseenter = (e2) => {
      FFBoxTooltip.show({
        content,
        style: computeTooltipStyle(position, e2),
        className: styleName === "small" ? "small" : void 0
      });
    };
    this._onMouseleave = () => {
      FFBoxTooltip.hide();
    };
    el.addEventListener("mouseenter", this._onMouseenter);
    el.addEventListener("mouseleave", this._onMouseleave);
    return E;
  }
  render(_content, _position, _styleName) {
    return E;
  }
}
const tooltip = e(TooltipDirective);
function useTooltip(content, position = "br", styleName = "small") {
  return {
    onmouseenter: (e2) => {
      FFBoxTooltip.show({
        content,
        style: computeTooltipStyle(position, e2),
        className: styleName === "small" ? "small" : void 0
      });
    },
    onmouseleave: () => {
      FFBoxTooltip.hide();
    }
  };
}
const _DEFAULT_ATTR = "data-tooltip";
const _observedElements = /* @__PURE__ */ new WeakSet();
let _observer = null;
let _attrName = _DEFAULT_ATTR;
function _parseAttr(value) {
  var _a, _b;
  const parts = value.split(";");
  const content = parts[0];
  const position = ((_a = parts[1]) == null ? void 0 : _a.trim()) || "br";
  const styleName = ((_b = parts[2]) == null ? void 0 : _b.trim()) || "small";
  return [content, position, styleName];
}
function _bindTooltipFromAttr(el) {
  if (_observedElements.has(el)) return;
  const raw = el.getAttribute(_attrName);
  if (raw === null) return;
  _observedElements.add(el);
  const [content, position, styleName] = _parseAttr(raw);
  const { onmouseenter, onmouseleave } = useTooltip(content, position, styleName);
  el.addEventListener("mouseenter", onmouseenter);
  el.addEventListener("mouseleave", onmouseleave);
}
function _bindDescendants(root) {
  root.querySelectorAll(`[${_attrName}]`).forEach(_bindTooltipFromAttr);
}
function enableTooltipAutoscan(attrName = _DEFAULT_ATTR) {
  if (_observer) return;
  _attrName = attrName;
  _observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node instanceof HTMLElement) {
          _bindTooltipFromAttr(node);
          _bindDescendants(node);
        }
      }
    }
  });
  const start = () => {
    _bindDescendants(document);
    _observer.observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
}
function disableTooltipAutoscan() {
  if (!_observer) return;
  _observer.disconnect();
  _observer = null;
}
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
let FFBoxTooltip = class extends i$2 {
  constructor() {
    super(...arguments);
    this.content = "";
    this.show = false;
    this.className = "";
    this.theme = "light";
  }
  render() {
    const lines = this.content.split("\n");
    const boxClasses = ["tooltip-box", this.show ? "" : "hidden", this.className].filter(Boolean);
    return b`
			<div class=${boxClasses.join(" ")}>
				<div class="tooltip-message">
					${lines.map((line, i2) => b`${line}${i2 < lines.length - 1 ? b`<br/>` : ""}`)}
				</div>
			</div>
		`;
  }
};
FFBoxTooltip.styles = i$1`
		:host {
			display: block;
			position: fixed;
			z-index: 100;
			pointer-events: none;
			max-width: calc(200px + 25%);
		}

		.tooltip-box {
			padding: 10px 12px;
			background: hwb(var(--bg98));
			border: hsl(0, 0%, 67%) 1px solid;
			border-radius: 10px;
			box-shadow: 0px 4px 8px hsla(0, 0%, 0%, 0.3);
			z-index: 5;
			opacity: 1;
			transition: opacity 0.1s linear;
		}

		.tooltip-box.hidden {
			opacity: 0;
			transition: opacity 0.2s linear;
		}

		.tooltip-box.small {
			position: relative;
			top: -1px;
			padding: 6px 10px;
			border-radius: 8px;
			border: none;
			background-color: hwb(var(--hoverLightBg) / 0.5);
			backdrop-filter: blur(8px) contrast(110%);
			box-shadow: 0 0 1px 0.5px hwb(var(--hoverLightBg)),
						0 1.5px 4px 0 hwb(var(--hoverShadow) / 0.2),
						0 1px 0.5px 0px hwb(var(--highlight) / 0.5) inset;
		}

		.tooltip-box.small .tooltip-message {
			font-size: 12px;
			line-height: 16px;
		}

		.tooltip-message {
			font-size: 14px;
			line-height: 1.3em;
			text-align: left;
		}
	`;
__decorateClass([
  n({ reflect: true })
], FFBoxTooltip.prototype, "content", 2);
__decorateClass([
  n({ type: Boolean, reflect: true })
], FFBoxTooltip.prototype, "show", 2);
__decorateClass([
  n({ reflect: true })
], FFBoxTooltip.prototype, "className", 2);
__decorateClass([
  n({ reflect: true, attribute: "data-theme" })
], FFBoxTooltip.prototype, "theme", 2);
FFBoxTooltip = __decorateClass([
  t$1("ffbox-tooltip")
], FFBoxTooltip);
let _instance = null;
function _getInstance() {
  if (!_instance) {
    _instance = document.createElement("ffbox-tooltip");
    document.body.appendChild(_instance);
  }
  return _instance;
}
function _detectTheme() {
  const provider = document.querySelector("ffbox-theme-provider");
  if (provider) return provider.theme;
  return "light";
}
FFBoxTooltip.show = function(options) {
  const el = _getInstance();
  el.theme = _detectTheme();
  el.content = options.content;
  el.className = options.className ?? "";
  el.show = true;
  el.style.top = "";
  el.style.bottom = "";
  el.style.left = "";
  el.style.right = "";
  el.style.transform = "";
  if (options.style) {
    Object.assign(el.style, options.style);
  }
};
FFBoxTooltip.hide = function() {
  if (_instance) {
    _instance.show = false;
  }
};
export {
  FFBoxTooltip,
  disableTooltipAutoscan,
  enableTooltipAutoscan,
  tooltip,
  useTooltip
};
//# sourceMappingURL=ffbox-tooltip.js.map
