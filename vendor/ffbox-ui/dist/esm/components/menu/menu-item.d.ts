import { TemplateResult } from 'lit';
/**
 * 由 src/common/menu.ts 迁移而来。
 * 原文件的 icon 为 Vue VNode，此处改为 Lit TemplateResult 以保持组件库无框架依赖。
 */
export type MenuItem<E = any> = {
    type: 'normal';
    value: any;
    label: string;
    icon?: TemplateResult;
    tooltip?: string;
    disabled?: boolean;
    onClick?: (event: Event, value: any) => boolean | void;
    extra?: E;
} | {
    type: 'separator';
} | {
    type: 'submenu';
    label: string;
    tooltip?: string;
    subMenu: MenuItem<E>[];
    disabled?: boolean;
    key?: number;
} | {
    type: 'checkbox' | 'radio';
    value: any;
    checked: boolean;
    label: string;
    tooltip?: string;
    disabled?: boolean;
    onClick?: (event: Event, checked: boolean) => boolean | void;
};
export type NarrowedMenuItem = Extract<MenuItem, {
    type: 'normal';
}>;
export declare function getMenuItemByValue<E>(menu: MenuItem<E>[], value: any, compareFunc?: (itemValue: any, yourValue: any) => boolean): {
    type: "checkbox" | "radio";
    value: any;
    checked: boolean;
    label: string;
    tooltip?: string;
    disabled?: boolean;
    onClick?: (event: Event, checked: boolean) => boolean | void;
} | {
    type: "normal";
    value: any;
    label: string;
    icon?: TemplateResult;
    tooltip?: string;
    disabled?: boolean;
    onClick?: (event: Event, value: any) => boolean | void;
    extra?: E | undefined;
} | undefined;
