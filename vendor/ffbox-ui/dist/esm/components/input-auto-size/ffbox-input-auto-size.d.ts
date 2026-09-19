import { LitElement } from 'lit';
import { Theme } from '../../contexts/theme-context.js';
export declare class FFBoxInputAutoSize extends LitElement {
    static styles: import('lit').CSSResult;
    value: string;
    focusOnMounted: boolean;
    theme: Theme;
    private _inputEl;
    private _hiddenDivEl;
    private _resizeObserver?;
    private _inputWidth;
    connectedCallback(): void;
    firstUpdated(): void;
    disconnectedCallback(): void;
    private _refreshSize;
    render(): import('lit-html').TemplateResult<1>;
    private _handleInput;
    private _handleKeydown;
    private _handleBlur;
    private _handleChange;
}
declare global {
    interface HTMLElementTagNameMap {
        'ffbox-input-auto-size': FFBoxInputAutoSize;
    }
}
