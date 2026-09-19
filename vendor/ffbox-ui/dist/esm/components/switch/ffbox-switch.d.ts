import { LitElement } from 'lit';
import { Theme } from '../../contexts/theme-context.js';
export declare class FFBoxSwitch extends LitElement {
    static styles: import('lit').CSSResult;
    checked: boolean;
    theme: Theme;
    private slipperEl;
    render(): import('lit-html').TemplateResult<1>;
    private _handleDragStart;
    private _handleKeydown;
    private _handleKeyup;
    private _emitChange;
}
declare global {
    interface HTMLElementTagNameMap {
        'ffbox-switch': FFBoxSwitch;
    }
}
