import { LitElement } from 'lit';
import { Theme } from '../../contexts/theme-context.js';
export type ButtonType = 'normal' | 'primary' | 'danger' | 'noBg';
export type ButtonSize = 'small' | 'normal' | 'large';
export declare class FFBoxButton extends LitElement {
    static styles: import('lit').CSSResult;
    constructor();
    type: ButtonType;
    size: ButtonSize;
    disabled: boolean;
    theme: Theme;
    render(): import('lit-html').TemplateResult<1>;
}
declare global {
    interface HTMLElementTagNameMap {
        'ffbox-button': FFBoxButton;
    }
}
