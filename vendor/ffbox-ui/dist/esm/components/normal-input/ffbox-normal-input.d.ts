import { LitElement, PropertyValues } from 'lit';
import { Theme } from '../../contexts/theme-context.js';
export declare class FFBoxNormalInput extends LitElement {
    static styles: import('lit').CSSResult;
    value: string;
    type: 'text' | 'password';
    disabled: boolean;
    placeholder: string;
    validator?: (value: string) => string | undefined;
    inputFixer?: (value: string) => string;
    theme: Theme;
    private _focused;
    private _invalidMsg?;
    willUpdate(changed: PropertyValues): void;
    render(): import('lit-html').TemplateResult<1>;
    private _handleBlur;
    private _handleFocus;
    private _handleInput;
    private _handleKeydown;
    private _validate;
}
declare global {
    interface HTMLElementTagNameMap {
        'ffbox-normal-input': FFBoxNormalInput;
    }
}
