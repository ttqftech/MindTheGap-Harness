import { LitElement } from 'lit';
import { Theme } from '../../contexts/theme-context.js';
export interface Size {
    width: number;
    height: number;
}
/**
 * 本组件适用于需要对不定高度组件进行通过高度变化的动画进行显隐的场景
 * AutoSizeWrapper 自身是一个 div，能测量 slot 中所有组件的高度并反馈到 style 或 customStyle 函数的参数中
 * 由于 slot 可以是多个组件，所以会多一层 div 进行打包测量高度
 * 注意此组件并不适用于通过动态高度 slot 组件的高度修改 slot 组件的高度，因为这个逻辑回环了。子组件的高度应当是自由撑开的，否则无法测量高度
 *
 * 迁移说明：Vue 版同时提供 style 与 customStyle 两个 prop（customStyle 是 style 不生效时的替代）。
 * 在 Web Component 中 style 与 HTMLElement.style 冲突，故统一为 customStyle。
 */
export declare class FFBoxAutoSizeWrapper extends LitElement {
    static styles: import('lit').CSSResult;
    useResizeObserver: boolean;
    customStyle?: (size: Size) => Record<string, string>;
    theme: Theme;
    /** 最近一次测量到的 slot 宽度（只读） */
    width: number;
    /** 最近一次测量到的 slot 高度（只读） */
    height: number;
    private _containerEl;
    private _resizeObserver?;
    connectedCallback(): void;
    firstUpdated(): void;
    updated(changed: Map<string, unknown>): void;
    disconnectedCallback(): void;
    private _observeSlot;
    /** 重新测量 slot 尺寸。外部在 slot 内容变化后也可主动调用 */
    updateSize(): void;
    private _updateSize;
    render(): import('lit-html').TemplateResult<1>;
}
declare global {
    interface HTMLElementTagNameMap {
        'ffbox-auto-size-wrapper': FFBoxAutoSizeWrapper;
    }
}
