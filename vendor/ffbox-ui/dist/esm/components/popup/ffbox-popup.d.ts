import { LitElement } from 'lit';
import { Theme } from '../../contexts/theme-context.js';
export interface PopupOptions {
    message: string;
    level?: 0 | 1 | 2 | 3;
}
export declare class FFBoxPopup extends LitElement {
    static show: (options: PopupOptions) => FFBoxPopup;
    static styles: import('lit').CSSResult;
    message: string;
    level: 0 | 1 | 2 | 3;
    verticalOffset: number;
    index: number;
    theme: Theme;
    private _show;
    private _duration;
    private _timeLeft;
    private _mouseIn;
    private _delayedVerticalOffset;
    private _userClosing;
    private _leaving;
    private _boxEl;
    private _timerId?;
    private get _bgClass();
    private get _strokeColor();
    private _handleMouseEnter;
    private _handleMouseLeave;
    connectedCallback(): void;
    firstUpdated(): void;
    disconnectedCallback(): void;
    willUpdate(changed: Map<string, unknown>): void;
    updated(): void;
    render(): import('lit-html').TemplateResult<1>;
    private _handleMouseDown;
    private _handleMouseUp;
    private _close;
}
declare global {
    interface HTMLElementTagNameMap {
        'ffbox-popup': FFBoxPopup;
    }
}
