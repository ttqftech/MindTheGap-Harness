import { LitElement } from 'lit';
import { Theme } from '../../contexts/theme-context.js';
export declare class FFBoxSlider extends LitElement {
    static styles: import('lit').CSSResult;
    private static _numberOrStringConverter;
    value?: number | string;
    min: number;
    max: number;
    arrowKeyStep?: number;
    adsorption?: 'int' | 'tags' | ((value: number) => number);
    tags?: [number, string][] | Map<number, string>;
    mode?: 'number' | 'string';
    valueToDisplay?: {
        base?: number;
        type?: 'bitrate' | 'integer' | 'revertInteger';
    } | ((value: number | string | undefined) => string);
    useIEC: boolean;
    theme: Theme;
    private _tagsRef?;
    private _sortedTagsCache?;
    private get _sortedTags();
    private get _numericalValue();
    private get _limitedValue();
    private _valueToDisplayConverter;
    render(): import('lit-html').TemplateResult<1>;
    private _emitNewValue;
    private _adsorb;
    private _handleDragStart;
    private _handleKeydown;
}
declare global {
    interface HTMLElementTagNameMap {
        'ffbox-slider': FFBoxSlider;
    }
}
