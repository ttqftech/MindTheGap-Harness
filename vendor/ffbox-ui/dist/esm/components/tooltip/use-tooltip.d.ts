import { Directive, PartInfo, ElementPart } from 'lit/directive.js';
import { TooltipPosition, TooltipStyleName } from './tooltip-helpers.js';
export type { TooltipPosition, TooltipStyleName };
declare class TooltipDirective extends Directive {
    private _onMouseenter;
    private _onMouseleave;
    constructor(partInfo: PartInfo);
    update(part: ElementPart, [content, position, styleName]: [string, TooltipPosition, TooltipStyleName]): symbol;
    render(_content: string, _position: TooltipPosition, _styleName: TooltipStyleName): symbol;
}
/** 功能未验证 */
export declare const tooltip: (_content: string, _position: TooltipPosition, _styleName: TooltipStyleName) => import('lit-html/directive.js').DirectiveResult<typeof TooltipDirective>;
export declare function useTooltip(content: string, position?: TooltipPosition, styleName?: TooltipStyleName): {
    onmouseenter: (e: MouseEvent) => void;
    onmouseleave: () => void;
};
