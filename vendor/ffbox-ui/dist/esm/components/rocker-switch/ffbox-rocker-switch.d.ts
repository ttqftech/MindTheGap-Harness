import { LitElement } from 'lit';
import { Theme } from '../../contexts/theme-context.js';
export declare class FFBoxRockerSwitch extends LitElement {
    static styles: import('lit').CSSResult;
    size: 's' | 'm';
    disabledLeft: boolean;
    disabledRight: boolean;
    theme: Theme;
    render(): import('lit-html').TemplateResult<1>;
    private _goLeft;
    private _goRight;
}
declare global {
    interface HTMLElementTagNameMap {
        'ffbox-rocker-switch': FFBoxRockerSwitch;
    }
}
