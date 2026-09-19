import { LitElement } from 'lit';
import { Theme } from '../../contexts/theme-context.js';
declare global {
    var __ffbox_context_root_attached: boolean | undefined;
}
export declare class FFBoxThemeProvider extends LitElement {
    theme: Theme;
    render(): import('lit-html').TemplateResult<1>;
}
declare global {
    interface HTMLElementTagNameMap {
        'ffbox-theme-provider': FFBoxThemeProvider;
    }
}
