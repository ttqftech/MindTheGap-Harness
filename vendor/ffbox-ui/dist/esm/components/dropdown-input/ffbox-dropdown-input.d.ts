import { LitElement, PropertyValues } from 'lit';
import { Theme } from '../../contexts/theme-context.js';
import { MenuItem } from '../menu/menu-item.js';
/**
 * 由 src/renderer/src/components/DropdownInput/DropdownInput.vue 迁移而来。
 * 原版的 onChange / onEnter 回调 prop 改为 change / enter 自定义事件；
 * 原版 watch(inputText) 的即时校验在 Lit 版中由 _handleInput / onSelect 中的 _validate() 等价实现；
 * 原版选中/输入后的值由父组件在 onChange 中写回 :text prop（受控用法），Web Component 为自包含组件，
 * 改为组件内部将当前值同步回 text 属性，保证重新打开菜单时能从当前选中项继续定位；
 * onChange 回调在选中（含键盘方向键选择）与输入时触发，onEnter 在未打开菜单时按下导航键（含 Enter）触发。
 */
export declare class FFBoxDropdownInput extends LitElement {
    static styles: import('lit').CSSResult;
    text?: string | number;
    list: MenuItem[];
    readonly: boolean;
    disabled: boolean;
    placeholder: string;
    validator?: (value: string) => string | undefined;
    inputFixer?: (value: string) => string;
    theme: Theme;
    private _focused;
    private _inputText;
    private _invalidMsg;
    private _selectorEl;
    private _menuHandle;
    willUpdate(changed: PropertyValues): void;
    render(): import('lit-html').TemplateResult<1>;
    private _openMenu;
    private _handleBlur;
    private _handleFocus;
    private _handleInput;
    private _handleKeydown;
    private _validate;
    private _dispatchChange;
}
declare global {
    interface HTMLElementTagNameMap {
        'ffbox-dropdown-input': FFBoxDropdownInput;
    }
}
