/**
 * @license
 * Copyright 2019 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
var _a;
const t$5 = globalThis, e$8 = t$5.ShadowRoot && (void 0 === t$5.ShadyCSS || t$5.ShadyCSS.nativeShadow) && "adoptedStyleSheets" in Document.prototype && "replace" in CSSStyleSheet.prototype, s$6 = Symbol(), o$8 = /* @__PURE__ */ new WeakMap();
let n$7 = class n {
  constructor(t3, e3, o2) {
    if (this._$cssResult$ = true, o2 !== s$6) throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");
    this.cssText = t3, this.t = e3;
  }
  get styleSheet() {
    let t3 = this.o;
    const s5 = this.t;
    if (e$8 && void 0 === t3) {
      const e3 = void 0 !== s5 && 1 === s5.length;
      e3 && (t3 = o$8.get(s5)), void 0 === t3 && ((this.o = t3 = new CSSStyleSheet()).replaceSync(this.cssText), e3 && o$8.set(s5, t3));
    }
    return t3;
  }
  toString() {
    return this.cssText;
  }
};
const r$6 = (t3) => new n$7("string" == typeof t3 ? t3 : t3 + "", void 0, s$6), i$6 = (t3, ...e3) => {
  const o2 = 1 === t3.length ? t3[0] : e3.reduce((e4, s5, o3) => e4 + ((t4) => {
    if (true === t4._$cssResult$) return t4.cssText;
    if ("number" == typeof t4) return t4;
    throw Error("Value passed to 'css' function must be a 'css' function result: " + t4 + ". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.");
  })(s5) + t3[o3 + 1], t3[0]);
  return new n$7(o2, t3, s$6);
}, S$1 = (s5, o2) => {
  if (e$8) s5.adoptedStyleSheets = o2.map((t3) => t3 instanceof CSSStyleSheet ? t3 : t3.styleSheet);
  else for (const e3 of o2) {
    const o3 = document.createElement("style"), n3 = t$5.litNonce;
    void 0 !== n3 && o3.setAttribute("nonce", n3), o3.textContent = e3.cssText, s5.appendChild(o3);
  }
}, c$4 = e$8 ? (t3) => t3 : (t3) => t3 instanceof CSSStyleSheet ? ((t4) => {
  let e3 = "";
  for (const s5 of t4.cssRules) e3 += s5.cssText;
  return r$6(e3);
})(t3) : t3;
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const { is: i$5, defineProperty: e$7, getOwnPropertyDescriptor: h$2, getOwnPropertyNames: r$5, getOwnPropertySymbols: o$7, getPrototypeOf: n$6 } = Object, a$1 = globalThis, c$3 = a$1.trustedTypes, l$1 = c$3 ? c$3.emptyScript : "", p$1 = a$1.reactiveElementPolyfillSupport, d$1 = (t3, s5) => t3, u$1 = { toAttribute(t3, s5) {
  switch (s5) {
    case Boolean:
      t3 = t3 ? l$1 : null;
      break;
    case Object:
    case Array:
      t3 = null == t3 ? t3 : JSON.stringify(t3);
  }
  return t3;
}, fromAttribute(t3, s5) {
  let i5 = t3;
  switch (s5) {
    case Boolean:
      i5 = null !== t3;
      break;
    case Number:
      i5 = null === t3 ? null : Number(t3);
      break;
    case Object:
    case Array:
      try {
        i5 = JSON.parse(t3);
      } catch (t4) {
        i5 = null;
      }
  }
  return i5;
} }, f$2 = (t3, s5) => !i$5(t3, s5), b$1 = { attribute: true, type: String, converter: u$1, reflect: false, useDefault: false, hasChanged: f$2 };
Symbol.metadata ?? (Symbol.metadata = Symbol("metadata")), a$1.litPropertyMetadata ?? (a$1.litPropertyMetadata = /* @__PURE__ */ new WeakMap());
let y$1 = class y extends HTMLElement {
  static addInitializer(t3) {
    this._$Ei(), (this.l ?? (this.l = [])).push(t3);
  }
  static get observedAttributes() {
    return this.finalize(), this._$Eh && [...this._$Eh.keys()];
  }
  static createProperty(t3, s5 = b$1) {
    if (s5.state && (s5.attribute = false), this._$Ei(), this.prototype.hasOwnProperty(t3) && ((s5 = Object.create(s5)).wrapped = true), this.elementProperties.set(t3, s5), !s5.noAccessor) {
      const i5 = Symbol(), h2 = this.getPropertyDescriptor(t3, i5, s5);
      void 0 !== h2 && e$7(this.prototype, t3, h2);
    }
  }
  static getPropertyDescriptor(t3, s5, i5) {
    const { get: e3, set: r2 } = h$2(this.prototype, t3) ?? { get() {
      return this[s5];
    }, set(t4) {
      this[s5] = t4;
    } };
    return { get: e3, set(s6) {
      const h2 = e3 == null ? void 0 : e3.call(this);
      r2 == null ? void 0 : r2.call(this, s6), this.requestUpdate(t3, h2, i5);
    }, configurable: true, enumerable: true };
  }
  static getPropertyOptions(t3) {
    return this.elementProperties.get(t3) ?? b$1;
  }
  static _$Ei() {
    if (this.hasOwnProperty(d$1("elementProperties"))) return;
    const t3 = n$6(this);
    t3.finalize(), void 0 !== t3.l && (this.l = [...t3.l]), this.elementProperties = new Map(t3.elementProperties);
  }
  static finalize() {
    if (this.hasOwnProperty(d$1("finalized"))) return;
    if (this.finalized = true, this._$Ei(), this.hasOwnProperty(d$1("properties"))) {
      const t4 = this.properties, s5 = [...r$5(t4), ...o$7(t4)];
      for (const i5 of s5) this.createProperty(i5, t4[i5]);
    }
    const t3 = this[Symbol.metadata];
    if (null !== t3) {
      const s5 = litPropertyMetadata.get(t3);
      if (void 0 !== s5) for (const [t4, i5] of s5) this.elementProperties.set(t4, i5);
    }
    this._$Eh = /* @__PURE__ */ new Map();
    for (const [t4, s5] of this.elementProperties) {
      const i5 = this._$Eu(t4, s5);
      void 0 !== i5 && this._$Eh.set(i5, t4);
    }
    this.elementStyles = this.finalizeStyles(this.styles);
  }
  static finalizeStyles(s5) {
    const i5 = [];
    if (Array.isArray(s5)) {
      const e3 = new Set(s5.flat(1 / 0).reverse());
      for (const s6 of e3) i5.unshift(c$4(s6));
    } else void 0 !== s5 && i5.push(c$4(s5));
    return i5;
  }
  static _$Eu(t3, s5) {
    const i5 = s5.attribute;
    return false === i5 ? void 0 : "string" == typeof i5 ? i5 : "string" == typeof t3 ? t3.toLowerCase() : void 0;
  }
  constructor() {
    super(), this._$Ep = void 0, this.isUpdatePending = false, this.hasUpdated = false, this._$Em = null, this._$Ev();
  }
  _$Ev() {
    var _a2;
    this._$ES = new Promise((t3) => this.enableUpdating = t3), this._$AL = /* @__PURE__ */ new Map(), this._$E_(), this.requestUpdate(), (_a2 = this.constructor.l) == null ? void 0 : _a2.forEach((t3) => t3(this));
  }
  addController(t3) {
    var _a2;
    (this._$EO ?? (this._$EO = /* @__PURE__ */ new Set())).add(t3), void 0 !== this.renderRoot && this.isConnected && ((_a2 = t3.hostConnected) == null ? void 0 : _a2.call(t3));
  }
  removeController(t3) {
    var _a2;
    (_a2 = this._$EO) == null ? void 0 : _a2.delete(t3);
  }
  _$E_() {
    const t3 = /* @__PURE__ */ new Map(), s5 = this.constructor.elementProperties;
    for (const i5 of s5.keys()) this.hasOwnProperty(i5) && (t3.set(i5, this[i5]), delete this[i5]);
    t3.size > 0 && (this._$Ep = t3);
  }
  createRenderRoot() {
    const t3 = this.shadowRoot ?? this.attachShadow(this.constructor.shadowRootOptions);
    return S$1(t3, this.constructor.elementStyles), t3;
  }
  connectedCallback() {
    var _a2;
    this.renderRoot ?? (this.renderRoot = this.createRenderRoot()), this.enableUpdating(true), (_a2 = this._$EO) == null ? void 0 : _a2.forEach((t3) => {
      var _a3;
      return (_a3 = t3.hostConnected) == null ? void 0 : _a3.call(t3);
    });
  }
  enableUpdating(t3) {
  }
  disconnectedCallback() {
    var _a2;
    (_a2 = this._$EO) == null ? void 0 : _a2.forEach((t3) => {
      var _a3;
      return (_a3 = t3.hostDisconnected) == null ? void 0 : _a3.call(t3);
    });
  }
  attributeChangedCallback(t3, s5, i5) {
    this._$AK(t3, i5);
  }
  _$ET(t3, s5) {
    var _a2;
    const i5 = this.constructor.elementProperties.get(t3), e3 = this.constructor._$Eu(t3, i5);
    if (void 0 !== e3 && true === i5.reflect) {
      const h2 = (void 0 !== ((_a2 = i5.converter) == null ? void 0 : _a2.toAttribute) ? i5.converter : u$1).toAttribute(s5, i5.type);
      this._$Em = t3, null == h2 ? this.removeAttribute(e3) : this.setAttribute(e3, h2), this._$Em = null;
    }
  }
  _$AK(t3, s5) {
    var _a2, _b;
    const i5 = this.constructor, e3 = i5._$Eh.get(t3);
    if (void 0 !== e3 && this._$Em !== e3) {
      const t4 = i5.getPropertyOptions(e3), h2 = "function" == typeof t4.converter ? { fromAttribute: t4.converter } : void 0 !== ((_a2 = t4.converter) == null ? void 0 : _a2.fromAttribute) ? t4.converter : u$1;
      this._$Em = e3;
      const r2 = h2.fromAttribute(s5, t4.type);
      this[e3] = r2 ?? ((_b = this._$Ej) == null ? void 0 : _b.get(e3)) ?? r2, this._$Em = null;
    }
  }
  requestUpdate(t3, s5, i5, e3 = false, h2) {
    var _a2;
    if (void 0 !== t3) {
      const r2 = this.constructor;
      if (false === e3 && (h2 = this[t3]), i5 ?? (i5 = r2.getPropertyOptions(t3)), !((i5.hasChanged ?? f$2)(h2, s5) || i5.useDefault && i5.reflect && h2 === ((_a2 = this._$Ej) == null ? void 0 : _a2.get(t3)) && !this.hasAttribute(r2._$Eu(t3, i5)))) return;
      this.C(t3, s5, i5);
    }
    false === this.isUpdatePending && (this._$ES = this._$EP());
  }
  C(t3, s5, { useDefault: i5, reflect: e3, wrapped: h2 }, r2) {
    i5 && !(this._$Ej ?? (this._$Ej = /* @__PURE__ */ new Map())).has(t3) && (this._$Ej.set(t3, r2 ?? s5 ?? this[t3]), true !== h2 || void 0 !== r2) || (this._$AL.has(t3) || (this.hasUpdated || i5 || (s5 = void 0), this._$AL.set(t3, s5)), true === e3 && this._$Em !== t3 && (this._$Eq ?? (this._$Eq = /* @__PURE__ */ new Set())).add(t3));
  }
  async _$EP() {
    this.isUpdatePending = true;
    try {
      await this._$ES;
    } catch (t4) {
      Promise.reject(t4);
    }
    const t3 = this.scheduleUpdate();
    return null != t3 && await t3, !this.isUpdatePending;
  }
  scheduleUpdate() {
    return this.performUpdate();
  }
  performUpdate() {
    var _a2;
    if (!this.isUpdatePending) return;
    if (!this.hasUpdated) {
      if (this.renderRoot ?? (this.renderRoot = this.createRenderRoot()), this._$Ep) {
        for (const [t5, s6] of this._$Ep) this[t5] = s6;
        this._$Ep = void 0;
      }
      const t4 = this.constructor.elementProperties;
      if (t4.size > 0) for (const [s6, i5] of t4) {
        const { wrapped: t5 } = i5, e3 = this[s6];
        true !== t5 || this._$AL.has(s6) || void 0 === e3 || this.C(s6, void 0, i5, e3);
      }
    }
    let t3 = false;
    const s5 = this._$AL;
    try {
      t3 = this.shouldUpdate(s5), t3 ? (this.willUpdate(s5), (_a2 = this._$EO) == null ? void 0 : _a2.forEach((t4) => {
        var _a3;
        return (_a3 = t4.hostUpdate) == null ? void 0 : _a3.call(t4);
      }), this.update(s5)) : this._$EM();
    } catch (s6) {
      throw t3 = false, this._$EM(), s6;
    }
    t3 && this._$AE(s5);
  }
  willUpdate(t3) {
  }
  _$AE(t3) {
    var _a2;
    (_a2 = this._$EO) == null ? void 0 : _a2.forEach((t4) => {
      var _a3;
      return (_a3 = t4.hostUpdated) == null ? void 0 : _a3.call(t4);
    }), this.hasUpdated || (this.hasUpdated = true, this.firstUpdated(t3)), this.updated(t3);
  }
  _$EM() {
    this._$AL = /* @__PURE__ */ new Map(), this.isUpdatePending = false;
  }
  get updateComplete() {
    return this.getUpdateComplete();
  }
  getUpdateComplete() {
    return this._$ES;
  }
  shouldUpdate(t3) {
    return true;
  }
  update(t3) {
    this._$Eq && (this._$Eq = this._$Eq.forEach((t4) => this._$ET(t4, this[t4]))), this._$EM();
  }
  updated(t3) {
  }
  firstUpdated(t3) {
  }
};
y$1.elementStyles = [], y$1.shadowRootOptions = { mode: "open" }, y$1[d$1("elementProperties")] = /* @__PURE__ */ new Map(), y$1[d$1("finalized")] = /* @__PURE__ */ new Map(), p$1 == null ? void 0 : p$1({ ReactiveElement: y$1 }), (a$1.reactiveElementVersions ?? (a$1.reactiveElementVersions = [])).push("2.1.2");
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const t$4 = globalThis, i$4 = (t3) => t3, s$5 = t$4.trustedTypes, e$6 = s$5 ? s$5.createPolicy("lit-html", { createHTML: (t3) => t3 }) : void 0, h$1 = "$lit$", o$6 = `lit$${Math.random().toFixed(9).slice(2)}$`, n$5 = "?" + o$6, r$4 = `<${n$5}>`, l = document, c$2 = () => l.createComment(""), a = (t3) => null === t3 || "object" != typeof t3 && "function" != typeof t3, u = Array.isArray, d = (t3) => u(t3) || "function" == typeof (t3 == null ? void 0 : t3[Symbol.iterator]), f$1 = "[ 	\n\f\r]", v = /<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g, _ = /-->/g, m = />/g, p = RegExp(`>|${f$1}(?:([^\\s"'>=/]+)(${f$1}*=${f$1}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`, "g"), g = /'/g, $ = /"/g, y2 = /^(?:script|style|textarea|title)$/i, x = (t3) => (i5, ...s5) => ({ _$litType$: t3, strings: i5, values: s5 }), b = x(1), w = x(2), E = Symbol.for("lit-noChange"), A = Symbol.for("lit-nothing"), C = /* @__PURE__ */ new WeakMap(), P = l.createTreeWalker(l, 129);
function V(t3, i5) {
  if (!u(t3) || !t3.hasOwnProperty("raw")) throw Error("invalid template strings array");
  return void 0 !== e$6 ? e$6.createHTML(i5) : i5;
}
const N = (t3, i5) => {
  const s5 = t3.length - 1, e3 = [];
  let n3, l2 = 2 === i5 ? "<svg>" : 3 === i5 ? "<math>" : "", c2 = v;
  for (let i6 = 0; i6 < s5; i6++) {
    const s6 = t3[i6];
    let a2, u2, d2 = -1, f2 = 0;
    for (; f2 < s6.length && (c2.lastIndex = f2, u2 = c2.exec(s6), null !== u2); ) f2 = c2.lastIndex, c2 === v ? "!--" === u2[1] ? c2 = _ : void 0 !== u2[1] ? c2 = m : void 0 !== u2[2] ? (y2.test(u2[2]) && (n3 = RegExp("</" + u2[2], "g")), c2 = p) : void 0 !== u2[3] && (c2 = p) : c2 === p ? ">" === u2[0] ? (c2 = n3 ?? v, d2 = -1) : void 0 === u2[1] ? d2 = -2 : (d2 = c2.lastIndex - u2[2].length, a2 = u2[1], c2 = void 0 === u2[3] ? p : '"' === u2[3] ? $ : g) : c2 === $ || c2 === g ? c2 = p : c2 === _ || c2 === m ? c2 = v : (c2 = p, n3 = void 0);
    const x2 = c2 === p && t3[i6 + 1].startsWith("/>") ? " " : "";
    l2 += c2 === v ? s6 + r$4 : d2 >= 0 ? (e3.push(a2), s6.slice(0, d2) + h$1 + s6.slice(d2) + o$6 + x2) : s6 + o$6 + (-2 === d2 ? i6 : x2);
  }
  return [V(t3, l2 + (t3[s5] || "<?>") + (2 === i5 ? "</svg>" : 3 === i5 ? "</math>" : "")), e3];
};
class S {
  constructor({ strings: t3, _$litType$: i5 }, e3) {
    let r2;
    this.parts = [];
    let l2 = 0, a2 = 0;
    const u2 = t3.length - 1, d2 = this.parts, [f2, v2] = N(t3, i5);
    if (this.el = S.createElement(f2, e3), P.currentNode = this.el.content, 2 === i5 || 3 === i5) {
      const t4 = this.el.content.firstChild;
      t4.replaceWith(...t4.childNodes);
    }
    for (; null !== (r2 = P.nextNode()) && d2.length < u2; ) {
      if (1 === r2.nodeType) {
        if (r2.hasAttributes()) for (const t4 of r2.getAttributeNames()) if (t4.endsWith(h$1)) {
          const i6 = v2[a2++], s5 = r2.getAttribute(t4).split(o$6), e4 = /([.?@])?(.*)/.exec(i6);
          d2.push({ type: 1, index: l2, name: e4[2], strings: s5, ctor: "." === e4[1] ? I : "?" === e4[1] ? L : "@" === e4[1] ? z : H }), r2.removeAttribute(t4);
        } else t4.startsWith(o$6) && (d2.push({ type: 6, index: l2 }), r2.removeAttribute(t4));
        if (y2.test(r2.tagName)) {
          const t4 = r2.textContent.split(o$6), i6 = t4.length - 1;
          if (i6 > 0) {
            r2.textContent = s$5 ? s$5.emptyScript : "";
            for (let s5 = 0; s5 < i6; s5++) r2.append(t4[s5], c$2()), P.nextNode(), d2.push({ type: 2, index: ++l2 });
            r2.append(t4[i6], c$2());
          }
        }
      } else if (8 === r2.nodeType) if (r2.data === n$5) d2.push({ type: 2, index: l2 });
      else {
        let t4 = -1;
        for (; -1 !== (t4 = r2.data.indexOf(o$6, t4 + 1)); ) d2.push({ type: 7, index: l2 }), t4 += o$6.length - 1;
      }
      l2++;
    }
  }
  static createElement(t3, i5) {
    const s5 = l.createElement("template");
    return s5.innerHTML = t3, s5;
  }
}
function M(t3, i5, s5 = t3, e3) {
  var _a2, _b;
  if (i5 === E) return i5;
  let h2 = void 0 !== e3 ? (_a2 = s5._$Co) == null ? void 0 : _a2[e3] : s5._$Cl;
  const o2 = a(i5) ? void 0 : i5._$litDirective$;
  return (h2 == null ? void 0 : h2.constructor) !== o2 && ((_b = h2 == null ? void 0 : h2._$AO) == null ? void 0 : _b.call(h2, false), void 0 === o2 ? h2 = void 0 : (h2 = new o2(t3), h2._$AT(t3, s5, e3)), void 0 !== e3 ? (s5._$Co ?? (s5._$Co = []))[e3] = h2 : s5._$Cl = h2), void 0 !== h2 && (i5 = M(t3, h2._$AS(t3, i5.values), h2, e3)), i5;
}
class R {
  constructor(t3, i5) {
    this._$AV = [], this._$AN = void 0, this._$AD = t3, this._$AM = i5;
  }
  get parentNode() {
    return this._$AM.parentNode;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  u(t3) {
    const { el: { content: i5 }, parts: s5 } = this._$AD, e3 = ((t3 == null ? void 0 : t3.creationScope) ?? l).importNode(i5, true);
    P.currentNode = e3;
    let h2 = P.nextNode(), o2 = 0, n3 = 0, r2 = s5[0];
    for (; void 0 !== r2; ) {
      if (o2 === r2.index) {
        let i6;
        2 === r2.type ? i6 = new k(h2, h2.nextSibling, this, t3) : 1 === r2.type ? i6 = new r2.ctor(h2, r2.name, r2.strings, this, t3) : 6 === r2.type && (i6 = new Z(h2, this, t3)), this._$AV.push(i6), r2 = s5[++n3];
      }
      o2 !== (r2 == null ? void 0 : r2.index) && (h2 = P.nextNode(), o2++);
    }
    return P.currentNode = l, e3;
  }
  p(t3) {
    let i5 = 0;
    for (const s5 of this._$AV) void 0 !== s5 && (void 0 !== s5.strings ? (s5._$AI(t3, s5, i5), i5 += s5.strings.length - 2) : s5._$AI(t3[i5])), i5++;
  }
}
class k {
  get _$AU() {
    var _a2;
    return ((_a2 = this._$AM) == null ? void 0 : _a2._$AU) ?? this._$Cv;
  }
  constructor(t3, i5, s5, e3) {
    this.type = 2, this._$AH = A, this._$AN = void 0, this._$AA = t3, this._$AB = i5, this._$AM = s5, this.options = e3, this._$Cv = (e3 == null ? void 0 : e3.isConnected) ?? true;
  }
  get parentNode() {
    let t3 = this._$AA.parentNode;
    const i5 = this._$AM;
    return void 0 !== i5 && 11 === (t3 == null ? void 0 : t3.nodeType) && (t3 = i5.parentNode), t3;
  }
  get startNode() {
    return this._$AA;
  }
  get endNode() {
    return this._$AB;
  }
  _$AI(t3, i5 = this) {
    t3 = M(this, t3, i5), a(t3) ? t3 === A || null == t3 || "" === t3 ? (this._$AH !== A && this._$AR(), this._$AH = A) : t3 !== this._$AH && t3 !== E && this._(t3) : void 0 !== t3._$litType$ ? this.$(t3) : void 0 !== t3.nodeType ? this.T(t3) : d(t3) ? this.k(t3) : this._(t3);
  }
  O(t3) {
    return this._$AA.parentNode.insertBefore(t3, this._$AB);
  }
  T(t3) {
    this._$AH !== t3 && (this._$AR(), this._$AH = this.O(t3));
  }
  _(t3) {
    this._$AH !== A && a(this._$AH) ? this._$AA.nextSibling.data = t3 : this.T(l.createTextNode(t3)), this._$AH = t3;
  }
  $(t3) {
    var _a2;
    const { values: i5, _$litType$: s5 } = t3, e3 = "number" == typeof s5 ? this._$AC(t3) : (void 0 === s5.el && (s5.el = S.createElement(V(s5.h, s5.h[0]), this.options)), s5);
    if (((_a2 = this._$AH) == null ? void 0 : _a2._$AD) === e3) this._$AH.p(i5);
    else {
      const t4 = new R(e3, this), s6 = t4.u(this.options);
      t4.p(i5), this.T(s6), this._$AH = t4;
    }
  }
  _$AC(t3) {
    let i5 = C.get(t3.strings);
    return void 0 === i5 && C.set(t3.strings, i5 = new S(t3)), i5;
  }
  k(t3) {
    u(this._$AH) || (this._$AH = [], this._$AR());
    const i5 = this._$AH;
    let s5, e3 = 0;
    for (const h2 of t3) e3 === i5.length ? i5.push(s5 = new k(this.O(c$2()), this.O(c$2()), this, this.options)) : s5 = i5[e3], s5._$AI(h2), e3++;
    e3 < i5.length && (this._$AR(s5 && s5._$AB.nextSibling, e3), i5.length = e3);
  }
  _$AR(t3 = this._$AA.nextSibling, s5) {
    var _a2;
    for ((_a2 = this._$AP) == null ? void 0 : _a2.call(this, false, true, s5); t3 !== this._$AB; ) {
      const s6 = i$4(t3).nextSibling;
      i$4(t3).remove(), t3 = s6;
    }
  }
  setConnected(t3) {
    var _a2;
    void 0 === this._$AM && (this._$Cv = t3, (_a2 = this._$AP) == null ? void 0 : _a2.call(this, t3));
  }
}
class H {
  get tagName() {
    return this.element.tagName;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  constructor(t3, i5, s5, e3, h2) {
    this.type = 1, this._$AH = A, this._$AN = void 0, this.element = t3, this.name = i5, this._$AM = e3, this.options = h2, s5.length > 2 || "" !== s5[0] || "" !== s5[1] ? (this._$AH = Array(s5.length - 1).fill(new String()), this.strings = s5) : this._$AH = A;
  }
  _$AI(t3, i5 = this, s5, e3) {
    const h2 = this.strings;
    let o2 = false;
    if (void 0 === h2) t3 = M(this, t3, i5, 0), o2 = !a(t3) || t3 !== this._$AH && t3 !== E, o2 && (this._$AH = t3);
    else {
      const e4 = t3;
      let n3, r2;
      for (t3 = h2[0], n3 = 0; n3 < h2.length - 1; n3++) r2 = M(this, e4[s5 + n3], i5, n3), r2 === E && (r2 = this._$AH[n3]), o2 || (o2 = !a(r2) || r2 !== this._$AH[n3]), r2 === A ? t3 = A : t3 !== A && (t3 += (r2 ?? "") + h2[n3 + 1]), this._$AH[n3] = r2;
    }
    o2 && !e3 && this.j(t3);
  }
  j(t3) {
    t3 === A ? this.element.removeAttribute(this.name) : this.element.setAttribute(this.name, t3 ?? "");
  }
}
class I extends H {
  constructor() {
    super(...arguments), this.type = 3;
  }
  j(t3) {
    this.element[this.name] = t3 === A ? void 0 : t3;
  }
}
class L extends H {
  constructor() {
    super(...arguments), this.type = 4;
  }
  j(t3) {
    this.element.toggleAttribute(this.name, !!t3 && t3 !== A);
  }
}
class z extends H {
  constructor(t3, i5, s5, e3, h2) {
    super(t3, i5, s5, e3, h2), this.type = 5;
  }
  _$AI(t3, i5 = this) {
    if ((t3 = M(this, t3, i5, 0) ?? A) === E) return;
    const s5 = this._$AH, e3 = t3 === A && s5 !== A || t3.capture !== s5.capture || t3.once !== s5.once || t3.passive !== s5.passive, h2 = t3 !== A && (s5 === A || e3);
    e3 && this.element.removeEventListener(this.name, this, s5), h2 && this.element.addEventListener(this.name, this, t3), this._$AH = t3;
  }
  handleEvent(t3) {
    var _a2;
    "function" == typeof this._$AH ? this._$AH.call(((_a2 = this.options) == null ? void 0 : _a2.host) ?? this.element, t3) : this._$AH.handleEvent(t3);
  }
}
class Z {
  constructor(t3, i5, s5) {
    this.element = t3, this.type = 6, this._$AN = void 0, this._$AM = i5, this.options = s5;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  _$AI(t3) {
    M(this, t3);
  }
}
const B = t$4.litHtmlPolyfillSupport;
B == null ? void 0 : B(S, k), (t$4.litHtmlVersions ?? (t$4.litHtmlVersions = [])).push("3.3.3");
const D = (t3, i5, s5) => {
  const e3 = (s5 == null ? void 0 : s5.renderBefore) ?? i5;
  let h2 = e3._$litPart$;
  if (void 0 === h2) {
    const t4 = (s5 == null ? void 0 : s5.renderBefore) ?? null;
    e3._$litPart$ = h2 = new k(i5.insertBefore(c$2(), t4), t4, void 0, s5 ?? {});
  }
  return h2._$AI(t3), h2;
};
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const s$4 = globalThis;
let i$3 = class i extends y$1 {
  constructor() {
    super(...arguments), this.renderOptions = { host: this }, this._$Do = void 0;
  }
  createRenderRoot() {
    var _a2;
    const t3 = super.createRenderRoot();
    return (_a2 = this.renderOptions).renderBefore ?? (_a2.renderBefore = t3.firstChild), t3;
  }
  update(t3) {
    const r2 = this.render();
    this.hasUpdated || (this.renderOptions.isConnected = this.isConnected), super.update(t3), this._$Do = D(r2, this.renderRoot, this.renderOptions);
  }
  connectedCallback() {
    var _a2;
    super.connectedCallback(), (_a2 = this._$Do) == null ? void 0 : _a2.setConnected(true);
  }
  disconnectedCallback() {
    var _a2;
    super.disconnectedCallback(), (_a2 = this._$Do) == null ? void 0 : _a2.setConnected(false);
  }
  render() {
    return E;
  }
};
i$3._$litElement$ = true, i$3["finalized"] = true, (_a = s$4.litElementHydrateSupport) == null ? void 0 : _a.call(s$4, { LitElement: i$3 });
const o$5 = s$4.litElementPolyfillSupport;
o$5 == null ? void 0 : o$5({ LitElement: i$3 });
(s$4.litElementVersions ?? (s$4.litElementVersions = [])).push("4.2.2");
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const t$3 = (t3) => (e3, o2) => {
  void 0 !== o2 ? o2.addInitializer(() => {
    customElements.define(t3, e3);
  }) : customElements.define(t3, e3);
};
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const o$4 = { attribute: true, type: String, converter: u$1, reflect: false, hasChanged: f$2 }, r$3 = (t3 = o$4, e3, r2) => {
  const { kind: n3, metadata: i5 } = r2;
  let s5 = globalThis.litPropertyMetadata.get(i5);
  if (void 0 === s5 && globalThis.litPropertyMetadata.set(i5, s5 = /* @__PURE__ */ new Map()), "setter" === n3 && ((t3 = Object.create(t3)).wrapped = true), s5.set(r2.name, t3), "accessor" === n3) {
    const { name: o2 } = r2;
    return { set(r3) {
      const n4 = e3.get.call(this);
      e3.set.call(this, r3), this.requestUpdate(o2, n4, t3, true, r3);
    }, init(e4) {
      return void 0 !== e4 && this.C(o2, void 0, t3, e4), e4;
    } };
  }
  if ("setter" === n3) {
    const { name: o2 } = r2;
    return function(r3) {
      const n4 = this[o2];
      e3.call(this, r3), this.requestUpdate(o2, n4, t3, true, r3);
    };
  }
  throw Error("Unsupported decorator location: " + n3);
};
function n$4(t3) {
  return (e3, o2) => "object" == typeof o2 ? r$3(t3, e3, o2) : ((t4, e4, o3) => {
    const r2 = e4.hasOwnProperty(o3);
    return e4.constructor.createProperty(o3, t4), r2 ? Object.getOwnPropertyDescriptor(e4, o3) : void 0;
  })(t3, e3, o2);
}
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
function r$2(r2) {
  return n$4({ ...r2, state: true, attribute: false });
}
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const e$5 = (e3, t3, c2) => (c2.configurable = true, c2.enumerable = true, Reflect.decorate && "object" != typeof t3 && Object.defineProperty(e3, t3, c2), c2);
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
function e$4(e3, r2) {
  return (n3, s5, i5) => {
    const o2 = (t3) => {
      var _a2;
      return ((_a2 = t3.renderRoot) == null ? void 0 : _a2.querySelector(e3)) ?? null;
    };
    return e$5(n3, s5, { get() {
      return o2(this);
    } });
  };
}
/**
 * @license
 * Copyright 2021 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
let s$3 = class s extends Event {
  constructor(s5, t3, e3, o2) {
    super("context-request", { bubbles: true, composed: true }), this.context = s5, this.contextTarget = t3, this.callback = e3, this.subscribe = o2 ?? false;
  }
};
/**
 * @license
 * Copyright 2021 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
function n$3(n3) {
  return n3;
}
/**
 * @license
 * Copyright 2021 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
let s$2 = class s2 {
  constructor(t3, s5, i5, h2) {
    if (this.subscribe = false, this.provided = false, this.value = void 0, this.t = (t4, s6) => {
      this.unsubscribe && (this.unsubscribe !== s6 && (this.provided = false, this.unsubscribe()), this.subscribe || this.unsubscribe()), this.value = t4, this.host.requestUpdate(), this.provided && !this.subscribe || (this.provided = true, this.callback && this.callback(t4, s6)), this.unsubscribe = s6;
    }, this.host = t3, void 0 !== s5.context) {
      const t4 = s5;
      this.context = t4.context, this.callback = t4.callback, this.subscribe = t4.subscribe ?? false;
    } else this.context = s5, this.callback = i5, this.subscribe = h2 ?? false;
    this.host.addController(this);
  }
  hostConnected() {
    this.dispatchRequest();
  }
  hostDisconnected() {
    this.unsubscribe && (this.unsubscribe(), this.unsubscribe = void 0);
  }
  dispatchRequest() {
    this.host.dispatchEvent(new s$3(this.context, this.host, this.t, this.subscribe));
  }
};
/**
 * @license
 * Copyright 2021 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
let s$1 = class s3 {
  get value() {
    return this.o;
  }
  set value(s5) {
    this.setValue(s5);
  }
  setValue(s5, t3 = false) {
    const i5 = t3 || !Object.is(s5, this.o);
    this.o = s5, i5 && this.updateObservers();
  }
  constructor(s5) {
    this.subscriptions = /* @__PURE__ */ new Map(), this.updateObservers = () => {
      for (const [s6, { disposer: t3 }] of this.subscriptions) s6(this.o, t3);
    }, void 0 !== s5 && (this.value = s5);
  }
  addCallback(s5, t3, i5) {
    if (!i5) return void s5(this.value);
    this.subscriptions.has(s5) || this.subscriptions.set(s5, { disposer: () => {
      this.subscriptions.delete(s5);
    }, consumerHost: t3 });
    const { disposer: h2 } = this.subscriptions.get(s5);
    s5(this.value, h2);
  }
  clearCallbacks() {
    this.subscriptions.clear();
  }
};
/**
 * @license
 * Copyright 2021 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
let e$3 = class e extends Event {
  constructor(t3, s5) {
    super("context-provider", { bubbles: true, composed: true }), this.context = t3, this.contextTarget = s5;
  }
};
let i$2 = class i2 extends s$1 {
  constructor(s5, e3, i5) {
    var _a2, _b;
    super(void 0 !== e3.context ? e3.initialValue : i5), this.onContextRequest = (t3) => {
      if (t3.context !== this.context) return;
      const s6 = t3.contextTarget ?? t3.composedPath()[0];
      s6 !== this.host && (t3.stopPropagation(), this.addCallback(t3.callback, s6, t3.subscribe));
    }, this.onProviderRequest = (s6) => {
      if (s6.context !== this.context) return;
      if ((s6.contextTarget ?? s6.composedPath()[0]) === this.host) return;
      const e4 = /* @__PURE__ */ new Set();
      for (const [s7, { consumerHost: i6 }] of this.subscriptions) e4.has(s7) || (e4.add(s7), i6.dispatchEvent(new s$3(this.context, i6, s7, true)));
      s6.stopPropagation();
    }, this.host = s5, void 0 !== e3.context ? this.context = e3.context : this.context = e3, this.attachListeners(), (_b = (_a2 = this.host).addController) == null ? void 0 : _b.call(_a2, this);
  }
  attachListeners() {
    this.host.addEventListener("context-request", this.onContextRequest), this.host.addEventListener("context-provider", this.onProviderRequest);
  }
  hostConnected() {
    this.host.dispatchEvent(new e$3(this.context, this.host));
  }
};
/**
 * @license
 * Copyright 2021 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
let t$2 = class t {
  constructor() {
    this.pendingContextRequests = /* @__PURE__ */ new Map(), this.onContextProvider = (t3) => {
      const s5 = this.pendingContextRequests.get(t3.context);
      if (void 0 === s5) return;
      this.pendingContextRequests.delete(t3.context);
      const { requests: o2 } = s5;
      for (const { elementRef: s6, callbackRef: n3 } of o2) {
        const o3 = s6.deref(), c2 = n3.deref();
        void 0 === o3 || void 0 === c2 || o3.dispatchEvent(new s$3(t3.context, o3, c2, true));
      }
    }, this.onContextRequest = (e3) => {
      if (true !== e3.subscribe) return;
      const t3 = e3.contextTarget ?? e3.composedPath()[0], s5 = e3.callback;
      let o2 = this.pendingContextRequests.get(e3.context);
      void 0 === o2 && this.pendingContextRequests.set(e3.context, o2 = { callbacks: /* @__PURE__ */ new WeakMap(), requests: [] });
      let n3 = o2.callbacks.get(t3);
      void 0 === n3 && o2.callbacks.set(t3, n3 = /* @__PURE__ */ new WeakSet()), n3.has(s5) || (n3.add(s5), o2.requests.push({ elementRef: new WeakRef(t3), callbackRef: new WeakRef(s5) }));
    };
  }
  attach(e3) {
    e3.addEventListener("context-request", this.onContextRequest), e3.addEventListener("context-provider", this.onContextProvider);
  }
  detach(e3) {
    e3.removeEventListener("context-request", this.onContextRequest), e3.removeEventListener("context-provider", this.onContextProvider);
  }
};
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
function e$2({ context: e3 }) {
  return (n3, i5) => {
    const r2 = /* @__PURE__ */ new WeakMap();
    if ("object" == typeof i5) return { get() {
      return n3.get.call(this);
    }, set(t3) {
      return r2.get(this).setValue(t3), n3.set.call(this, t3);
    }, init(n4) {
      return r2.set(this, new i$2(this, { context: e3, initialValue: n4 })), n4;
    } };
    {
      n3.constructor.addInitializer(((n4) => {
        r2.set(n4, new i$2(n4, { context: e3 }));
      }));
      const o2 = Object.getOwnPropertyDescriptor(n3, i5);
      let s5;
      if (void 0 === o2) {
        const t3 = /* @__PURE__ */ new WeakMap();
        s5 = { get() {
          return t3.get(this);
        }, set(e4) {
          r2.get(this).setValue(e4), t3.set(this, e4);
        }, configurable: true, enumerable: true };
      } else {
        const t3 = o2.set;
        s5 = { ...o2, set(e4) {
          r2.get(this).setValue(e4), t3 == null ? void 0 : t3.call(this, e4);
        } };
      }
      return void Object.defineProperty(n3, i5, s5);
    }
  };
}
/**
 * @license
 * Copyright 2022 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
function c$1({ context: c2, subscribe: e3 }) {
  return (o2, n3) => {
    "object" == typeof n3 ? n3.addInitializer((function() {
      new s$2(this, { context: c2, callback: (t3) => {
        o2.set.call(this, t3);
      }, subscribe: e3 });
    })) : o2.constructor.addInitializer(((o3) => {
      new s$2(o3, { context: c2, callback: (t3) => {
        o3[n3] = t3;
      }, subscribe: e3 });
    }));
  };
}
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const t$1 = { ATTRIBUTE: 1, CHILD: 2, ELEMENT: 6 }, e$1 = (t3) => (...e3) => ({ _$litDirective$: t3, values: e3 });
let i$1 = class i3 {
  constructor(t3) {
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  _$AT(t3, e3, i5) {
    this._$Ct = t3, this._$AM = e3, this._$Ci = i5;
  }
  _$AS(t3, e3) {
    return this.update(t3, e3);
  }
  update(t3, e3) {
    return this.render(...e3);
  }
};
/**
 * @license
 * Copyright 2018 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const n$2 = "important", i4 = " !" + n$2, o$3 = e$1(class extends i$1 {
  constructor(t3) {
    var _a2;
    if (super(t3), t3.type !== t$1.ATTRIBUTE || "style" !== t3.name || ((_a2 = t3.strings) == null ? void 0 : _a2.length) > 2) throw Error("The `styleMap` directive must be used in the `style` attribute and must be the only part in the attribute.");
  }
  render(t3) {
    return Object.keys(t3).reduce((e3, r2) => {
      const s5 = t3[r2];
      return null == s5 ? e3 : e3 + `${r2 = r2.includes("-") ? r2 : r2.replace(/(?:^(webkit|moz|ms|o)|)(?=[A-Z])/g, "-$&").toLowerCase()}:${s5};`;
    }, "");
  }
  update(e3, [r2]) {
    const { style: s5 } = e3.element;
    if (void 0 === this.ft) return this.ft = new Set(Object.keys(r2)), this.render(r2);
    for (const t3 of this.ft) null == r2[t3] && (this.ft.delete(t3), t3.includes("-") ? s5.removeProperty(t3) : s5[t3] = null);
    for (const t3 in r2) {
      const e4 = r2[t3];
      if (null != e4) {
        this.ft.add(t3);
        const r3 = "string" == typeof e4 && e4.endsWith(i4);
        t3.includes("-") || r3 ? s5.setProperty(t3, r3 ? e4.slice(0, -11) : e4, r3 ? n$2 : "") : s5[t3] = e4;
      }
    }
    return E;
  }
});
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
class e2 extends i$1 {
  constructor(i5) {
    if (super(i5), this.it = A, i5.type !== t$1.CHILD) throw Error(this.constructor.directiveName + "() can only be used in child bindings");
  }
  render(r2) {
    if (r2 === A || null == r2) return this._t = void 0, this.it = r2;
    if (r2 === E) return r2;
    if ("string" != typeof r2) throw Error(this.constructor.directiveName + "() called with a non-string value");
    if (r2 === this.it) return this._t;
    this.it = r2;
    const s5 = [r2];
    return s5.raw = s5, this._t = { _$litType$: this.constructor.resultType, strings: s5, values: [] };
  }
}
e2.directiveName = "unsafeHTML", e2.resultType = 1;
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
class t2 extends e2 {
}
t2.directiveName = "unsafeSVG", t2.resultType = 2;
const o$2 = e$1(t2);
/**
 * @license
 * Copyright 2020 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const r$1 = (o2) => void 0 === o2.strings;
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const s4 = (i5, t3) => {
  var _a2;
  const e3 = i5._$AN;
  if (void 0 === e3) return false;
  for (const i6 of e3) (_a2 = i6._$AO) == null ? void 0 : _a2.call(i6, t3, false), s4(i6, t3);
  return true;
}, o$1 = (i5) => {
  let t3, e3;
  do {
    if (void 0 === (t3 = i5._$AM)) break;
    e3 = t3._$AN, e3.delete(i5), i5 = t3;
  } while (0 === (e3 == null ? void 0 : e3.size));
}, r = (i5) => {
  for (let t3; t3 = i5._$AM; i5 = t3) {
    let e3 = t3._$AN;
    if (void 0 === e3) t3._$AN = e3 = /* @__PURE__ */ new Set();
    else if (e3.has(i5)) break;
    e3.add(i5), c(t3);
  }
};
function h(i5) {
  void 0 !== this._$AN ? (o$1(this), this._$AM = i5, r(this)) : this._$AM = i5;
}
function n$1(i5, t3 = false, e3 = 0) {
  const r2 = this._$AH, h2 = this._$AN;
  if (void 0 !== h2 && 0 !== h2.size) if (t3) if (Array.isArray(r2)) for (let i6 = e3; i6 < r2.length; i6++) s4(r2[i6], false), o$1(r2[i6]);
  else null != r2 && (s4(r2, false), o$1(r2));
  else s4(this, i5);
}
const c = (i5) => {
  i5.type == t$1.CHILD && (i5._$AP ?? (i5._$AP = n$1), i5._$AQ ?? (i5._$AQ = h));
};
class f extends i$1 {
  constructor() {
    super(...arguments), this._$AN = void 0;
  }
  _$AT(i5, t3, e3) {
    super._$AT(i5, t3, e3), r(this), this.isConnected = i5._$AU;
  }
  _$AO(i5, t3 = true) {
    var _a2, _b;
    i5 !== this.isConnected && (this.isConnected = i5, i5 ? (_a2 = this.reconnected) == null ? void 0 : _a2.call(this) : (_b = this.disconnected) == null ? void 0 : _b.call(this)), t3 && (s4(this, i5), o$1(this));
  }
  setValue(t3) {
    if (r$1(this._$Ct)) this._$Ct._$AI(t3, this);
    else {
      const i5 = [...this._$Ct._$AH];
      i5[this._$Ci] = t3, this._$Ct._$AI(i5, this, 0);
    }
  }
  disconnected() {
  }
  reconnected() {
  }
}
const o = /* @__PURE__ */ new WeakMap(), n2 = e$1(class extends f {
  render(i5) {
    return A;
  }
  update(i5, [s5]) {
    var _a2;
    const e3 = s5 !== this.G;
    return e3 && this.rt(void 0), (e3 || this.lt !== this.ct) && (this.G = s5, this.ht = (_a2 = i5.options) == null ? void 0 : _a2.host, this.rt(this.ct = i5.element)), A;
  }
  rt(t3) {
    if (void 0 !== this.G) if (this.isConnected || (t3 = void 0), "function" == typeof this.G) {
      const i5 = this.ht ?? globalThis;
      let s5 = o.get(i5);
      void 0 === s5 && (s5 = /* @__PURE__ */ new WeakMap(), o.set(i5, s5)), void 0 !== s5.get(this.G) && this.G.call(this.ht, void 0), s5.set(this.G, t3), void 0 !== t3 && this.G.call(this.ht, t3);
    } else this.G.value = t3;
  }
  get lt() {
    var _a2, _b;
    return "function" == typeof this.G ? (_a2 = o.get(this.ht ?? globalThis)) == null ? void 0 : _a2.get(this.G) : (_b = this.G) == null ? void 0 : _b.value;
  }
  disconnected() {
    this.lt === this.ct && this.rt(void 0);
  }
  reconnected() {
    this.rt(this.ct);
  }
});
export {
  A,
  E,
  i$6 as a,
  b,
  n$4 as c,
  c$1 as d,
  e$4 as e,
  t$2 as f,
  e$2 as g,
  o$2 as h,
  i$3 as i,
  n2 as j,
  e$1 as k,
  i$1 as l,
  t$1 as m,
  n$3 as n,
  o$3 as o,
  r$2 as r,
  t$3 as t,
  w
};
//# sourceMappingURL=lit.js.map
