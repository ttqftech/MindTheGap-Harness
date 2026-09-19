export type TooltipPosition = 'br' | 'r' | 't' | 'tl' | 'tr' | 'mtl';
export type TooltipStyleName = 'small' | 'large';
export declare function computeTooltipStyle(position: TooltipPosition, e: MouseEvent): Partial<CSSStyleDeclaration>;
