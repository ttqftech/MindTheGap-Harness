import "../theme-provider/ffbox-theme-provider.js";
import "../checkbox/ffbox-checkbox.js";
import "../radio/ffbox-radio.js";
import { FFBoxTooltip } from "../tooltip/ffbox-tooltip.js";
import { a as i, c as n, d as c, r, i as i$1, b, o, j as n$1, h as o$1, t } from "../../lit.js";
import { t as themeContext } from "../../contexts/theme-context.js";
const rightIcon = '<?xml version="1.0" standalone="no"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg t="1697533442768" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="3305" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="200"><path d="M761.056 532.128c0.512-0.992 1.344-1.824 1.792-2.848 8.8-18.304 5.92-40.704-9.664-55.424L399.936 139.744a48 48 0 0 0-65.984 69.76l316.96 299.84L335.2 813.632a48 48 0 0 0 66.624 69.12l350.048-337.376c0.672-0.672 0.928-1.6 1.6-2.304 0.512-0.48 1.056-0.832 1.568-1.344 2.72-2.848 4.16-6.336 6.016-9.6z" fill="currentColor" p-id="3306"></path></svg>';
function getMenuItemByValue(menu, value, compareFunc) {
  function dfs(menu2) {
    for (const menuItem of menu2) {
      if (menuItem.type === "submenu") {
        const result = dfs(menuItem.subMenu);
        if (result) {
          return result;
        }
      } else if ("value" in menuItem && (compareFunc ? compareFunc(menuItem.value, value) : menuItem.value === value)) {
        return menuItem;
      }
    }
  }
  return dfs(menu);
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
let FFBoxMenu = class extends i$1 {
  constructor() {
    super(...arguments);
    this.menu = [];
    this.type = "action";
    this.theme = "light";
    this._openedSubMenus = [];
    this._openedSubMenuItemPos = {};
    this._currentHoveredItem = void 0;
    this._currentSelectedItem = void 0;
    this._leaving = false;
    this._flattenedMenus = [];
    this._menuElemRefs = [];
    this._unmounted = false;
    this._calcSubMenuPosition = async (menuIndex) => {
      if (this._openedSubMenuItemPos[menuIndex]) {
        return;
      }
      const menu = this._flattenedMenus[menuIndex];
      const parentMenu = menu.parent;
      if (!parentMenu) {
        return;
      }
      if (!this._openedSubMenuItemPos[parentMenu.menuIndex]) {
        await this._calcSubMenuPosition(parentMenu.menuIndex);
        await this.updateComplete;
      }
      const parentIndexInFlattened = parentMenu.menuIndex;
      const parentIndexInMenu = parentMenu.menu.findIndex((menuItem) => menuItem.type === "submenu" && menuItem.key === menuIndex);
      const menuElem = this._menuElemRefs[parentIndexInFlattened];
      const menuItemElem = menuElem.children[parentIndexInMenu];
      menuItemElem.scrollIntoView({
        behavior: "instant",
        block: "center",
        inline: "center"
      });
      const menuItemElemRect = menuItemElem.getBoundingClientRect();
      this._openedSubMenuItemPos[menuIndex] = {
        xMin: menuItemElemRect.x,
        yMin: menuItemElemRect.y,
        xMax: menuItemElemRect.x + menuItemElemRect.width,
        yMax: menuItemElemRect.y + menuItemElemRect.height,
        preferDirection: "r"
      };
      this._openedSubMenuItemPos = { ...this._openedSubMenuItemPos };
    };
    this._showTooltip = (menuItem) => {
      var _a;
      if (menuItem.type !== "separator" && menuItem.tooltip) {
        const { menu: _menu, indexInFlattened, indexInMenu } = this._getMenuByItem(menuItem);
        let position = {};
        const menuElem = this._menuElemRefs[indexInFlattened];
        if (!menuElem) {
          return;
        }
        const menuItemElem = menuElem.children[indexInMenu];
        const menuItemElemRect = menuItemElem.getBoundingClientRect();
        const screenHeight = document.documentElement.clientHeight;
        const leftSpace = menuItemElemRect.left;
        if (((_a = this._openedSubMenuItemPos[indexInFlattened]) == null ? void 0 : _a.preferDirection) === "l" || leftSpace < 220) {
          position = {
            ...position,
            left: `${menuItemElemRect.left + menuItemElemRect.width + 12}px`
          };
        } else {
          position = {
            ...position,
            right: `calc(100% - ${menuItemElemRect.left - 12}px)`
          };
        }
        if (menuItemElemRect.top + menuItemElemRect.height / 2 < screenHeight / 2) {
          position = {
            ...position,
            top: `${menuItemElemRect.top}px`
          };
        } else {
          position = {
            ...position,
            bottom: `calc(100% - ${menuItemElemRect.top + menuItemElemRect.height}px)`
          };
        }
        FFBoxTooltip.show({
          content: menuItem.tooltip,
          style: position
        });
      }
    };
    this._onItemSelect = (event, menuItem) => {
      if (!("value" in menuItem) || menuItem.disabled) {
        return;
      }
      const isClickEvent = event.type === "mouseup" || event.type === "keydown" && event.key === "Enter";
      if (this.type === "action") {
        if (isClickEvent) {
          const result = this.onSelect ? this.onSelect(event, menuItem.value, menuItem.type !== "normal" ? menuItem.checked : void 0) : false;
          if (result === false) {
            (menuItem.onClick || (() => {
            }))(event, menuItem.value);
          }
          this.close();
        }
      } else if (this.type === "select") {
        if (menuItem.onClick) {
          if (isClickEvent) {
            menuItem.onClick(event, menuItem.value);
          }
        } else {
          (this.onSelect || (() => {
          }))(event, menuItem.value, menuItem.type !== "normal" ? menuItem.checked : void 0);
          if (isClickEvent) {
            this.close();
          }
        }
      }
    };
    this._handleSelect = (e, menuItem) => {
      e.stopPropagation();
      if ("value" in menuItem) {
        this._onItemSelect(e, menuItem);
      }
    };
    this._handleMenuItemMouseEnter = (menuItem) => {
      this._setHoveredItem(menuItem);
    };
    this._handleMenuItemMouseLeave = () => {
      this._setHoveredItem(void 0);
    };
    this._handleMenuItemFocused = (e, menuItem) => {
      var _a;
      this._setHoveredItem(menuItem);
      (_a = this.returnFocus) == null ? void 0 : _a.call(this, e);
    };
    this._setHoveredItem = (newItem) => {
      var _a;
      const oldItem = this._currentHoveredItem;
      this._currentHoveredItem = newItem;
      if (newItem !== void 0) {
        const found = this._getMenuByItem(newItem);
        if (!found) {
          return;
        }
        const { menu, indexInFlattened, indexInMenu } = found;
        const newOpenedKeys = [menu.menuIndex];
        let current = menu;
        while (current.parent) {
          current = current.parent;
          newOpenedKeys.unshift(current.menuIndex);
        }
        if (newItem.type === "submenu") {
          newOpenedKeys.push(newItem.key);
          const menuElem = this._menuElemRefs[indexInFlattened];
          const menuItemElem = menuElem.children[indexInMenu];
          const menuItemElemRect = menuItemElem.getBoundingClientRect();
          const currentPreferDirection = ((_a = this._openedSubMenuItemPos[menu.menuIndex]) == null ? void 0 : _a.preferDirection) || "r";
          this._openedSubMenuItemPos[newItem.key] = {
            xMin: menuItemElemRect.x,
            yMin: menuItemElemRect.y,
            xMax: menuItemElemRect.x + menuItemElemRect.width,
            yMax: menuItemElemRect.y + menuItemElemRect.height,
            preferDirection: currentPreferDirection === "r" ? menuItemElemRect.x + menuItemElemRect.width * 1.5 > window.innerWidth ? "l" : "r" : menuItemElemRect.x < menuItemElemRect.width * 0.5 ? "r" : "l"
          };
          this._openedSubMenuItemPos = { ...this._openedSubMenuItemPos };
        }
        if (JSON.stringify(newOpenedKeys) !== JSON.stringify(this._openedSubMenus)) {
          this._openedSubMenus = newOpenedKeys;
          const newPos = { ...this._openedSubMenuItemPos };
          for (const key of Object.keys(newPos)) {
            if (!newOpenedKeys.includes(+key)) {
              delete newPos[+key];
            }
          }
          this._openedSubMenuItemPos = newPos;
        }
        setTimeout(() => {
          this._showTooltip(newItem);
        }, 0);
      }
      if ((newItem === void 0 || !("tooltip" in newItem)) && oldItem !== void 0) {
        FFBoxTooltip.hide();
      }
    };
    this._keydownListener = (e) => {
      var _a, _b, _c;
      if (e.key === "Escape") {
        this._handleCancel(e);
      }
      let menuItem = this._currentHoveredItem;
      if (e.key === "Enter") {
        if (menuItem) {
          this._handleSelect(e, menuItem);
        }
      }
      if (!menuItem) {
        if (e.key === "ArrowDown" || e.key === "Home") {
          menuItem = Object.values(this._flattenedMenus)[0].menu[Object.values(this._flattenedMenus)[0].menu.length - 1];
        } else if (e.key === "ArrowUp" || e.key === "End") {
          menuItem = Object.values(this._flattenedMenus)[0].menu[0];
        } else {
          (_a = this.onKeyDown) == null ? void 0 : _a.call(this, e);
        }
      }
      if (!menuItem) {
        return;
      }
      const { menu, indexInFlattened, indexInMenu } = this._getMenuByItem(menuItem);
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const menuElem = this._menuElemRefs[indexInFlattened];
        let currentIndex = indexInMenu;
        do {
          if (e.key === "ArrowUp") {
            currentIndex = currentIndex === 0 ? menu.menu.length - 1 : currentIndex - 1;
          } else {
            currentIndex = currentIndex === menu.menu.length - 1 ? 0 : currentIndex + 1;
          }
          if (menu.menu[currentIndex].type !== "separator") {
            break;
          }
        } while (currentIndex !== indexInMenu);
        menuElem.children[currentIndex].focus();
        if (this.type === "select") {
          this._handleSelect(e, menu.menu[currentIndex]);
        }
      }
      if (e.key === "Home" || e.key === "End") {
        const menuElem = this._menuElemRefs[indexInFlattened];
        const index = e.key === "Home" ? 0 : menuElem.children.length - 1;
        menuElem.children[index].focus();
        if (this.type === "select") {
          this._handleSelect(e, menu.menu[index]);
        }
      }
      if (e.key === "ArrowLeft") {
        if (menu.parent) {
          const parentDOM = this._menuElemRefs[menu.parent.menuIndex];
          const menuItemIndex = menu.parent.menu.findIndex((menuItem2) => menuItem2.type === "submenu" && menuItem2.key === menu.menuIndex);
          parentDOM.children[menuItemIndex].focus();
        } else {
          (_b = this.onKeyDown) == null ? void 0 : _b.call(this, e);
        }
      } else if (e.key === "ArrowRight") {
        if (menuItem.type === "submenu") {
          const childDOM = this._menuElemRefs[menuItem.key];
          const activeIndex = menuItem.subMenu.findIndex((menuItem2) => "value" in menuItem2 && menuItem2.value === this._currentSelectedItem);
          const finalIndex = activeIndex !== -1 ? activeIndex : 0;
          childDOM.children[finalIndex].focus();
          if (this.type === "select") {
            this._handleSelect(e, menuItem.subMenu[finalIndex]);
          }
        } else {
          (_c = this.onKeyDown) == null ? void 0 : _c.call(this, e);
        }
      }
    };
    this._handleCancel = (event) => {
      const result = (this.onCancel || (() => {
      }))(event);
      if (result !== false) {
        this.close();
      }
      return result;
    };
  }
  willUpdate(changed) {
    if (changed.has("menu")) {
      this._flattenedMenus = this._flattenMenus();
    }
  }
  firstUpdated() {
    this._currentSelectedItem = this.selectedValue;
    if (!this.returnFocus) {
      document.addEventListener("keydown", this._keydownListener);
    }
    this._openedSubMenus = [0];
    const res = this._getMenuAndItemByValue(this.selectedValue);
    if (res) {
      const { menu, menuItem } = res;
      this._setHoveredItem(menuItem);
      setTimeout(() => {
        this._calcSubMenuPosition(menu.menuIndex);
        const { indexInFlattened, indexInMenu } = this._getMenuByItem(menuItem);
        const menuElem = this._menuElemRefs[indexInFlattened];
        const menuItemElem = menuElem.children[indexInMenu];
        menuItemElem.focus();
      }, 0);
    }
  }
  disconnectedCallback() {
    if (!this.returnFocus) {
      document.removeEventListener("keydown", this._keydownListener);
    }
    FFBoxTooltip.hide();
    super.disconnectedCallback();
  }
  render() {
    const menus = Object.values(this._flattenedMenus).filter((menu) => this._openedSubMenus.includes(menu.menuIndex));
    return b`
			<div
				class=${["mask", this._leaving ? "maskLeaving" : ""].filter(Boolean).join(" ")}
				@click=${(e) => this._handleCancel(e)}
			>
				${menus.map((menu) => this._renderMenu(menu))}
			</div>
		`;
  }
  _renderMenu(menu) {
    return b`
			<div
				class="menu"
				style=${o(this._getMenuPosition(menu))}
				${n$1((el) => {
      if (el) this._menuElemRefs[menu.menuIndex] = el;
    })}
				@mouseup=${(e) => e.stopPropagation()}
				@click=${(e) => e.stopPropagation()}
			>
				${menu.menu.map((menuItem, index) => this._renderMenuItem(menuItem, index))}
			</div>
		`;
  }
  _renderMenuItem(menuItem, _index) {
    var _a;
    return b`
			<div
				class=${this._getMenuItemClassName(menuItem)}
				tabindex=${menuItem.type === "separator" ? -1 : 0}
				@mouseup=${(e) => this._handleSelect(e, menuItem)}
				@mouseenter=${() => this._handleMenuItemMouseEnter(menuItem)}
				@mouseleave=${() => this._handleMenuItemMouseLeave()}
				@focus=${(e) => this._handleMenuItemFocused(e, menuItem)}
			>
				${menuItem.type !== "separator" ? b`
					<div class="label">
						${menuItem.label}
					</div>
				` : ""}
				${menuItem.type === "checkbox" || menuItem.type === "radio" ? b`
					<div class="iconArea">
						${menuItem.type === "checkbox" ? b`<ffbox-checkbox .checked=${menuItem.checked}></ffbox-checkbox>` : b`<ffbox-radio .checked=${menuItem.checked}></ffbox-radio>`}
					</div>
				` : ""}
				${"icon" in menuItem && menuItem.icon ? b`
					<div class="iconArea">
						${menuItem.icon}
					</div>
				` : ""}
				${menuItem.type === "submenu" ? b`
					<div class=${["iconRightArea", ((_a = this._openedSubMenuItemPos[menuItem.key ?? -1]) == null ? void 0 : _a.preferDirection) === "l" ? "flipped" : ""].filter(Boolean).join(" ")}>
						${o$1(rightIcon)}
					</div>
				` : ""}
			</div>
		`;
  }
  // 将所有子菜单打平，这样就能使用一个循环渲染所有菜单
  // （Vue 版本需 toRaw 解除响应式代理才能做 === 比较，Lit 直接持有原始引用，无需此步骤）
  _flattenMenus() {
    const allMenus = [];
    let i2 = 0;
    const queue = [{
      menu: this.menu,
      menuIndex: i2,
      parent: null
    }];
    while (queue.length) {
      const menu = queue.shift();
      allMenus.push(menu);
      for (const menuItem of menu.menu) {
        if (menuItem.type === "submenu") {
          i2++;
          menuItem.key = i2;
          queue.push({
            menu: menuItem.subMenu,
            menuIndex: i2,
            parent: menu
          });
        }
      }
    }
    const ret = [];
    for (const menu of allMenus) {
      ret[menu.menuIndex] = menu;
    }
    return ret;
  }
  _getMenuItemClassName(menuItem) {
    if (menuItem.type === "separator") {
      return "menuSeparator";
    } else {
      let retStr = ["menuItem"];
      if (menuItem.disabled) {
        retStr.push("menuItemDisabled");
      }
      if ("value" in menuItem && this._currentSelectedItem === menuItem.value) {
        retStr.push("menuItemSelected");
      } else {
        if (this._currentHoveredItem === menuItem) {
          retStr.push("menuItemHovered");
        }
        if (menuItem.type === "submenu") {
          if (this._openedSubMenus.includes(menuItem.key)) {
            retStr.push("menuItemHovered");
          }
        }
      }
      return retStr.join(" ");
    }
  }
  _getMenuPosition(menu) {
    const menuItemHeight = 32;
    const menuSeparatorHeight = 9;
    const menuPaddingY = 6;
    let ScreenWidth = document.documentElement.clientWidth;
    let ScreenHeight = document.documentElement.clientHeight;
    const canvas = document.createElement("canvas");
    canvas.style.position = "fixed";
    canvas.style.top = "150px";
    const context = canvas.getContext("2d");
    context.font = getComputedStyle(document.body).font.replace(/\d+px/, "14px");
    const listWidth2 = menu.menu.reduce((prev, curr) => {
      if ("label" in curr) {
        const metrics = context.measureText(curr.label);
        context.fillText(curr.label, 0, Math.random() * 150);
        return Math.max(metrics.width, prev);
      } else {
        return prev;
      }
    }, 0);
    const listWidth = Math.min(listWidth2 + 86, Math.min(window.innerWidth, 800));
    const listHeight = menu.menu.reduce((prev, curr) => prev + (curr.type === "separator" ? menuSeparatorHeight : menuItemHeight), 0) + menuPaddingY * 2;
    const _triggerRect = this._openedSubMenuItemPos[menu.menuIndex] || this.triggerRect || { xMin: 0, yMin: 0, xMax: listWidth, yMax: 0 };
    const isHorizontal = this._openedSubMenuItemPos[menu.menuIndex] !== void 0;
    let finalPosition = {};
    if (isHorizontal) {
      const direction = "preferDirection" in _triggerRect && _triggerRect.preferDirection === "l" ? "l" : "r";
      const finalLeft = direction === "r" ? Math.min(_triggerRect.xMax, ScreenWidth - listWidth) : Math.max(_triggerRect.xMin - listWidth, 0);
      finalPosition = {
        left: `${finalLeft}px`,
        width: `${listWidth}px`
      };
    } else {
      const finalWidth = Math.max(listWidth, _triggerRect.xMax - _triggerRect.xMin);
      const centralX = Math.max(finalWidth / 2, Math.min((_triggerRect.xMax + _triggerRect.xMin) / 2, ScreenWidth - finalWidth / 2));
      finalPosition = {
        left: `${centralX - finalWidth / 2}px`,
        width: `${finalWidth}px`
      };
    }
    let upperSpace = isHorizontal ? _triggerRect.yMax : _triggerRect.yMin;
    let lowerSpace = ScreenHeight - (isHorizontal ? _triggerRect.yMin : _triggerRect.yMax);
    if (upperSpace >= lowerSpace) {
      if (listHeight <= upperSpace) {
        finalPosition = { ...finalPosition, height: `${listHeight}px`, bottom: `${ScreenHeight - upperSpace}px` };
      } else {
        finalPosition = { ...finalPosition, height: `${upperSpace}px`, top: `${0}px` };
      }
    } else {
      if (listHeight <= lowerSpace) {
        finalPosition = { ...finalPosition, height: `${listHeight}px`, top: `${ScreenHeight - lowerSpace}px` };
      } else {
        finalPosition = { ...finalPosition, height: `${lowerSpace}px`, bottom: `${0}px` };
      }
    }
    return finalPosition;
  }
  _getMenuByItem(menuItem) {
    for (const [keyInFlattened, menu] of Object.entries(this._flattenedMenus)) {
      for (const [keyInMenu, _menuItem] of Object.entries(menu.menu)) {
        if (_menuItem === menuItem) {
          return {
            menu,
            indexInFlattened: Number(keyInFlattened),
            indexInMenu: Number(keyInMenu)
          };
        }
      }
    }
  }
  _getMenuAndItemByValue(value) {
    for (const menu of Object.values(this._flattenedMenus)) {
      for (const menuItem of menu.menu) {
        if ("value" in menuItem && menuItem.value === value) {
          return {
            menu,
            menuItem
          };
        }
      }
    }
  }
  /** 关闭前给个机会展示退出动画（对应 Vue 版 exposed.preClose） */
  preClose() {
    this._leaving = true;
  }
  /**
   * 关闭菜单，播完离场动画后组件自行从 DOM 移除
   * （对应 Vue 版 Menu.tsx 的 handleClose：同一次 render 内第二次调用时，需判断是否已经被卸载）
   */
  close() {
    if (!this._unmounted) {
      this.preClose();
      (this.onClose || (() => {
      }))();
      this._unmounted = true;
      setTimeout(() => {
        this.remove();
      }, 150);
    }
  }
  /** 由外部（如 DropdownInput）转发键盘事件（对应 Vue 版 exposed.triggerKeyboardEvent） */
  triggerKeyboardEvent(event) {
    this._keydownListener(event);
  }
  /** 更改选中值并主动反馈至菜单（对应 Vue 版 exposed.setSelectedValue） */
  setSelectedValue(value) {
    this._currentSelectedItem = value;
  }
};
FFBoxMenu.styles = i`
		:host {
			display: block;
			position: fixed;
			left: 0;
			top: 0;
			width: 100%;
			height: 100%;
			color: inherit;
			z-index: 10;
		}
		.mask {
			position: relative;
			width: 100%;
			height: 100%;
			// pointer-events: none;
		}
		.menu {
			position: absolute;
			// width: 200px;
			box-sizing: border-box;
			padding: 6px;
			border-radius: 8px;
			font-size: 0;
			text-align: left;
			overflow-y: auto;
			background: hwb(var(--bg98));
			box-shadow: 0px 4px 12px rgba(0, 0, 0, 0.3);
			-webkit-app-region: none;
			user-select: none;
			/* 对应 Vue TransitionGroup 的 menuAnimate-enter 动画，原生 animation 在元素插入时自动触发 */
			animation: menuAnimateEnter cubic-bezier(0.33, 1, 1, 1) 0.15s, menuAnimateEnterOpacity linear 0.1s;
		}
		@keyframes menuAnimateEnter {
			from { transform: scale(0.95); }
			to { transform: scale(1); }
		}
		@keyframes menuAnimateEnterOpacity {
			from { opacity: 0; }
			to { opacity: 1; }
		}
		/* 对应 menuAnimate-leave 动画。Lit 无 TransitionGroup，由 maskLeaving 类统一驱动离场 */
		.maskLeaving .menu {
			transform: scale(0.95);
			opacity: 0;
			transition: all linear 0.1s;
		}
		.menu::-webkit-scrollbar {
			position: relative;
			width: 12px;
			// background: transparent;
			box-shadow: 12px 0 12px -12px hwb(0 50% 50% / 0.08) inset;
		}
		.menu::-webkit-scrollbar-thumb {
			border-radius: 12px;
			background: hwb(0 50% 50% / 0.3);
			border: 3px solid transparent;
			background-clip: content-box;
			// box-shadow: 0 0 4px red;
		}
		.menu::-webkit-scrollbar-track {
			background: none;
		}
		.menuItem {
			display: inline-block;
			position: relative;
			box-sizing: border-box;
			width: 100%;
			height: 32px;
			// border-bottom: #EEE 1px solid;
			border-radius: 4px;
			font-size: 14px;
			// outline: none;
		}
		.menuItem .label {
			position: absolute;
			top: 0;
			left: 30px;
			right: 30px;
			line-height: 32px;
			white-space: nowrap;
			text-overflow: ellipsis;
			overflow: hidden;
		}
		.menuItem .iconArea {
			position: absolute;
			top: 0;
			left: 0;
			width: 28px;
			height: 32px;
			display: flex;
			justify-content: center;
			align-items: center;
		}
		.menuItem .iconArea > svg {
			width: 20px;
			height: 20px;
		}
		.menuItem .iconRightArea {
			position: absolute;
			top: 0;
			right: 0;
			width: 28px;
			height: 32px;
		}
		.menuItem .iconRightArea svg {
			position: absolute;
			left: 25%;
			top: 25%;
			width: 50%;
			height: 50%;
		}
		/* 子菜单倾向向左打开时，右三角翻转（对应 Vue 的 :style transform rotate） */
		.menuItem .iconRightArea.flipped svg {
			transform: rotate(180deg);
		}
		.menuItem .opArea {
			position: absolute;
			top: 0;
			left: 0;
			width: 28px;
			height: 32px;
		}
		.menuItemDisabled {
			opacity: 0.3;
		}
		.menuItemSelected {
			background: hwb(var(--menuItemSelected));
		}
		.menuItemHovered {
			background: hwb(var(--menuItemHovered));
		}
		.menuSeparator {
			display: inline-block;
			position: relative;
			width: 100%;
			height: 1px;
			margin: 4px 0;
			background-color: #77777733;
		}
	`;
