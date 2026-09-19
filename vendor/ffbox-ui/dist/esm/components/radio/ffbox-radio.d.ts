import { LitElement } from 'lit';
import { Theme } from '../../contexts/theme-context.js';
export declare class FFBoxRadio extends LitElement {
    static styles: import('lit').CSSResult;
    checked: boolean | 'partial';
    disabled: boolean;
    theme: Theme;
    render(): import('lit-html').TemplateResult<1>;
    private _handleClick;
}
declare global {
    interface HTMLElementTagNameMap {
        'ffbox-radio': FFBoxRadio;
    }
}
