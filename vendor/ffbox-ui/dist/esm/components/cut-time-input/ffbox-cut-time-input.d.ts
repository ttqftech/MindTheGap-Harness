import { LitElement } from 'lit';
import { Theme } from '../../contexts/theme-context.js';
export type CutTimeValue = [string | undefined, string | undefined];
export declare class FFBoxCutTimeInput extends LitElement {
    static styles: import('lit').CSSResult;
    value: CutTimeValue;
    disabled: boolean;
    placeholder?: [string, string];
    theme: Theme;
    private _inputText;
    private _focused;
    /** 两个输入框任一校验不通过时的提示文本 */
    private get _invalidMsg();
    private get _selectorStyle();
    willUpdate(changed: Map<string, unknown>): void;
    render(): import('lit-html').TemplateResult<1>;
    private _handleBlur;
    private _handleFocus;
    private _handleInput;
    private _handleKeydown;
    private _handleClear;
    private _handleButtonClick;
    private _emitChange;
}
declare global {
    interface HTMLElementTagNameMap {
        'ffbox-cut-time-input': FFBoxCutTimeInput;
    }
}