__decorateClass([
  n({ attribute: false })
], FFBoxMenu.prototype, "menu", 2);
__decorateClass([
  n({ attribute: false })
], FFBoxMenu.prototype, "type", 2);
__decorateClass([
  n({ attribute: false })
], FFBoxMenu.prototype, "selectedValue", 2);
__decorateClass([
  n({ attribute: false })
], FFBoxMenu.prototype, "triggerRect", 2);
__decorateClass([
  n({ attribute: false })
], FFBoxMenu.prototype, "onSelect", 2);
__decorateClass([
  n({ attribute: false })
], FFBoxMenu.prototype, "onCancel", 2);
__decorateClass([
  n({ attribute: false })
], FFBoxMenu.prototype, "onClose", 2);
__decorateClass([
  n({ attribute: false })
], FFBoxMenu.prototype, "onKeyDown", 2);
__decorateClass([
  n({ attribute: false })
], FFBoxMenu.prototype, "returnFocus", 2);
__decorateClass([
  c({ context: themeContext, subscribe: true }),
  n({ reflect: true, attribute: "data-theme" })
], FFBoxMenu.prototype, "theme", 2);
__decorateClass([
  r()
], FFBoxMenu.prototype, "_openedSubMenus", 2);
__decorateClass([
  r()
], FFBoxMenu.prototype, "_openedSubMenuItemPos", 2);
__decorateClass([
  r()
], FFBoxMenu.prototype, "_currentHoveredItem", 2);
__decorateClass([
  r()
], FFBoxMenu.prototype, "_currentSelectedItem", 2);
__decorateClass([
  r()
], FFBoxMenu.prototype, "_leaving", 2);
FFBoxMenu = __decorateClass([
  t("ffbox-menu")
], FFBoxMenu);
function _detectTheme() {
  const provider = document.querySelector("ffbox-theme-provider");
  if (provider) return provider.theme === "dark" ? "dark" : "light";
  return "light";
}
FFBoxMenu.showMenu = function(options) {
  const el = document.createElement("ffbox-menu");
  el.menu = options.menu;
  el.type = options.type || "action";
  el.selectedValue = options.selectedValue;
  if (options.triggerRect) {
    el.triggerRect = options.triggerRect;
  } else if (options.triggerElem) {
    const rect = options.triggerElem.getBoundingClientRect();
    el.triggerRect = { xMin: rect.left, yMin: rect.top, xMax: rect.right, yMax: rect.bottom };
  }
  el.onSelect = options.onSelect;
  el.onCancel = options.onCancel;
  el.onClose = options.onClose;
  el.onKeyDown = options.onKeyDown;
  el.returnFocus = options.returnFocus;
  el.theme = _detectTheme();
  const container = options.container || document.body;
  container.appendChild(el);
  return {
    menu: el,
    close: () => el.close(),
    triggerKeyboardEvent: (event) => el.triggerKeyboardEvent(event),
    setSelectedValue: (value) => el.setSelectedValue(value)
  };
};
export {
  FFBoxMenu,
  getMenuItemByValue
};
//# sourceMappingURL=ffbox-menu.js.map
