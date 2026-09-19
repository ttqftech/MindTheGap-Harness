import { LitElement } from 'lit';
import { Theme } from '../../contexts/theme-context.js';
export declare class FFBoxControlBox extends LitElement {
    static styles: import('lit').CSSResult;
    title: string;
    description: string;
    long: boolean;
    optional: boolean;
    hasValue: boolean;
    theme: Theme;
    render(): import('lit-html').TemplateResult<1>;
    private _handleCheckboxChange;
}
declare global {
    interface HTMLElementTagNameMap {
        'ffbox-control-box': FFBoxControlBox;
    }
}
