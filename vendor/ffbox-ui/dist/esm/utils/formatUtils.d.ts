/**
 * 时间格式化工具，由 src/common/formatUtils.ts 迁移而来。
 *
 * 组件库只用得到 parseTime（校验时间输入）与 formatTime（展示时长），
 * 因此只迁移这两个函数，其余（体积、码率、传输速率）未迁移。
 */
/**
 * 秒数 → 时间格式化
 * @param seconds 秒数（可带小数）
 * @param style 格式化风格，描述"用途"而非"实现"：
 *   - `'display'`: 人类可读，带精度信息 — `H:MM:SS / M:SS.c / s.cc`【TaskItem.graphTime、CutOperator 关键帧】
 *   - `'compact'`: 人类可读，紧凑 — `H:MM:SS / M:SS / "X s"`【TaskItem.graphLeftTime、ProgressLog X 轴、SponsorPanel 限制时长】
 *   - `'ffmpeg'` : 补零机器格式 — `HH:MM:SS.xx`（可直接作为 FFmpeg 参数）
 */
export declare function formatTime(seconds: number, style: 'display' | 'compact' | 'ffmpeg'): string;
/**
 * 传入 ffmpeg 支持的时间格式（如 HH:MM:SS.xx 或 M:SS.xx 或 xxx.xx），返回秒数（如格式错误则返回 -1）
 */
export declare function parseTime(timeString: string): number;
declare const _default: {
    time: typeof formatTime;
    parseTime: typeof parseTime;
};
export default _default;
