import "../theme-provider/ffbox-theme-provider.js";
import "../input-auto-size/ffbox-input-auto-size.js";
import { a as i, c as n, d as c, r, i as i$1, b, A, h as o, t } from "../../lit.js";
import { t as themeContext } from "../../contexts/theme-context.js";
const closeIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="48" height="48"><path d="M743.2 701.21a37.84 37.84 0 0 1-0.39 52.88l5.51-5.51a36.5 36.5 0 0 1-52.19-0.3L281.64 322.79a37.84 37.84 0 0 1 0.39-52.88l-5.5 5.51a36.5 36.5 0 0 1 52.19 0.3z" fill="currentColor"></path><path d="M701.21 284.3a37.84 37.84 0 0 1 52.88 0.39l-5.51-5.51a36.5 36.5 0 0 1-0.3 52.19L322.79 745.86a37.84 37.84 0 0 1-52.88-0.39l5.51 5.51a36.5 36.5 0 0 1 0.3-52.19z" fill="currentColor"></path></svg>';
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
let FFBoxRadioList = class extends i$1 {
  constructor() {
    super(...arguments);
    this.list = [];
    this.value = "";
    this.placeholder = "";
    this.theme = "light";
    this._editingIndex = -1;
  }
  render() {
    return b`
			<div class="radioList">
				${this.list.map((item, index) => this._renderItem(item, index))}
			</div>
		`;
  }
  _renderItem(item, index) {
    const isSelected = item.value === this.value;
    const isDisabled = item.disabled;
    const isEditing = this._editingIndex === index;
    const classes = ["item"];
    if (isSelected) classes.push("itemSelected");
    if (isDisabled) classes.push("itemDisabled");
    const label = item.caption || (item.value === "" ? this.placeholder : item.value);
    const isEmpty = item.value === "";
    return b`
			<button
				class=${classes.join(" ")}
				@mousedown=${(e) => this._handleItemClick(e, item, index)}
			>
				${isEditing ? b`<ffbox-input-auto-size
						class="editingInput"
						focus-on-mounted
						.value=${item.value}
						@blur=${(e) => this._handleEditConfirm(item, e.detail, index)}
						@press-enter=${(_e) => this._editingIndex = -1}
						@change=${(e) => e.stopPropagation()}
					></ffbox-input-auto-size>` : b`<span
						class=${["itemLabel", isEmpty ? "itemLabelEmpty" : ""].filter(Boolean).join(" ")}
						@click=${(e) => this._handleLabelClick(e, item, index)}
					>${label}</span>`}
				${item.deletable && !isEditing ? b`<button
						class="itemDelete"
						aria-label="删除此项"
						@click=${(e) => this._handleDelete(e, item, index)}
					>${o(closeIcon)}</button>` : A}
			</button>
		`;
  }
  _handleItemClick(_e, item, index) {
    if (this._editingIndex !== -1) return;
    if (item.value !== this.value) {
      this.value = item.value;
      this.dispatchEvent(new CustomEvent("change", {
        detail: { value: item.value, index },
        bubbles: true,
        composed: true
      }));
    }
  }
  _handleLabelClick(e, item, index) {
    if (item.editable && item.caption == null) {
      e.stopPropagation();
      this._editingIndex = index;
    }
  }
  _handleEditConfirm(item, newValue, index) {
    this._editingIndex = -1;
    this.dispatchEvent(new CustomEvent("edit", {
      detail: { oldValue: item.value, newValue, index },
      bubbles: true,
      composed: true
    }));
  }
  _handleDelete(e, item, index) {
    e.stopImmediatePropagation();
    this.dispatchEvent(new CustomEvent("delete", {
      detail: { value: item.value, index },
      bubbles: true,
      composed: true
    }));
  }
};
FFBoxRadioList.styles = i`
		:host {
			display: block;
		}

		.radioList {
			display: flex;
			flex-direction: column;
			flex-wrap: wrap;
			justify-content: center;
			align-content: center;
			box-sizing: border-box;
			height: 100%;
			min-height: 120px;
			padding: 16px;
			gap: 6px;
			isolation: isolate;
		}

		.item {
			height: 30px;
			box-sizing: border-box;
			padding: 0 23px 0 20px;
			position: relative;
			outline: none;
			border: none;
			font-size: 13px;
			line-height: 30px;
			white-space: nowrap;
			color: inherit;
			background-color: hwb(var(--bg99) / 0.8);
			border-radius: 4px;
			box-shadow: 0 0 1px 0.5px hwb(var(--highlight)),
						0 1.5px 3px 0 hwb(var(--hoverShadow) / 0.2);
			border-left: transparent 3px solid;
			transition: all 0.3s cubic-bezier(0, 1.5, 0.3, 1);
		}

		.item:not(.itemSelected):hover::after {
			content: '';
			position: absolute;
			top: 0;
			left: -3px;
			width: calc(100% + 3px);
			height: 100%;
			border-radius: inherit;
			box-shadow: 0 0 2px hwb(var(--hoverShadow) / 0.2);
			z-index: 1;
		}

		.itemSelected {
			background-color: hwb(var(--bg97) / 0.8);
			border-radius: 3px 4px 4px 3px;
			box-shadow: 0 0 2px 1px hwb(var(--hoverShadow) / 0.05),
						0 3px 6px hwb(var(--hoverShadow) / 0.1) inset;
			border-left: #49e 3px solid;
		}

		.itemDisabled {
			color: #77777777;
			pointer-events: none;
		}

		.itemLabel {
			user-select: none;
			-webkit-user-select: none;
		}

		.itemLabelEmpty {
			opacity: 0.5;
		}

		.itemDelete {
			position: absolute;
			top: 0;
			right: 0;
			height: 100%;
			width: 20px;
			border: none;
			border-radius: 0 4px 4px 0;
			outline: none;
			background: none;
			padding: 0;
			display: flex;
			justify-content: center;
			align-items: center;
			opacity: 0.5;
			z-index: 2;
			user-select: none;
		}

		.itemDelete:hover {
			box-shadow: 0 0 3px hwb(var(--hoverShadow) / 0.1);
			background: hwb(var(--hoverLightBg) / 0.5);
			opacity: 1;
		}

		.itemDelete:active {
			box-shadow: 0 0 2px 1px hwb(var(--hoverShadow) / 0.05),
						0 6px 12px hwb(var(--hoverShadow) / 0.15) inset;
			transform: translateY(0.5px);
		}

		.itemDelete svg {
			width: 16px;
		}

		.editingInput {
			margin: 0 -4px;
		}
	`;
__decorateClass([
  n({ attribute: false })
], FFBoxRadioList.prototype, "list", 2);
__decorateClass([
  n({ reflect: true })
], FFBoxRadioList.prototype, "value", 2);
__decorateClass([
  n()
], FFBoxRadioList.prototype, "placeholder", 2);
__decorateClass([
  c({ context: themeContext, subscribe: true }),
  n({ reflect: true, attribute: "data-theme" })
], FFBoxRadioList.prototype, "theme", 2);
__decorateClass([
  r()
], FFBoxRadioList.prototype, "_editingIndex", 2);
FFBoxRadioList = __decorateClass([
  t("ffbox-radio-list")
], FFBoxRadioList);
export {
  FFBoxRadioList
};
//# sourceMappingURL=ffbox-radio-list.js.map
