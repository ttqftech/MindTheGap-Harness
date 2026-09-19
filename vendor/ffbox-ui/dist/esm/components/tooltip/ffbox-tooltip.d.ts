import { LitElement } from 'lit';
export interface TooltipOptions {
    content: string;
    style: Partial<CSSStyleDeclaration>;
    className?: string;
}
export declare class FFBoxTooltip extends LitElement {
    static show: (options: TooltipOptions) => void;
    static hide: () => void;
    static styles: import('lit').CSSResult;
    content: string;
    show: boolean;
    className: string;
    theme: 'light' | 'dark';
    render(): import('lit-html').TemplateResult<1>;
}
export { tooltip, useTooltip, type TooltipPosition, type TooltipStyleName } from './use-tooltip.js';
export { enableTooltipAutoscan, disableTooltipAutoscan } from './tooltip-autoscan.js';
declare global {
    interface HTMLElementTagNameMap {
        'ffbox-tooltip': FFBoxTooltip;
    }
}
