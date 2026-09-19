import { LitElement } from 'lit';
import { Theme } from '../../contexts/theme-context.js';
export interface RadioListItem {
    value: string;
    caption?: string;
    deletable?: boolean;
    editable?: boolean;
    disabled?: boolean;
}
export declare class FFBoxRadioList extends LitElement {
    static styles: import('lit').CSSResult;
    list: RadioListItem[];
    value: string;
    placeholder: string;
    theme: Theme;
    private _editingIndex;
    render(): import('lit-html').TemplateResult<1>;
    private _renderItem;
    private _handleItemClick;
    private _handleLabelClick;
    private _handleEditConfirm;
    private _handleDelete;
}
declare global {
    interface HTMLElementTagNameMap {
        'ffbox-radio-list': FFBoxRadioList;
    }
}
