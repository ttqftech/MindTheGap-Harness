import { LitElement, TemplateResult } from 'lit';
import { Theme } from '../../contexts/theme-context.js';
import { ButtonType } from '../button/ffbox-button.js';
export interface MsgboxButton {
    text: string;
    callback?: () => boolean | Promise<void> | void;
    type?: ButtonType;
    role?: 'confirm' | 'cancel';
}
export interface MsgboxOptions {
    container?: HTMLElement;
    image?: TemplateResult;
    title?: string;
    content?: string | TemplateResult | (() => TemplateResult);
    buttons?: MsgboxButton[];
}
export declare class FFBoxMsgbox extends LitElement {
    static show: (options?: MsgboxOptions) => FFBoxMsgbox;
    static styles: import('lit').CSSResult;
    title: string;
    image?: TemplateResult;
    content?: string | TemplateResult | (() => TemplateResult);
    buttons?: MsgboxButton[];
    theme: Theme;
    private _entered;
    private _leaving;
    private _disable;
    private _backgroundMouseDown;
    private previousActiveElement;
    private _boxEl;
    private get _mouseDownTransformStyle();
    firstUpdated(): void;
    disconnectedCallback(): void;
    private get _buttons();
    private _handleKeyPress;
    private _handleButtonClick;
    /** 播放离场动画，动画结束后组件自行从 DOM 移除并派发 closed 事件 */
    close(): void;
    render(): TemplateResult<1>;
}
declare global {
    interface HTMLElementTagNameMap {
        'ffbox-msgbox': FFBoxMsgbox;
    }
}
