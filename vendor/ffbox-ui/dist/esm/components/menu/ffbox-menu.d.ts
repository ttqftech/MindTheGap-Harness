import { LitElement, PropertyValues } from 'lit';
import { Theme } from '../../contexts/theme-context.js';
import { MenuItem } from './menu-item.js';
/**
 * 由 src/renderer/src/components/Menu/Menu.tsx + MenuComponent.vue 合并迁移而来。
 * Vue 版本拆成「命令式入口（Menu.tsx）+ 渲染组件（MenuComponent.vue）」两层，由 createVNode/render 挂载；
 * Lit 版本合并为一个自定义元素，通过 FFBoxMenu.showMenu() 命令式创建（对应 Vue 版导出的 showMenu）。
 */
export interface MenuOptions {
    menu: MenuItem[];
    type?: 'action' | 'select';
    selectedValue?: any;
    container?: HTMLElement;
    triggerRect?: {
        xMin: number;
        yMin: number;
        xMax: number;
        yMax: number;
    };
    triggerElem?: HTMLElement;
    disableOnClick?: boolean;
    onSelect?: (event: Event, value: any, checked?: boolean) => void | false;
    onCancel?: (event: Event) => void | false;
    onClose?: () => void;
    onKeyDown?: (event: KeyboardEvent) => void;
    returnFocus?: (event: Event) => void;
}
/** FFBoxMenu.showMenu() 的返回值，对应 Vue 版 showMenu 的返回对象 */
export interface FFBoxMenuHandle {
    menu: FFBoxMenu;
    close: () => void;
    triggerKeyboardEvent: (event: KeyboardEvent) => void;
    setSelectedValue: (value: any) => void;
}
/**
 * 菜单有两种模式：动作菜单、选项菜单
 * 动作菜单一般无 selectedValue。只有鼠标点击或键盘 Enter 时触发 onSelect，触发后默认关闭菜单
 * 选项菜单一般有 selectedValue。鼠标点击、键盘 Enter 时触发 onSelect，触发后默认关闭菜单；键盘上下选择时触发 onSelect，触发后根据键盘按键决定是否关闭菜单
 */
export declare class FFBoxMenu extends LitElement {
    static showMenu: (options: MenuOptions) => FFBoxMenuHandle;
    static styles: import('lit').CSSResult;
    menu: MenuItem[];
    type: 'action' | 'select';
    selectedValue?: any;
    triggerRect?: MenuOptions['triggerRect'];
    onSelect?: MenuOptions['onSelect'];
    onCancel?: MenuOptions['onCancel'];
    onClose?: MenuOptions['onClose'];
    onKeyDown?: MenuOptions['onKeyDown'];
    returnFocus?: MenuOptions['returnFocus'];
    theme: Theme;
    private _openedSubMenus;
    private _openedSubMenuItemPos;
    private _currentHoveredItem;
    private _currentSelectedItem;
    private _leaving;
    private _flattenedMenus;
    private _menuElemRefs;
    private _unmounted;
    willUpdate(changed: PropertyValues): void;
    firstUpdated(): void;
    disconnectedCallback(): void;
    render(): import('lit-html').TemplateResult<1>;
    private _renderMenu;
    private _renderMenuItem;
    private _flattenMenus;
    private _getMenuItemClassName;
    private _getMenuPosition;
    private _getMenuByItem;
    private _getMenuAndItemByValue;
    private _calcSubMenuPosition;
    private _showTooltip;
    private _onItemSelect;
    private _handleSelect;
    private _handleMenuItemMouseEnter;
    private _handleMenuItemMouseLeave;
    private _handleMenuItemFocused;
    private _setHoveredItem;
    private _keydownListener;
    private _handleCancel;
    /** 关闭前给个机会展示退出动画（对应 Vue 版 exposed.preClose） */
    preClose(): void;
    /**
     * 关闭菜单，播完离场动画后组件自行从 DOM 移除
     * （对应 Vue 版 Menu.tsx 的 handleClose：同一次 render 内第二次调用时，需判断是否已经被卸载）
     */
    close(): void;
    /** 由外部（如 DropdownInput）转发键盘事件（对应 Vue 版 exposed.triggerKeyboardEvent） */
    triggerKeyboardEvent(event: KeyboardEvent): void;
    /** 更改选中值并主动反馈至菜单（对应 Vue 版 exposed.setSelectedValue） */
    setSelectedValue(value: any): void;
}
export { getMenuItemByValue, type MenuItem, type NarrowedMenuItem } from './menu-item.js';
declare global {
    interface HTMLElementTagNameMap {
        'ffbox-menu': FFBoxMenu;
    }
}
