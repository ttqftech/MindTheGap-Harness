function parseTime(timeString) {
  if (timeString === "N/A") {
    return -1;
  }
  let exp;
  if (exp = /^(\d+):([0-5]?[0-9]):([0-5]?[0-9])(.\d+)?$/.exec(timeString)) {
    const hour = Number(exp[1]);
    const minute = Number(exp[2]);
    const second = Number(exp[3]);
    const mili = Number(exp[4] ?? "0");
    if (minute >= 60 || second >= 60) {
      return -1;
    }
    return hour * 3600 + minute * 60 + second + Number(mili);
  } else if (exp = /^([0-5]?[0-9]):([0-5]?[0-9])(.\d+)?$/.exec(timeString)) {
    const minute = Number(exp[1]);
    const second = Number(exp[2]);
    const mili = Number(exp[3] ?? "0");
    if (minute >= 60 || second >= 60) {
      return -1;
    }
    return minute * 60 + second + Number(mili);
  } else if (/^(\d+)(.\d+)?$/.test(timeString)) {
    return Number(timeString);
  }
  return -1;
}
const INVALID_TEXT = "默认输入不合法提示";
function notEmptyValidator(value) {
  return value.length ? void 0 : INVALID_TEXT;
}
function durationValidator(value) {
  return parseTime(value) >= 0 || !value.length ? void 0 : INVALID_TEXT;
}
function numberValidator(value) {
  return value.match(/^-?\d+(.\d+)?$/) ? void 0 : INVALID_TEXT;
}
numberValidator.integer = function(value) {
  return value.match(/^-?\d+$/) ? void 0 : INVALID_TEXT;
};
numberValidator.integerEmptyable = function(value) {
  return value === void 0 || value === "" || value.match(/^-?\d+$/) ? void 0 : INVALID_TEXT;
};
function durationFixer(value) {
  return value.replaceAll("：", ":").replaceAll("。", ".").replace(/[a-z]/g, "");
}
export {
  durationValidator as a,
  numberValidator as b,
  durationFixer as d,
  notEmptyValidator as n
};
//# sourceMappingURL=ffbox-utils.js.map
