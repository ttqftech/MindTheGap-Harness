export declare function getValidator(type: string): ((value: string) => "默认输入不合法提示" | undefined) | undefined;
export declare function notEmptyValidator(value: string): "默认输入不合法提示" | undefined;
export declare function durationValidator(value: string): "默认输入不合法提示" | undefined;
export declare function numberValidator(value: string): "默认输入不合法提示" | undefined;
export declare namespace numberValidator {
    var integer: (value: string) => "默认输入不合法提示" | undefined;
    var integerEmptyable: (value: string) => "默认输入不合法提示" | undefined;
}
export declare function framerateValidator(value: string): "默认输入不合法提示" | undefined;
export declare function durationFixer(value: string): string;
export declare function posIntegerFixer(value: string): string;
