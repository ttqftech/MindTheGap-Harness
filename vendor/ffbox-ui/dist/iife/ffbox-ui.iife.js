var FFBoxUI = (function(exports) {
  "use strict";
  /**
   * @license
   * Copyright 2019 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   */
  var _a;
  const t$5 = globalThis, e$8 = t$5.ShadowRoot && (void 0 === t$5.ShadyCSS || t$5.ShadyCSS.nativeShadow) && "adoptedStyleSheets" in Document.prototype && "replace" in CSSStyleSheet.prototype, s$6 = Symbol(), o$8 = /* @__PURE__ */ new WeakMap();
  let n$7 = class n {
    constructor(t2, e2, o2) {
      if (this._$cssResult$ = true, o2 !== s$6) throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");
      this.cssText = t2, this.t = e2;
    }
    get styleSheet() {
      let t2 = this.o;
      const s2 = this.t;
      if (e$8 && void 0 === t2) {
        const e2 = void 0 !== s2 && 1 === s2.length;
        e2 && (t2 = o$8.get(s2)), void 0 === t2 && ((this.o = t2 = new CSSStyleSheet()).replaceSync(this.cssText), e2 && o$8.set(s2, t2));
      }
      return t2;
    }
    toString() {
      return this.cssText;
    }
  };
  const r$6 = (t2) => new n$7("string" == typeof t2 ? t2 : t2 + "", void 0, s$6), i$6 = (t2, ...e2) => {
    const o2 = 1 === t2.length ? t2[0] : e2.reduce((e3, s2, o3) => e3 + ((t3) => {
      if (true === t3._$cssResult$) return t3.cssText;
      if ("number" == typeof t3) return t3;
      throw Error("Value passed to 'css' function must be a 'css' function result: " + t3 + ". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.");
    })(s2) + t2[o3 + 1], t2[0]);
    return new n$7(o2, t2, s$6);
  }, S$1 = (s2, o2) => {
    if (e$8) s2.adoptedStyleSheets = o2.map((t2) => t2 instanceof CSSStyleSheet ? t2 : t2.styleSheet);
    else for (const e2 of o2) {
      const o3 = document.createElement("style"), n2 = t$5.litNonce;
      void 0 !== n2 && o3.setAttribute("nonce", n2), o3.textContent = e2.cssText, s2.appendChild(o3);
    }
  }, c$4 = e$8 ? (t2) => t2 : (t2) => t2 instanceof CSSStyleSheet ? ((t3) => {
    let e2 = "";
    for (const s2 of t3.cssRules) e2 += s2.cssText;
    return r$6(e2);
  })(t2) : t2;
  /**
   * @license
   * Copyright 2017 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   */
  const { is: i$5, defineProperty: e$7, getOwnPropertyDescriptor: h$2, getOwnPropertyNames: r$5, getOwnPropertySymbols: o$7, getPrototypeOf: n$6 } = Object, a$1 = globalThis, c$3 = a$1.trustedTypes, l$1 = c$3 ? c$3.emptyScript : "", p$1 = a$1.reactiveElementPolyfillSupport, d$1 = (t2, s2) => t2, u$1 = { toAttribute(t2, s2) {
    switch (s2) {
      case Boolean:
        t2 = t2 ? l$1 : null;
        break;
      case Object:
      case Array:
        t2 = null == t2 ? t2 : JSON.stringify(t2);
    }
    return t2;
  }, fromAttribute(t2, s2) {
    let i2 = t2;
    switch (s2) {
      case Boolean:
        i2 = null !== t2;
        break;
      case Number:
        i2 = null === t2 ? null : Number(t2);
        break;
      case Object:
      case Array:
        try {
          i2 = JSON.parse(t2);
        } catch (t3) {
          i2 = null;
        }
    }
    return i2;
  } }, f$2 = (t2, s2) => !i$5(t2, s2), b$1 = { attribute: true, type: String, converter: u$1, reflect: false, useDefault: false, hasChanged: f$2 };
  Symbol.metadata ?? (Symbol.metadata = Symbol("metadata")), a$1.litPropertyMetadata ?? (a$1.litPropertyMetadata = /* @__PURE__ */ new WeakMap());
  let y$1 = class y extends HTMLElement {
    static addInitializer(t2) {
      this._$Ei(), (this.l ?? (this.l = [])).push(t2);
    }
    static get observedAttributes() {
      return this.finalize(), this._$Eh && [...this._$Eh.keys()];
    }
    static createProperty(t2, s2 = b$1) {
      if (s2.state && (s2.attribute = false), this._$Ei(), this.prototype.hasOwnProperty(t2) && ((s2 = Object.create(s2)).wrapped = true), this.elementProperties.set(t2, s2), !s2.noAccessor) {
        const i2 = Symbol(), h2 = this.getPropertyDescriptor(t2, i2, s2);
        void 0 !== h2 && e$7(this.prototype, t2, h2);
      }
    }
    static getPropertyDescriptor(t2, s2, i2) {
      const { get: e2, set: r2 } = h$2(this.prototype, t2) ?? { get() {
        return this[s2];
      }, set(t3) {
        this[s2] = t3;
      } };
      return { get: e2, set(s3) {
        const h2 = e2 == null ? void 0 : e2.call(this);
        r2 == null ? void 0 : r2.call(this, s3), this.requestUpdate(t2, h2, i2);
      }, configurable: true, enumerable: true };
    }
    static getPropertyOptions(t2) {
      return this.elementProperties.get(t2) ?? b$1;
    }
    static _$Ei() {
      if (this.hasOwnProperty(d$1("elementProperties"))) return;
      const t2 = n$6(this);
      t2.finalize(), void 0 !== t2.l && (this.l = [...t2.l]), this.elementProperties = new Map(t2.elementProperties);
    }
    static finalize() {
      if (this.hasOwnProperty(d$1("finalized"))) return;
      if (this.finalized = true, this._$Ei(), this.hasOwnProperty(d$1("properties"))) {
        const t3 = this.properties, s2 = [...r$5(t3), ...o$7(t3)];
        for (const i2 of s2) this.createProperty(i2, t3[i2]);
      }
      const t2 = this[Symbol.metadata];
      if (null !== t2) {
        const s2 = litPropertyMetadata.get(t2);
        if (void 0 !== s2) for (const [t3, i2] of s2) this.elementProperties.set(t3, i2);
      }
      this._$Eh = /* @__PURE__ */ new Map();
      for (const [t3, s2] of this.elementProperties) {
        const i2 = this._$Eu(t3, s2);
        void 0 !== i2 && this._$Eh.set(i2, t3);
      }
      this.elementStyles = this.finalizeStyles(this.styles);
    }
    static finalizeStyles(s2) {
      const i2 = [];
      if (Array.isArray(s2)) {
        const e2 = new Set(s2.flat(1 / 0).reverse());
        for (const s3 of e2) i2.unshift(c$4(s3));
      } else void 0 !== s2 && i2.push(c$4(s2));
      return i2;
    }
    static _$Eu(t2, s2) {
      const i2 = s2.attribute;
      return false === i2 ? void 0 : "string" == typeof i2 ? i2 : "string" == typeof t2 ? t2.toLowerCase() : void 0;
    }
    constructor() {
      super(), this._$Ep = void 0, this.isUpdatePending = false, this.hasUpdated = false, this._$Em = null, this._$Ev();
    }
    _$Ev() {
      var _a2;
      this._$ES = new Promise((t2) => this.enableUpdating = t2), this._$AL = /* @__PURE__ */ new Map(), this._$E_(), this.requestUpdate(), (_a2 = this.constructor.l) == null ? void 0 : _a2.forEach((t2) => t2(this));
    }
    addController(t2) {
      var _a2;
      (this._$EO ?? (this._$EO = /* @__PURE__ */ new Set())).add(t2), void 0 !== this.renderRoot && this.isConnected && ((_a2 = t2.hostConnected) == null ? void 0 : _a2.call(t2));
    }
    removeController(t2) {
      var _a2;
      (_a2 = this._$EO) == null ? void 0 : _a2.delete(t2);
    }
    _$E_() {
      const t2 = /* @__PURE__ */ new Map(), s2 = this.constructor.elementProperties;
      for (const i2 of s2.keys()) this.hasOwnProperty(i2) && (t2.set(i2, this[i2]), delete this[i2]);
      t2.size > 0 && (this._$Ep = t2);
    }
    createRenderRoot() {
      const t2 = this.shadowRoot ?? this.attachShadow(this.constructor.shadowRootOptions);
      return S$1(t2, this.constructor.elementStyles), t2;
    }
    connectedCallback() {
      var _a2;
      this.renderRoot ?? (this.renderRoot = this.createRenderRoot()), this.enableUpdating(true), (_a2 = this._$EO) == null ? void 0 : _a2.forEach((t2) => {
        var _a3;
        return (_a3 = t2.hostConnected) == null ? void 0 : _a3.call(t2);
      });
    }
    enableUpdating(t2) {
    }
    disconnectedCallback() {
      var _a2;
      (_a2 = this._$EO) == null ? void 0 : _a2.forEach((t2) => {
        var _a3;
        return (_a3 = t2.hostDisconnected) == null ? void 0 : _a3.call(t2);
      });
    }
    attributeChangedCallback(t2, s2, i2) {
      this._$AK(t2, i2);
    }
    _$ET(t2, s2) {
      var _a2;
      const i2 = this.constructor.elementProperties.get(t2), e2 = this.constructor._$Eu(t2, i2);
      if (void 0 !== e2 && true === i2.reflect) {
        const h2 = (void 0 !== ((_a2 = i2.converter) == null ? void 0 : _a2.toAttribute) ? i2.converter : u$1).toAttribute(s2, i2.type);
        this._$Em = t2, null == h2 ? this.removeAttribute(e2) : this.setAttribute(e2, h2), this._$Em = null;
      }
    }
    _$AK(t2, s2) {
      var _a2, _b;
      const i2 = this.constructor, e2 = i2._$Eh.get(t2);
      if (void 0 !== e2 && this._$Em !== e2) {
        const t3 = i2.getPropertyOptions(e2), h2 = "function" == typeof t3.converter ? { fromAttribute: t3.converter } : void 0 !== ((_a2 = t3.converter) == null ? void 0 : _a2.fromAttribute) ? t3.converter : u$1;
        this._$Em = e2;
        const r2 = h2.fromAttribute(s2, t3.type);
        this[e2] = r2 ?? ((_b = this._$Ej) == null ? void 0 : _b.get(e2)) ?? r2, this._$Em = null;
      }
    }
    requestUpdate(t2, s2, i2, e2 = false, h2) {
      var _a2;
      if (void 0 !== t2) {
        const r2 = this.constructor;
        if (false === e2 && (h2 = this[t2]), i2 ?? (i2 = r2.getPropertyOptions(t2)), !((i2.hasChanged ?? f$2)(h2, s2) || i2.useDefault && i2.reflect && h2 === ((_a2 = this._$Ej) == null ? void 0 : _a2.get(t2)) && !this.hasAttribute(r2._$Eu(t2, i2)))) return;
        this.C(t2, s2, i2);
      }
      false === this.isUpdatePending && (this._$ES = this._$EP());
    }
    C(t2, s2, { useDefault: i2, reflect: e2, wrapped: h2 }, r2) {
      i2 && !(this._$Ej ?? (this._$Ej = /* @__PURE__ */ new Map())).has(t2) && (this._$Ej.set(t2, r2 ?? s2 ?? this[t2]), true !== h2 || void 0 !== r2) || (this._$AL.has(t2) || (this.hasUpdated || i2 || (s2 = void 0), this._$AL.set(t2, s2)), true === e2 && this._$Em !== t2 && (this._$Eq ?? (this._$Eq = /* @__PURE__ */ new Set())).add(t2));
    }
    async _$EP() {
      this.isUpdatePending = true;
      try {
        await this._$ES;
      } catch (t3) {
        Promise.reject(t3);
      }
      const t2 = this.scheduleUpdate();
      return null != t2 && await t2, !this.isUpdatePending;
    }
    scheduleUpdate() {
      return this.performUpdate();
    }
    performUpdate() {
      var _a2;
      if (!this.isUpdatePending) return;
      if (!this.hasUpdated) {
        if (this.renderRoot ?? (this.renderRoot = this.createRenderRoot()), this._$Ep) {
          for (const [t4, s3] of this._$Ep) this[t4] = s3;
          this._$Ep = void 0;
        }
        const t3 = this.constructor.elementProperties;
        if (t3.size > 0) for (const [s3, i2] of t3) {
          const { wrapped: t4 } = i2, e2 = this[s3];
          true !== t4 || this._$AL.has(s3) || void 0 === e2 || this.C(s3, void 0, i2, e2);
        }
      }
      let t2 = false;
      const s2 = this._$AL;
      try {
        t2 = this.shouldUpdate(s2), t2 ? (this.willUpdate(s2), (_a2 = this._$EO) == null ? void 0 : _a2.forEach((t3) => {
          var _a3;
          return (_a3 = t3.hostUpdate) == null ? void 0 : _a3.call(t3);
        }), this.update(s2)) : this._$EM();
      } catch (s3) {
        throw t2 = false, this._$EM(), s3;
      }
      t2 && this._$AE(s2);
    }
    willUpdate(t2) {
    }
    _$AE(t2) {
      var _a2;
      (_a2 = this._$EO) == null ? void 0 : _a2.forEach((t3) => {
        var _a3;
        return (_a3 = t3.hostUpdated) == null ? void 0 : _a3.call(t3);
      }), this.hasUpdated || (this.hasUpdated = true, this.firstUpdated(t2)), this.updated(t2);
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
    shouldUpdate(t2) {
      return true;
    }
    update(t2) {
      this._$Eq && (this._$Eq = this._$Eq.forEach((t3) => this._$ET(t3, this[t3]))), this._$EM();
    }
    updated(t2) {
    }
    firstUpdated(t2) {
    }
  };
  y$1.elementStyles = [], y$1.shadowRootOptions = { mode: "open" }, y$1[d$1("elementProperties")] = /* @__PURE__ */ new Map(), y$1[d$1("finalized")] = /* @__PURE__ */ new Map(), p$1 == null ? void 0 : p$1({ ReactiveElement: y$1 }), (a$1.reactiveElementVersions ?? (a$1.reactiveElementVersions = [])).push("2.1.2");
  /**
   * @license
   * Copyright 2017 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   */
  const t$4 = globalThis, i$4 = (t2) => t2, s$5 = t$4.trustedTypes, e$6 = s$5 ? s$5.createPolicy("lit-html", { createHTML: (t2) => t2 }) : void 0, h$1 = "$lit$", o$6 = `lit$${Math.random().toFixed(9).slice(2)}$`, n$5 = "?" + o$6, r$4 = `<${n$5}>`, l = document, c$2 = () => l.createComment(""), a = (t2) => null === t2 || "object" != typeof t2 && "function" != typeof t2, u = Array.isArray, d = (t2) => u(t2) || "function" == typeof (t2 == null ? void 0 : t2[Symbol.iterator]), f$1 = "[ 	\n\f\r]", v = /<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g, _ = /-->/g, m = />/g, p = RegExp(`>|${f$1}(?:([^\\s"'>=/]+)(${f$1}*=${f$1}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`, "g"), g = /'/g, $ = /"/g, y = /^(?:script|style|textarea|title)$/i, x = (t2) => (i2, ...s2) => ({ _$litType$: t2, strings: i2, values: s2 }), b = x(1), w = x(2), E = Symbol.for("lit-noChange"), A = Symbol.for("lit-nothing"), C = /* @__PURE__ */ new WeakMap(), P = l.createTreeWalker(l, 129);
  function V(t2, i2) {
    if (!u(t2) || !t2.hasOwnProperty("raw")) throw Error("invalid template strings array");
    return void 0 !== e$6 ? e$6.createHTML(i2) : i2;
  }
  const N = (t2, i2) => {
    const s2 = t2.length - 1, e2 = [];
    let n2, l2 = 2 === i2 ? "<svg>" : 3 === i2 ? "<math>" : "", c2 = v;
    for (let i3 = 0; i3 < s2; i3++) {
      const s3 = t2[i3];
      let a2, u2, d2 = -1, f2 = 0;
      for (; f2 < s3.length && (c2.lastIndex = f2, u2 = c2.exec(s3), null !== u2); ) f2 = c2.lastIndex, c2 === v ? "!--" === u2[1] ? c2 = _ : void 0 !== u2[1] ? c2 = m : void 0 !== u2[2] ? (y.test(u2[2]) && (n2 = RegExp("</" + u2[2], "g")), c2 = p) : void 0 !== u2[3] && (c2 = p) : c2 === p ? ">" === u2[0] ? (c2 = n2 ?? v, d2 = -1) : void 0 === u2[1] ? d2 = -2 : (d2 = c2.lastIndex - u2[2].length, a2 = u2[1], c2 = void 0 === u2[3] ? p : '"' === u2[3] ? $ : g) : c2 === $ || c2 === g ? c2 = p : c2 === _ || c2 === m ? c2 = v : (c2 = p, n2 = void 0);
      const x2 = c2 === p && t2[i3 + 1].startsWith("/>") ? " " : "";
      l2 += c2 === v ? s3 + r$4 : d2 >= 0 ? (e2.push(a2), s3.slice(0, d2) + h$1 + s3.slice(d2) + o$6 + x2) : s3 + o$6 + (-2 === d2 ? i3 : x2);
    }
    return [V(t2, l2 + (t2[s2] || "<?>") + (2 === i2 ? "</svg>" : 3 === i2 ? "</math>" : "")), e2];
  };
  class S {
    constructor({ strings: t2, _$litType$: i2 }, e2) {
      let r2;
      this.parts = [];
      let l2 = 0, a2 = 0;
      const u2 = t2.length - 1, d2 = this.parts, [f2, v2] = N(t2, i2);
      if (this.el = S.createElement(f2, e2), P.currentNode = this.el.content, 2 === i2 || 3 === i2) {
        const t3 = this.el.content.firstChild;
        t3.replaceWith(...t3.childNodes);
      }
      for (; null !== (r2 = P.nextNode()) && d2.length < u2; ) {
        if (1 === r2.nodeType) {
          if (r2.hasAttributes()) for (const t3 of r2.getAttributeNames()) if (t3.endsWith(h$1)) {
            const i3 = v2[a2++], s2 = r2.getAttribute(t3).split(o$6), e3 = /([.?@])?(.*)/.exec(i3);
            d2.push({ type: 1, index: l2, name: e3[2], strings: s2, ctor: "." === e3[1] ? I : "?" === e3[1] ? L : "@" === e3[1] ? z : H }), r2.removeAttribute(t3);
          } else t3.startsWith(o$6) && (d2.push({ type: 6, index: l2 }), r2.removeAttribute(t3));
          if (y.test(r2.tagName)) {
            const t3 = r2.textContent.split(o$6), i3 = t3.length - 1;
            if (i3 > 0) {
              r2.textContent = s$5 ? s$5.emptyScript : "";
              for (let s2 = 0; s2 < i3; s2++) r2.append(t3[s2], c$2()), P.nextNode(), d2.push({ type: 2, index: ++l2 });
              r2.append(t3[i3], c$2());
            }
          }
        } else if (8 === r2.nodeType) if (r2.data === n$5) d2.push({ type: 2, index: l2 });
        else {
          let t3 = -1;
          for (; -1 !== (t3 = r2.data.indexOf(o$6, t3 + 1)); ) d2.push({ type: 7, index: l2 }), t3 += o$6.length - 1;
        }
        l2++;
      }
    }
    static createElement(t2, i2) {
      const s2 = l.createElement("template");
      return s2.innerHTML = t2, s2;
    }
  }
  function M(t2, i2, s2 = t2, e2) {
    var _a2, _b;
    if (i2 === E) return i2;
    let h2 = void 0 !== e2 ? (_a2 = s2._$Co) == null ? void 0 : _a2[e2] : s2._$Cl;
    const o2 = a(i2) ? void 0 : i2._$litDirective$;
    return (h2 == null ? void 0 : h2.constructor) !== o2 && ((_b = h2 == null ? void 0 : h2._$AO) == null ? void 0 : _b.call(h2, false), void 0 === o2 ? h2 = void 0 : (h2 = new o2(t2), h2._$AT(t2, s2, e2)), void 0 !== e2 ? (s2._$Co ?? (s2._$Co = []))[e2] = h2 : s2._$Cl = h2), void 0 !== h2 && (i2 = M(t2, h2._$AS(t2, i2.values), h2, e2)), i2;
  }
  class R {
    constructor(t2, i2) {
      this._$AV = [], this._$AN = void 0, this._$AD = t2, this._$AM = i2;
    }
    get parentNode() {
      return this._$AM.parentNode;
    }
    get _$AU() {
      return this._$AM._$AU;
    }
    u(t2) {
      const { el: { content: i2 }, parts: s2 } = this._$AD, e2 = ((t2 == null ? void 0 : t2.creationScope) ?? l).importNode(i2, true);
      P.currentNode = e2;
      let h2 = P.nextNode(), o2 = 0, n2 = 0, r2 = s2[0];
      for (; void 0 !== r2; ) {
        if (o2 === r2.index) {
          let i3;
          2 === r2.type ? i3 = new k(h2, h2.nextSibling, this, t2) : 1 === r2.type ? i3 = new r2.ctor(h2, r2.name, r2.strings, this, t2) : 6 === r2.type && (i3 = new Z(h2, this, t2)), this._$AV.push(i3), r2 = s2[++n2];
        }
        o2 !== (r2 == null ? void 0 : r2.index) && (h2 = P.nextNode(), o2++);
      }
      return P.currentNode = l, e2;
    }
    p(t2) {
      let i2 = 0;
      for (const s2 of this._$AV) void 0 !== s2 && (void 0 !== s2.strings ? (s2._$AI(t2, s2, i2), i2 += s2.strings.length - 2) : s2._$AI(t2[i2])), i2++;
    }
  }
  class k {
    get _$AU() {
      var _a2;
      return ((_a2 = this._$AM) == null ? void 0 : _a2._$AU) ?? this._$Cv;
    }
    constructor(t2, i2, s2, e2) {
      this.type = 2, this._$AH = A, this._$AN = void 0, this._$AA = t2, this._$AB = i2, this._$AM = s2, this.options = e2, this._$Cv = (e2 == null ? void 0 : e2.isConnected) ?? true;
    }
    get parentNode() {
      let t2 = this._$AA.parentNode;
      const i2 = this._$AM;
      return void 0 !== i2 && 11 === (t2 == null ? void 0 : t2.nodeType) && (t2 = i2.parentNode), t2;
    }
    get startNode() {
      return this._$AA;
    }
    get endNode() {
      return this._$AB;
    }
    _$AI(t2, i2 = this) {
      t2 = M(this, t2, i2), a(t2) ? t2 === A || null == t2 || "" === t2 ? (this._$AH !== A && this._$AR(), this._$AH = A) : t2 !== this._$AH && t2 !== E && this._(t2) : void 0 !== t2._$litType$ ? this.$(t2) : void 0 !== t2.nodeType ? this.T(t2) : d(t2) ? this.k(t2) : this._(t2);
    }
    O(t2) {
      return this._$AA.parentNode.insertBefore(t2, this._$AB);
    }
    T(t2) {
      this._$AH !== t2 && (this._$AR(), this._$AH = this.O(t2));
    }
    _(t2) {
      this._$AH !== A && a(this._$AH) ? this._$AA.nextSibling.data = t2 : this.T(l.createTextNode(t2)), this._$AH = t2;
    }
    $(t2) {
      var _a2;
      const { values: i2, _$litType$: s2 } = t2, e2 = "number" == typeof s2 ? this._$AC(t2) : (void 0 === s2.el && (s2.el = S.createElement(V(s2.h, s2.h[0]), this.options)), s2);
      if (((_a2 = this._$AH) == null ? void 0 : _a2._$AD) === e2) this._$AH.p(i2);
      else {
        const t3 = new R(e2, this), s3 = t3.u(this.options);
        t3.p(i2), this.T(s3), this._$AH = t3;
      }
    }
    _$AC(t2) {
      let i2 = C.get(t2.strings);
      return void 0 === i2 && C.set(t2.strings, i2 = new S(t2)), i2;
    }
    k(t2) {
      u(this._$AH) || (this._$AH = [], this._$AR());
      const i2 = this._$AH;
      let s2, e2 = 0;
      for (const h2 of t2) e2 === i2.length ? i2.push(s2 = new k(this.O(c$2()), this.O(c$2()), this, this.options)) : s2 = i2[e2], s2._$AI(h2), e2++;
      e2 < i2.length && (this._$AR(s2 && s2._$AB.nextSibling, e2), i2.length = e2);
    }
    _$AR(t2 = this._$AA.nextSibling, s2) {
      var _a2;
      for ((_a2 = this._$AP) == null ? void 0 : _a2.call(this, false, true, s2); t2 !== this._$AB; ) {
        const s3 = i$4(t2).nextSibling;
        i$4(t2).remove(), t2 = s3;
      }
    }
    setConnected(t2) {
      var _a2;
      void 0 === this._$AM && (this._$Cv = t2, (_a2 = this._$AP) == null ? void 0 : _a2.call(this, t2));
    }
  }
  class H {
    get tagName() {
      return this.element.tagName;
    }
    get _$AU() {
      return this._$AM._$AU;
    }
    constructor(t2, i2, s2, e2, h2) {
      this.type = 1, this._$AH = A, this._$AN = void 0, this.element = t2, this.name = i2, this._$AM = e2, this.options = h2, s2.length > 2 || "" !== s2[0] || "" !== s2[1] ? (this._$AH = Array(s2.length - 1).fill(new String()), this.strings = s2) : this._$AH = A;
    }
    _$AI(t2, i2 = this, s2, e2) {
      const h2 = this.strings;
      let o2 = false;
      if (void 0 === h2) t2 = M(this, t2, i2, 0), o2 = !a(t2) || t2 !== this._$AH && t2 !== E, o2 && (this._$AH = t2);
      else {
        const e3 = t2;
        let n2, r2;
        for (t2 = h2[0], n2 = 0; n2 < h2.length - 1; n2++) r2 = M(this, e3[s2 + n2], i2, n2), r2 === E && (r2 = this._$AH[n2]), o2 || (o2 = !a(r2) || r2 !== this._$AH[n2]), r2 === A ? t2 = A : t2 !== A && (t2 += (r2 ?? "") + h2[n2 + 1]), this._$AH[n2] = r2;
      }
      o2 && !e2 && this.j(t2);
    }
    j(t2) {
      t2 === A ? this.element.removeAttribute(this.name) : this.element.setAttribute(this.name, t2 ?? "");
    }
  }
  class I extends H {
    constructor() {
      super(...arguments), this.type = 3;
    }
    j(t2) {
      this.element[this.name] = t2 === A ? void 0 : t2;
    }
  }
  class L extends H {
    constructor() {
      super(...arguments), this.type = 4;
    }
    j(t2) {
      this.element.toggleAttribute(this.name, !!t2 && t2 !== A);
    }
  }
  class z extends H {
    constructor(t2, i2, s2, e2, h2) {
      super(t2, i2, s2, e2, h2), this.type = 5;
    }
    _$AI(t2, i2 = this) {
      if ((t2 = M(this, t2, i2, 0) ?? A) === E) return;
      const s2 = this._$AH, e2 = t2 === A && s2 !== A || t2.capture !== s2.capture || t2.once !== s2.once || t2.passive !== s2.passive, h2 = t2 !== A && (s2 === A || e2);
      e2 && this.element.removeEventListener(this.name, this, s2), h2 && this.element.addEventListener(this.name, this, t2), this._$AH = t2;
    }
    handleEvent(t2) {
      var _a2;
      "function" == typeof this._$AH ? this._$AH.call(((_a2 = this.options) == null ? void 0 : _a2.host) ?? this.element, t2) : this._$AH.handleEvent(t2);
    }
  }
  class Z {
    constructor(t2, i2, s2) {
      this.element = t2, this.type = 6, this._$AN = void 0, this._$AM = i2, this.options = s2;
    }
    get _$AU() {
      return this._$AM._$AU;
    }
    _$AI(t2) {
      M(this, t2);
    }
  }
  const B = t$4.litHtmlPolyfillSupport;
  B == null ? void 0 : B(S, k), (t$4.litHtmlVersions ?? (t$4.litHtmlVersions = [])).push("3.3.3");
  const D = (t2, i2, s2) => {
    const e2 = (s2 == null ? void 0 : s2.renderBefore) ?? i2;
    let h2 = e2._$litPart$;
    if (void 0 === h2) {
      const t3 = (s2 == null ? void 0 : s2.renderBefore) ?? null;
      e2._$litPart$ = h2 = new k(i2.insertBefore(c$2(), t3), t3, void 0, s2 ?? {});
    }
    return h2._$AI(t2), h2;
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
      const t2 = super.createRenderRoot();
      return (_a2 = this.renderOptions).renderBefore ?? (_a2.renderBefore = t2.firstChild), t2;
    }
    update(t2) {
      const r2 = this.render();
      this.hasUpdated || (this.renderOptions.isConnected = this.isConnected), super.update(t2), this._$Do = D(r2, this.renderRoot, this.renderOptions);
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
  const t$3 = (t2) => (e2, o2) => {
    void 0 !== o2 ? o2.addInitializer(() => {
      customElements.define(t2, e2);
    }) : customElements.define(t2, e2);
  };
  /**
   * @license
   * Copyright 2017 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   */
  const o$4 = { attribute: true, type: String, converter: u$1, reflect: false, hasChanged: f$2 }, r$3 = (t2 = o$4, e2, r2) => {
    const { kind: n2, metadata: i2 } = r2;
    let s2 = globalThis.litPropertyMetadata.get(i2);
    if (void 0 === s2 && globalThis.litPropertyMetadata.set(i2, s2 = /* @__PURE__ */ new Map()), "setter" === n2 && ((t2 = Object.create(t2)).wrapped = true), s2.set(r2.name, t2), "accessor" === n2) {
      const { name: o2 } = r2;
      return { set(r3) {
        const n3 = e2.get.call(this);
        e2.set.call(this, r3), this.requestUpdate(o2, n3, t2, true, r3);
      }, init(e3) {
        return void 0 !== e3 && this.C(o2, void 0, t2, e3), e3;
      } };
    }
    if ("setter" === n2) {
      const { name: o2 } = r2;
      return function(r3) {
        const n3 = this[o2];
        e2.call(this, r3), this.requestUpdate(o2, n3, t2, true, r3);
      };
    }
    throw Error("Unsupported decorator location: " + n2);
  };
  function n$4(t2) {
    return (e2, o2) => "object" == typeof o2 ? r$3(t2, e2, o2) : ((t3, e3, o3) => {
      const r2 = e3.hasOwnProperty(o3);
      return e3.constructor.createProperty(o3, t3), r2 ? Object.getOwnPropertyDescriptor(e3, o3) : void 0;
    })(t2, e2, o2);
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
  const e$5 = (e2, t2, c2) => (c2.configurable = true, c2.enumerable = true, Reflect.decorate && "object" != typeof t2 && Object.defineProperty(e2, t2, c2), c2);
  /**
   * @license
   * Copyright 2017 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   */
  function e$4(e2, r2) {
    return (n2, s2, i2) => {
      const o2 = (t2) => {
        var _a2;
        return ((_a2 = t2.renderRoot) == null ? void 0 : _a2.querySelector(e2)) ?? null;
      };
      return e$5(n2, s2, { get() {
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
    constructor(s2, t2, e2, o2) {
      super("context-request", { bubbles: true, composed: true }), this.context = s2, this.contextTarget = t2, this.callback = e2, this.subscribe = o2 ?? false;
    }
  };
  /**
   * @license
   * Copyright 2021 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   */
  function n$3(n2) {
    return n2;
  }
  /**
   * @license
   * Copyright 2021 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   */
  let s$2 = class s {
    constructor(t2, s2, i2, h2) {
      if (this.subscribe = false, this.provided = false, this.value = void 0, this.t = (t3, s3) => {
        this.unsubscribe && (this.unsubscribe !== s3 && (this.provided = false, this.unsubscribe()), this.subscribe || this.unsubscribe()), this.value = t3, this.host.requestUpdate(), this.provided && !this.subscribe || (this.provided = true, this.callback && this.callback(t3, s3)), this.unsubscribe = s3;
      }, this.host = t2, void 0 !== s2.context) {
        const t3 = s2;
        this.context = t3.context, this.callback = t3.callback, this.subscribe = t3.subscribe ?? false;
      } else this.context = s2, this.callback = i2, this.subscribe = h2 ?? false;
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
  let s$1 = class s {
    get value() {
      return this.o;
    }
    set value(s2) {
      this.setValue(s2);
    }
    setValue(s2, t2 = false) {
      const i2 = t2 || !Object.is(s2, this.o);
      this.o = s2, i2 && this.updateObservers();
    }
    constructor(s2) {
      this.subscriptions = /* @__PURE__ */ new Map(), this.updateObservers = () => {
        for (const [s3, { disposer: t2 }] of this.subscriptions) s3(this.o, t2);
      }, void 0 !== s2 && (this.value = s2);
    }
    addCallback(s2, t2, i2) {
      if (!i2) return void s2(this.value);
      this.subscriptions.has(s2) || this.subscriptions.set(s2, { disposer: () => {
        this.subscriptions.delete(s2);
      }, consumerHost: t2 });
      const { disposer: h2 } = this.subscriptions.get(s2);
      s2(this.value, h2);
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
    constructor(t2, s2) {
      super("context-provider", { bubbles: true, composed: true }), this.context = t2, this.contextTarget = s2;
    }
  };
  let i$2 = class i extends s$1 {
    constructor(s2, e2, i2) {
      var _a2, _b;
      super(void 0 !== e2.context ? e2.initialValue : i2), this.onContextRequest = (t2) => {
        if (t2.context !== this.context) return;
        const s3 = t2.contextTarget ?? t2.composedPath()[0];
        s3 !== this.host && (t2.stopPropagation(), this.addCallback(t2.callback, s3, t2.subscribe));
      }, this.onProviderRequest = (s3) => {
        if (s3.context !== this.context) return;
        if ((s3.contextTarget ?? s3.composedPath()[0]) === this.host) return;
        const e3 = /* @__PURE__ */ new Set();
        for (const [s4, { consumerHost: i3 }] of this.subscriptions) e3.has(s4) || (e3.add(s4), i3.dispatchEvent(new s$3(this.context, i3, s4, true)));
        s3.stopPropagation();
      }, this.host = s2, void 0 !== e2.context ? this.context = e2.context : this.context = e2, this.attachListeners(), (_b = (_a2 = this.host).addController) == null ? void 0 : _b.call(_a2, this);
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
      this.pendingContextRequests = /* @__PURE__ */ new Map(), this.onContextProvider = (t2) => {
        const s2 = this.pendingContextRequests.get(t2.context);
        if (void 0 === s2) return;
        this.pendingContextRequests.delete(t2.context);
        const { requests: o2 } = s2;
        for (const { elementRef: s3, callbackRef: n2 } of o2) {
          const o3 = s3.deref(), c2 = n2.deref();
          void 0 === o3 || void 0 === c2 || o3.dispatchEvent(new s$3(t2.context, o3, c2, true));
        }
      }, this.onContextRequest = (e2) => {
        if (true !== e2.subscribe) return;
        const t2 = e2.contextTarget ?? e2.composedPath()[0], s2 = e2.callback;
        let o2 = this.pendingContextRequests.get(e2.context);
        void 0 === o2 && this.pendingContextRequests.set(e2.context, o2 = { callbacks: /* @__PURE__ */ new WeakMap(), requests: [] });
        let n2 = o2.callbacks.get(t2);
        void 0 === n2 && o2.callbacks.set(t2, n2 = /* @__PURE__ */ new WeakSet()), n2.has(s2) || (n2.add(s2), o2.requests.push({ elementRef: new WeakRef(t2), callbackRef: new WeakRef(s2) }));
      };
    }
    attach(e2) {
      e2.addEventListener("context-request", this.onContextRequest), e2.addEventListener("context-provider", this.onContextProvider);
    }
    detach(e2) {
      e2.removeEventListener("context-request", this.onContextRequest), e2.removeEventListener("context-provider", this.onContextProvider);
    }
  };
  /**
   * @license
   * Copyright 2017 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   */
  function e$2({ context: e2 }) {
    return (n2, i2) => {
      const r2 = /* @__PURE__ */ new WeakMap();
      if ("object" == typeof i2) return { get() {
        return n2.get.call(this);
      }, set(t2) {
        return r2.get(this).setValue(t2), n2.set.call(this, t2);
      }, init(n3) {
        return r2.set(this, new i$2(this, { context: e2, initialValue: n3 })), n3;
      } };
      {
        n2.constructor.addInitializer(((n3) => {
          r2.set(n3, new i$2(n3, { context: e2 }));
        }));
        const o2 = Object.getOwnPropertyDescriptor(n2, i2);
        let s2;
        if (void 0 === o2) {
          const t2 = /* @__PURE__ */ new WeakMap();
          s2 = { get() {
            return t2.get(this);
          }, set(e3) {
            r2.get(this).setValue(e3), t2.set(this, e3);
          }, configurable: true, enumerable: true };
        } else {
          const t2 = o2.set;
          s2 = { ...o2, set(e3) {
            r2.get(this).setValue(e3), t2 == null ? void 0 : t2.call(this, e3);
          } };
        }
        return void Object.defineProperty(n2, i2, s2);
      }
    };
  }
  /**
   * @license
   * Copyright 2022 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   */
  function c$1({ context: c2, subscribe: e2 }) {
    return (o2, n2) => {
      "object" == typeof n2 ? n2.addInitializer((function() {
        new s$2(this, { context: c2, callback: (t2) => {
          o2.set.call(this, t2);
        }, subscribe: e2 });
      })) : o2.constructor.addInitializer(((o3) => {
        new s$2(o3, { context: c2, callback: (t2) => {
          o3[n2] = t2;
        }, subscribe: e2 });
      }));
    };
  }
  const themeContext = n$3("ffbox-theme");
  var __defProp$h = Object.defineProperty;
  var __getOwnPropDesc$h = Object.getOwnPropertyDescriptor;
  var __decorateClass$h = (decorators, target, key, kind) => {
    var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc$h(target, key) : target;
    for (var i2 = decorators.length - 1, decorator; i2 >= 0; i2--)
      if (decorator = decorators[i2])
        result = (kind ? decorator(target, key, result) : decorator(result)) || result;
    if (kind && result) __defProp$h(target, key, result);
    return result;
  };
  if (typeof globalThis.__ffbox_context_root_attached === "undefined") {
    globalThis.__ffbox_context_root_attached = true;
    if (typeof document !== "undefined" && document.body) {
      new t$2().attach(document.body);
    }
  }
  exports.FFBoxThemeProvider = class FFBoxThemeProvider extends i$3 {
    constructor() {
      super(...arguments);
      this.theme = "light";
    }
    // 以下实现等同于装饰器 @provide({ context: themeContext }) 的功能，保留注释以供参考
    // private _provider = new ContextProvider(this, {
    // 	context: themeContext,
    // 	initialValue: this.theme,
    // });
    // willUpdate(changed: Map<string, unknown>) {
    // 	if (changed.has('theme')) {
    // 		this._provider.setValue(this.theme);
    // 	}
    // }
    render() {
      return b`<slot></slot>`;
    }
  };
  __decorateClass$h([
    e$2({ context: themeContext }),
    n$4({ reflect: true, attribute: "data-theme" })
  ], exports.FFBoxThemeProvider.prototype, "theme", 2);
  exports.FFBoxThemeProvider = __decorateClass$h([
    t$3("ffbox-theme-provider")
  ], exports.FFBoxThemeProvider);
  var __defProp$g = Object.defineProperty;
  var __getOwnPropDesc$g = Object.getOwnPropertyDescriptor;
  var __decorateClass$g = (decorators, target, key, kind) => {
    var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc$g(target, key) : target;
    for (var i2 = decorators.length - 1, decorator; i2 >= 0; i2--)
      if (decorator = decorators[i2])
        result = (kind ? decorator(target, key, result) : decorator(result)) || result;
    if (kind && result) __defProp$g(target, key, result);
    return result;
  };
  exports.FFBoxButton = class FFBoxButton extends i$3 {
    constructor() {
      super();
      this.type = "normal";
      this.size = "normal";
      this.disabled = false;
      this.theme = "light";
      this.addEventListener("click", (e2) => {
        if (this.disabled) {
          e2.stopImmediatePropagation();
        }
      });
    }
    render() {
      const typeClass = this.type !== "normal" ? this.type : "";
      const sizeClass = this.size !== "normal" ? this.size : "";
      const classes = ["button", typeClass, sizeClass].filter(Boolean).join(" ");
      return b`
			<button
				class=${classes}
				?disabled=${this.disabled}
			>
				<slot></slot>
			</button>
		`;
    }
  };
  exports.FFBoxButton.styles = i$6`
		:host {
			display: inline-block;
			font-family: inherit;
		}

		:host([disabled]) .button {
			pointer-events: none;
			opacity: 0.6;
		}

		.button {
			position: relative;
			min-width: 100px;
			height: 28px;
			padding: 0 12px;
			line-height: 100%;
			font-size: 14px;
			text-align: center;
			background: linear-gradient(180deg, hwb(var(--bg99)), hwb(var(--bg94)));
			color: var(--33);
			font-family: inherit;
			border-radius: 8px;
			border: none;
			outline: none;
			transition: box-shadow 0.3s cubic-bezier(0, 1.5, 0.3, 1);
		}

		.button:active {
			transition: none;
			transform: translateY(0.5px);
		}

		/* Light theme */
		:host([data-theme="light"]) .button {
			box-shadow:
				0 0 1px 0.5px hwb(var(--bg99)),
				0 1px 3px 0 hwb(var(--hoverShadow) / 0.3);
		}
		:host([data-theme="light"]) .button:hover {
			box-shadow:
				0 0 1px 0.5px hwb(var(--bg99, 0 99% 1%)),
				0 0 0 0.5px hwb(var(--highlight, 0 100% 0%)) inset,
				0 1px 4px 0 hwb(var(--hoverShadow, 0 0% 100%) / 0.4);
		}
		:host([data-theme="light"]) .button:active {
			box-shadow:
				0 0px 2px 0.5px hwb(var(--hoverShadow, 0 0% 100%) / 0.15),
				0 8px 12px hwb(var(--hoverShadow, 0 0% 100%) / 0.1) inset;
		}

		/* Dark theme */
		:host([data-theme="dark"]) .button {
			/* outline: red 1px solid;	// 测试 theme 响应 */
			box-shadow:
				0 0 1px 0.5px hwb(var(--bg99, 0 18.5% 81.5%)),
				0 0 0 0.5px hwb(var(--highlight, 0 25% 75%) / 0.5) inset,
				0 1px 3px 0 hwb(var(--hoverShadow, 0 0% 100%) / 0.3);
		}
		:host([data-theme="dark"]) .button:hover {
			box-shadow:
				0 0 1px 0.5px hwb(var(--bg99, 0 18.5% 81.5%)),
				0 0 0 0.75px hwb(var(--highlight, 0 25% 75%)) inset,
				0 1px 4px 0 hwb(var(--hoverShadow, 0 0% 100%) / 0.4);
		}
		:host([data-theme="dark"]) .button:active {
			box-shadow:
				0 0px 2px 0.5px hwb(var(--hoverShadow, 0 0% 100%) / 0.15),
				0 8px 12px hwb(var(--hoverShadow, 0 0% 100%) / 0.4) inset;
		}

		/* Sizes */
		.small {
			height: 24px;
			font-size: 13px;
			padding: 0 8px;
			min-width: unset;
		}
		.large {
			height: 36px;
			font-size: 16px;
			padding: 0 20px;
			min-width: 160px;
			border-radius: 10px;
			text-indent: 1px;
			letter-spacing: 2px;
		}

		/* Primary - Light */
		:host(:not([data-theme="dark"])) .primary {
			background: linear-gradient(180deg, hwb(210 45% 5%), hwb(210 25% 10%));
			color: #FDFDFD;
		}
		:host(:not([data-theme="dark"])) .primary:hover {
			background: linear-gradient(180deg, hwb(210 45% 0%), hwb(210 25% 5%));
			box-shadow:
				0 0 1px 0.5px hwb(var(--bg99, 0 99% 1%)),
				0 0 0 0.5px hwb(210 50% 0%) inset,
				0 1px 4px 0 hwb(210 0% 50% / 0.4);
		}
		:host(:not([data-theme="dark"])) .primary:active {
			box-shadow:
				0 0px 2px 0.5px hwb(210 0% 100% / 0.15),
				0 4px 6px hwb(210 0% 100% / 0.2) inset;
		}

		/* Primary - Dark */
		:host([data-theme="dark"]) .primary {
			background: linear-gradient(180deg, hwb(210 30% 5%), hwb(210 15% 25%));
			color: #FDFDFD;
		}
		:host([data-theme="dark"]) .primary:hover {
			background: linear-gradient(180deg, hwb(210 30% 0%), hwb(210 15% 20%));
			box-shadow:
				0 0 1px 0.5px hwb(var(--bg99, 0 18.5% 81.5%)),
				0 0 0 0.5px hwb(210 50% 0%) inset,
				0 1px 4px 0 hwb(210 0% 50% / 0.4);
		}
		:host([data-theme="dark"]) .primary:active {
			box-shadow:
				0 0px 2px 0.5px hwb(210 0% 100% / 0.15),
				0 4px 6px hwb(210 0% 100% / 0.2) inset;
		}

		/* Danger - Light */
		:host(:not([data-theme="dark"])) .danger {
			background: linear-gradient(180deg, hwb(0 45% 5%), hwb(0 25% 10%));
			color: #FDFDFD;
		}
		:host(:not([data-theme="dark"])) .danger:hover {
			background: linear-gradient(180deg, hwb(0 45% 0%), hwb(0 25% 5%));
			box-shadow:
				0 0 1px 0.5px hwb(var(--bg99, 0 99% 1%)),
				0 0 0 0.5px hwb(0 50% 0%) inset,
				0 1px 4px 0 hwb(0 0% 50% / 0.4);
		}
		:host(:not([data-theme="dark"])) .danger:active {
			box-shadow:
				0 0px 2px 0.5px hwb(0 0% 100% / 0.15),
				0 4px 6px hwb(0 0% 100% / 0.2) inset;
		}

		/* Danger - Dark */
		:host([data-theme="dark"]) .danger {
			background: linear-gradient(180deg, hwb(0 30% 5%), hwb(0 15% 25%));
			color: #FDFDFD;
		}
		:host([data-theme="dark"]) .danger:hover {
			background: linear-gradient(180deg, hwb(0 30% 0%), hwb(0 15% 20%));
			box-shadow:
				0 0 1px 0.5px hwb(var(--bg99, 0 18.5% 81.5%)),
				0 0 0 0.5px hwb(0 50% 0%) inset,
				0 1px 4px 0 hwb(0 0% 50% / 0.4);
		}
		:host([data-theme="dark"]) .danger:active {
			box-shadow:
				0 0px 2px 0.5px hwb(0 0% 100% / 0.15),
				0 4px 6px hwb(0 0% 100% / 0.2) inset;
		}

		/* NoBg - Light */
		:host(:not([data-theme="dark"])) .noBg {
			background: none;
			box-shadow: none;
		}
		:host(:not([data-theme="dark"])) .noBg:hover {
			box-shadow:
				0 1.5px 4px 0 hwb(var(--hoverShadow, 0 0% 100%) / 0.15),
				0 1px 0.5px 0px hwb(var(--hoverLightBg, 0 100% 0%)) inset;
		}
		:host(:not([data-theme="dark"])) .noBg:active {
			box-shadow:
				0 0 2px 1px hwb(var(--hoverShadow, 0 0% 100%) / 0.05),
				0 6px 12px hwb(var(--hoverShadow, 0 0% 100%) / 0.1) inset;
		}

		/* NoBg - Dark */
		:host([data-theme="dark"]) .noBg {
			background: none;
			box-shadow: none;
		}
		:host([data-theme="dark"]) .noBg:hover {
			box-shadow:
				0 0 1.5px 0.5px hwb(var(--hoverLightBg, 0 20% 80%)),
				0 1.5px 4px 0 hwb(var(--hoverShadow, 0 0% 100%) / 0.3),
				0 1px 0.5px 0px hwb(var(--hoverLightBg, 0 20% 80%)) inset;
		}
		:host([data-theme="dark"]) .noBg:active {
			box-shadow:
				0 0 2px 1px hwb(var(--hoverShadow, 0 0% 100%) / 0.05),
				0 6px 18px hwb(var(--hoverShadow, 0 0% 100%) / 0.4) inset;
		}
	`;
  __decorateClass$g([
    n$4({ reflect: true })
  ], exports.FFBoxButton.prototype, "type", 2);
  __decorateClass$g([
    n$4({ reflect: true })
  ], exports.FFBoxButton.prototype, "size", 2);
  __decorateClass$g([
    n$4({ reflect: true, type: Boolean })
  ], exports.FFBoxButton.prototype, "disabled", 2);
  __decorateClass$g([
    c$1({ context: themeContext, subscribe: true }),
    n$4({ reflect: true, attribute: "data-theme" })
  ], exports.FFBoxButton.prototype, "theme", 2);
  exports.FFBoxButton = __decorateClass$g([
    t$3("ffbox-button")
  ], exports.FFBoxButton);
  var __defProp$f = Object.defineProperty;
  var __getOwnPropDesc$f = Object.getOwnPropertyDescriptor;
  var __decorateClass$f = (decorators, target, key, kind) => {
    var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc$f(target, key) : target;
    for (var i2 = decorators.length - 1, decorator; i2 >= 0; i2--)
      if (decorator = decorators[i2])
        result = (kind ? decorator(target, key, result) : decorator(result)) || result;
    if (kind && result) __defProp$f(target, key, result);
    return result;
  };
  exports.FFBoxSwitch = class FFBoxSwitch extends i$3 {
    constructor() {
      super(...arguments);
      this.checked = false;
      this.theme = "light";
    }
    render() {
      return b`
			<div class="switch-track" @mousedown=${this._handleDragStart} @touchstart=${this._handleDragStart}>
				<div
					class="switch-track-background"
					style="width: ${this.checked ? "100%" : "0%"}"
				></div>
				<button
					class="switch-slipper"
					style="left: ${this.checked ? "64px" : "0px"}"
					@keydown=${this._handleKeydown}
					@keyup=${this._handleKeyup}
					aria-label="开关"
					role="switch"
					aria-checked=${this.checked}
				></button>
			</div>
		`;
    }
    _handleDragStart(event) {
      event.preventDefault();
      const beforeChecked = this.checked;
      const mouseDownX = event.pageX ?? event.touches[0].pageX;
      let sliderLeft, sliderWidth;
      const target = event.target;
      if (target === this.slipperEl) {
        sliderLeft = target.parentElement.getBoundingClientRect().left;
        sliderWidth = target.parentElement.offsetWidth;
      } else {
        sliderLeft = target.getBoundingClientRect().left;
        sliderWidth = target.offsetWidth;
      }
      let lastValue = NaN;
      const handleMouseMove = (e2) => {
        var _a2, _b;
        const pageX = e2.pageX ?? ((_b = (_a2 = e2.touches) == null ? void 0 : _a2[0]) == null ? void 0 : _b.pageX) ?? mouseDownX;
        let valueX = Math.floor(pageX) - sliderLeft;
        let newValue;
        if (valueX < sliderWidth / 2) {
          newValue = false;
        } else {
          newValue = true;
        }
        if (newValue !== lastValue) {
          this._emitChange(newValue);
          lastValue = newValue;
        }
      };
      const handleMouseUp = (e2) => {
        var _a2, _b;
        const pageX = e2.pageX ?? ((_b = (_a2 = e2.changedTouches) == null ? void 0 : _a2[0]) == null ? void 0 : _b.pageX) ?? mouseDownX;
        if (Math.abs(mouseDownX - Math.floor(pageX)) <= 3) {
          if (this.checked && beforeChecked) {
            this._emitChange(false);
          } else if (!this.checked && !beforeChecked) {
            this._emitChange(true);
          }
        }
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.removeEventListener("touchmove", handleMouseMove);
        document.removeEventListener("touchend", handleMouseUp);
      };
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.addEventListener("touchmove", handleMouseMove);
      document.addEventListener("touchend", handleMouseUp);
      handleMouseMove({ pageX: mouseDownX });
    }
    _handleKeydown(event) {
      if (event.key === "ArrowLeft") {
        this._emitChange(false);
      } else if (event.key === "ArrowRight") {
        this._emitChange(true);
      }
    }
    _handleKeyup(event) {
      if (event.key === " " || event.key === "Enter") {
        this._emitChange(!this.checked);
      }
    }
    _emitChange(value) {
      this.checked = value;
      this.dispatchEvent(new CustomEvent("change", {
        detail: value,
        bubbles: true,
        composed: true
      }));
    }
  };
  exports.FFBoxSwitch.styles = i$6`
		:host {
			display: inline-block;
		}

		// :host([data-theme="dark"]) {
		// 	outline: red 1px solid;	// 测试 theme 响应
		// }
	
		.switch-track {
			position: relative;
			height: 24px;
			width: 88px;
			border-radius: 24px;
			background: var(--f7, #F7F7F7);
			border: #CCC 1px solid;
			box-shadow: 0px 4px 4px rgba(0, 0, 0, 0.1) inset;
			cursor: pointer;
			user-select: none;
		}

		.switch-track-background {
			position: absolute;
			height: 24px;
			border-radius: 24px;
			background: hsl(210, 85%, 60%);
			box-shadow: 0px 4px 4px rgba(0, 0, 0, 0.1) inset;
			transition: all 0.15s ease-out;
		}

		.switch-slipper {
			position: absolute;
			top: 0;
			height: 24px;
			width: 24px;
			border-radius: 50%;
			background: linear-gradient(180deg, #fefefe, #f0f0f0);
			box-shadow: 0px 1px 3px 0px rgba(0, 0, 0, 0.3);
			transform: scale(1.25);
			transition: all 0.15s ease-out;
			border: none;
			outline: none;
			cursor: pointer;
		}

		.switch-slipper:hover {
			background: linear-gradient(180deg, #ffffff, #fefefe);
		}

		.switch-slipper:active {
			background: linear-gradient(180deg, #f0f0f0, #ededed);
		}
	`;
  __decorateClass$f([
    n$4({ type: Boolean, reflect: true })
  ], exports.FFBoxSwitch.prototype, "checked", 2);
  __decorateClass$f([
    c$1({ context: themeContext, subscribe: true }),
    n$4({ reflect: true, attribute: "data-theme" })
  ], exports.FFBoxSwitch.prototype, "theme", 2);
  __decorateClass$f([
    e$4(".switch-slipper")
  ], exports.FFBoxSwitch.prototype, "slipperEl", 2);
  exports.FFBoxSwitch = __decorateClass$f([
    t$3("ffbox-switch")
  ], exports.FFBoxSwitch);
  /**
   * @license
   * Copyright 2017 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   */
  const t$1 = { ATTRIBUTE: 1, CHILD: 2, ELEMENT: 6 }, e$1 = (t2) => (...e2) => ({ _$litDirective$: t2, values: e2 });
  let i$1 = class i {
    constructor(t2) {
    }
    get _$AU() {
      return this._$AM._$AU;
    }
    _$AT(t2, e2, i2) {
      this._$Ct = t2, this._$AM = e2, this._$Ci = i2;
    }
    _$AS(t2, e2) {
      return this.update(t2, e2);
    }
    update(t2, e2) {
      return this.render(...e2);
    }
  };
  /**
   * @license
   * Copyright 2017 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   */
  class e extends i$1 {
    constructor(i2) {
      if (super(i2), this.it = A, i2.type !== t$1.CHILD) throw Error(this.constructor.directiveName + "() can only be used in child bindings");
    }
    render(r2) {
      if (r2 === A || null == r2) return this._t = void 0, this.it = r2;
      if (r2 === E) return r2;
      if ("string" != typeof r2) throw Error(this.constructor.directiveName + "() called with a non-string value");
      if (r2 === this.it) return this._t;
      this.it = r2;
      const s2 = [r2];
      return s2.raw = s2, this._t = { _$litType$: this.constructor.resultType, strings: s2, values: [] };
    }
  }
  e.directiveName = "unsafeHTML", e.resultType = 1;
  /**
   * @license
   * Copyright 2017 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   */
  class t extends e {
  }
  t.directiveName = "unsafeSVG", t.resultType = 2;
  const o$3 = e$1(t);
  const checkIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="200" height="200"><path d="M911.018667 181.973333a64 64 0 0 1 16.341333 89.045334l-426.666667 618.666666a64 64 0 0 1-99.584 7.210667l-277.333333-298.666667a64 64 0 0 1 93.781333-87.125333l223.061334 240.213333 381.354666-552.96a64 64 0 0 1 89.045334-16.384z" fill="currentColor"></path></svg>';
  var __defProp$e = Object.defineProperty;
  var __getOwnPropDesc$e = Object.getOwnPropertyDescriptor;
  var __decorateClass$e = (decorators, target, key, kind) => {
    var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc$e(target, key) : target;
    for (var i2 = decorators.length - 1, decorator; i2 >= 0; i2--)
      if (decorator = decorators[i2])
        result = (kind ? decorator(target, key, result) : decorator(result)) || result;
    if (kind && result) __defProp$e(target, key, result);
    return result;
  };
  exports.FFBoxCheckbox = class FFBoxCheckbox extends i$3 {
    constructor() {
      super(...arguments);
      this.checked = false;
      this.disabled = false;
      this.theme = "light";
    }
    render() {
      const isSelected = this.checked === true || this.checked === "partial";
      return b`
			<div
				class=${["box", isSelected ? "boxSelected" : ""].filter(Boolean).join(" ")}
				@click=${this._handleClick}
				style="cursor: ${this.disabled ? "not-allowed" : "pointer"}"
			>
				${o$3(checkIcon)}
			</div>
		`;
    }
    _handleClick() {
      if (this.disabled) return;
      const newValue = this.checked === true ? false : true;
      this.checked = newValue;
      this.dispatchEvent(new CustomEvent("change", {
        detail: newValue,
        bubbles: true,
        composed: true
      }));
    }
  };
  exports.FFBoxCheckbox.styles = i$6`
		:host {
			display: inline-block;
			font-size: 0; /* 纯 HTML 状态下，代码中的换行会被渲染出来，需要设置为 0 来屏蔽 */
		}

		// :host([data-theme="dark"]) {
		// 	outline: red 1px solid;	// 测试 theme 响应
		// }

		.box {
			position: relative;
			box-sizing: border-box;
			width: 18px;
			height: 18px;
			display: inline-block;
			background-color: hwb(var(--bg98) / 0.8);
			border: hwb(0 80% 20%) 1px solid;
			border-radius: 3px;
			box-shadow: 0 2px 2px hwb(0 80% 20% / 0.2);
		}

		:host([disabled]) .box {
			cursor: not-allowed;
		}

		.box svg {
			position: absolute;
			left: 10%;
			top: 10%;
			width: 80%;
			height: 80%;
			color: transparent;
		}

		.boxSelected {
			background-color: hwb(220 25% 10%);
			border: none;
			box-shadow: 0 2px 4px hwb(220 25% 10% / 0.2);
		}

		.boxSelected svg {
			color: #FFF;
		}
	`;
  __decorateClass$e([
    n$4({
      reflect: true,
      converter: {
        fromAttribute: (value) => {
          if (value === null || value === "false") return false;
          if (value === "" || value === "true") return true;
          return value;
        },
        toAttribute: (value) => {
          if (value === false) return null;
          if (value === true) return "";
          return value;
        }
      }
    })
  ], exports.FFBoxCheckbox.prototype, "checked", 2);
  __decorateClass$e([
    n$4({ type: Boolean, reflect: true })
  ], exports.FFBoxCheckbox.prototype, "disabled", 2);
  __decorateClass$e([
    c$1({ context: themeContext, subscribe: true }),
    n$4({ reflect: true, attribute: "data-theme" })
  ], exports.FFBoxCheckbox.prototype, "theme", 2);
  exports.FFBoxCheckbox = __decorateClass$e([
    t$3("ffbox-checkbox")
  ], exports.FFBoxCheckbox);
  var __defProp$d = Object.defineProperty;
  var __getOwnPropDesc$d = Object.getOwnPropertyDescriptor;
  var __decorateClass$d = (decorators, target, key, kind) => {
    var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc$d(target, key) : target;
    for (var i2 = decorators.length - 1, decorator; i2 >= 0; i2--)
      if (decorator = decorators[i2])
        result = (kind ? decorator(target, key, result) : decorator(result)) || result;
    if (kind && result) __defProp$d(target, key, result);
    return result;
  };
  exports.FFBoxRadio = class FFBoxRadio extends i$3 {
    constructor() {
      super(...arguments);
      this.checked = false;
      this.disabled = false;
      this.theme = "light";
    }
    render() {
      const isSelected = this.checked === true || this.checked === "partial";
      return b`
			<div
				class=${["box", isSelected ? "boxSelected" : ""].filter(Boolean).join(" ")}
				@click=${this._handleClick}
				style="cursor: ${this.disabled ? "not-allowed" : "pointer"}"
			>
				<div class="round"></div>
			</div>
		`;
    }
    _handleClick() {
      if (this.disabled) return;
      const newValue = this.checked === true ? false : true;
      this.checked = newValue;
      this.dispatchEvent(new CustomEvent("change", {
        detail: newValue,
        bubbles: true,
        composed: true
      }));
    }
  };
  exports.FFBoxRadio.styles = i$6`
		:host {
			display: inline-block;
			font-size: 0; /* 纯 HTML 状态下，代码中的换行会被渲染出来，需要设置为 0 来屏蔽 */
		}

		// :host([data-theme="dark"]) {
		// 	outline: red 1px solid;	// 测试 theme 响应
		// }

		.box {
			position: relative;
			box-sizing: border-box;
			width: 20px;
			height: 20px;
			display: inline-block;
			background-color: hwb(var(--bg98) / 0.8);
			border: hwb(0 80% 20%) 1px solid;
			border-radius: 10px;
			box-shadow: 0 2px 2px hwb(0 80% 20% / 0.2);
		}

		:host([disabled]) .box {
			cursor: not-allowed;
		}

		.round {
			position: absolute;
			left: 5px;
			top: 5px;
			width: 10px;
			height: 10px;
			border-radius: 5px;
			background-color: transparent;
		}

		.boxSelected {
			background-color: hwb(220 25% 10%);
			border: none;
			box-shadow: 0 2px 4px hwb(220 25% 10% / 0.2);
		}

		.boxSelected .round {
			background-color: #FFF;
		}
	`;
  __decorateClass$d([
    n$4({
      reflect: true,
      converter: {
        fromAttribute: (value) => {
          if (value === null || value === "false") return false;
          if (value === "" || value === "true") return true;
          return value;
        },
        toAttribute: (value) => {
          if (value === false) return null;
          if (value === true) return "";
          return value;
        }
      }
    })
  ], exports.FFBoxRadio.prototype, "checked", 2);
  __decorateClass$d([
    n$4({ type: Boolean, reflect: true })
  ], exports.FFBoxRadio.prototype, "disabled", 2);
  __decorateClass$d([
    c$1({ context: themeContext, subscribe: true }),
    n$4({ reflect: true, attribute: "data-theme" })
  ], exports.FFBoxRadio.prototype, "theme", 2);
  exports.FFBoxRadio = __decorateClass$d([
    t$3("ffbox-radio")
  ], exports.FFBoxRadio);
  var __defProp$c = Object.defineProperty;
  var __getOwnPropDesc$c = Object.getOwnPropertyDescriptor;
  var __decorateClass$c = (decorators, target, key, kind) => {
    var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc$c(target, key) : target;
    for (var i2 = decorators.length - 1, decorator; i2 >= 0; i2--)
      if (decorator = decorators[i2])
        result = (kind ? decorator(target, key, result) : decorator(result)) || result;
    if (kind && result) __defProp$c(target, key, result);
    return result;
  };
  exports.FFBoxRockerSwitch = class FFBoxRockerSwitch extends i$3 {
    constructor() {
      super(...arguments);
      this.size = "s";
      this.disabledLeft = false;
      this.disabledRight = false;
      this.theme = "light";
    }
    render() {
      return b`
			<div class="rockerSwitch">
				<div class="buttonWrapper">
					<button class="arrow arrowLeft" ?disabled=${this.disabledLeft} @click=${this._goLeft}>&#9664;</button>
					<button class="arrow arrowRight" ?disabled=${this.disabledRight} @click=${this._goRight}>&#9654;</button>
				</div>
				<span class="label"><slot></slot></span>
			</div>
		`;
    }
    _goLeft() {
      if (this.disabledLeft) return;
      this.dispatchEvent(new CustomEvent("left", { bubbles: true, composed: true }));
    }
    _goRight() {
      if (this.disabledRight) return;
      this.dispatchEvent(new CustomEvent("right", { bubbles: true, composed: true }));
    }
  };
  exports.FFBoxRockerSwitch.styles = i$6`
		:host {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			isolation: isolate;
			opacity: 0.7;
		}

		// :host([data-theme="dark"]) {
		// 	outline: red 1px solid;	// 测试 theme 响应
		// }

		.rockerSwitch {
			position: relative;
			// height: 取决于尺寸;
			// flex: 0 0 auto;
			display: flex;
			align-items: center;
			justify-content: center;
			isolation: isolate;
			opacity: 0.7;
		}

		.buttonWrapper {
			position: absolute;
			width: 100%;
			height: 100%;
			display: flex;
			align-items: center;
			justify-content: stretch;
			z-index: -1;
			-webkit-mask-image: linear-gradient(to right, black 25%, transparent 50%, black 75%);
		}

		.arrow {
			flex: 1 1 auto;
			margin: 0 4px;
			border: none;
			background: none;
			color: inherit;
			border-radius: 4px;
			line-height: 1;
			cursor: pointer;
			font-family: inherit;
		}

		.arrow:hover:not(:disabled) {
			background-color: hwb(var(--bg99) / 0.4);
			box-shadow:
				0 1px 4px hwb(var(--hoverShadow) / 0.2),
				0 4px 2px -2px hwb(var(--highlight) / 0.5) inset;
		}

		.arrow:active:not(:disabled) {
			box-shadow:
				0 0px 1px hwb(var(--hoverShadow) / 0.2),
				0 20px 15px -10px hwb(var(--hoverShadow) / 0.15) inset;
			transform: translateY(0.25px);
		}

		.arrow:disabled {
			opacity: 0.3;
			cursor: default;
		}

		.arrowLeft { text-align: left; }
		.arrowRight { text-align: right; }

		.label {
			pointer-events: none;
		}

		/* Size: s */
		:host([size="s"]) .rockerSwitch { height: 30px; }
		:host([size="s"]) .arrow { height: 22px; font-size: 12px; }
		:host([size="s"]) .label { font-size: 12px; padding: 0 26px; }

		/* Size: m */
		:host([size="m"]) .rockerSwitch { height: 35px; }
		:host([size="m"]) .arrow { height: 26px; font-size: 13.5px; }
		:host([size="m"]) .label { font-size: 13.5px; padding: 0 30px; }
	`;
  __decorateClass$c([
    n$4({ reflect: true })
  ], exports.FFBoxRockerSwitch.prototype, "size", 2);
  __decorateClass$c([
    n$4({ type: Boolean, attribute: "disabled-left" })
  ], exports.FFBoxRockerSwitch.prototype, "disabledLeft", 2);
  __decorateClass$c([
    n$4({ type: Boolean, attribute: "disabled-right" })
  ], exports.FFBoxRockerSwitch.prototype, "disabledRight", 2);
  __decorateClass$c([
    c$1({ context: themeContext, subscribe: true }),
    n$4({ reflect: true, attribute: "data-theme" })
  ], exports.FFBoxRockerSwitch.prototype, "theme", 2);
  exports.FFBoxRockerSwitch = __decorateClass$c([
    t$3("ffbox-rocker-switch")
  ], exports.FFBoxRockerSwitch);
  var __defProp$b = Object.defineProperty;
  var __getOwnPropDesc$b = Object.getOwnPropertyDescriptor;
  var __decorateClass$b = (decorators, target, key, kind) => {
    var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc$b(target, key) : target;
    for (var i2 = decorators.length - 1, decorator; i2 >= 0; i2--)
      if (decorator = decorators[i2])
        result = (kind ? decorator(target, key, result) : decorator(result)) || result;
    if (kind && result) __defProp$b(target, key, result);
    return result;
  };
  exports.FFBoxSlider = class FFBoxSlider extends i$3 {
    constructor() {
      super(...arguments);
      this.min = 0;
      this.max = 1;
      this.useIEC = false;
      this.theme = "light";
    }
    get _sortedTags() {
      if (this._tagsRef !== this.tags) {
        this._tagsRef = this.tags;
        if (this.tags instanceof Map) {
          this._sortedTagsCache = [...this.tags.entries()].sort((a2, b2) => a2[0] - b2[0]);
        } else if (Array.isArray(this.tags)) {
          this._sortedTagsCache = [...this.tags].sort((a2, b2) => a2[0] - b2[0]);
        } else {
          this._sortedTagsCache = void 0;
        }
      }
      return this._sortedTagsCache;
    }
    get _numericalValue() {
      var _a2;
      if (typeof this.value === "string") {
        if ((_a2 = this._sortedTags) == null ? void 0 : _a2.length) {
          const item = this._sortedTags.find((item2) => item2[1] === this.value);
          return item == null ? void 0 : item[0];
        }
        return void 0;
      } else {
        return this.value;
      }
    }
    get _limitedValue() {
      if (typeof this._numericalValue === "number") {
        return (this._numericalValue - this.min) / (this.max - this.min);
      }
      return 0;
    }
    _valueToDisplayConverter(setting) {
      var _a2;
      if (setting instanceof Function) {
        return setting(this.value);
      } else if (setting) {
        if (setting.type === "bitrate") {
          const bps = Math.round((setting.base ?? 0) * 2 ** this.value);
          if (this.useIEC) {
            if (bps >= 10 * 1024 ** 2) {
              return (bps / 1024 ** 2).toFixed(1) + " Mibps";
            } else {
              return (bps / 1024).toFixed(0) + " kibps";
            }
          } else {
            if (bps >= 10 * 1e3 ** 2) {
              return (bps / 1e3 ** 2).toFixed(1) + " Mbps";
            } else {
              return (bps / 1e3).toFixed(0) + " Kbps";
            }
          }
        } else if (setting.type === "integer") {
          return this.value.toFixed(0);
        } else if (setting.type === "revertInteger") {
          return (this.max - this.value).toFixed(0);
        } else {
          return String(this.value ?? "");
        }
      } else {
        if (this.mode === "string") {
          if ((_a2 = this._sortedTags) == null ? void 0 : _a2.length) {
            const numVal = this._numericalValue;
            if (numVal !== void 0) {
              const item2 = this._sortedTags.find((item3) => item3[0] === numVal);
              if (item2) return item2[1];
            }
            const item = this._sortedTags.find((item2) => item2[1] === this.value);
            if (item) return item[1];
          }
        }
        return String(this.value ?? "");
      }
    }
    render() {
      var _a2;
      const limitedPct = Math.max(0, this._limitedValue * 100);
      const slipperLeft = this._limitedValue * 100;
      return b`
			<div class="slider">
				<div class="slider-module" @mousedown=${this._handleDragStart} @touchstart=${this._handleDragStart}>
					<div class="slider-module-track"></div>
					<div class="slider-module-track-background" style="width: ${limitedPct}%"></div>
					${(_a2 = this._sortedTags) == null ? void 0 : _a2.map(([tagValue, tagLabel]) => {
        const left = (tagValue - this.min) / (this.max - this.min) * 100;
        return b`<span class="slider-module-mark" style="left: ${left}%">${tagLabel}</span>`;
      })}
					${this.value !== void 0 ? b`
						<button
							class="slider-module-slipper"
							style="left: ${slipperLeft}%"
							@keydown=${this._handleKeydown}
							aria-label="滑块"
						></button>
					` : ""}
				</div>
				<div class="slider-text">${this._valueToDisplayConverter(this.valueToDisplay)}</div>
			</div>
		`;
    }
    _emitNewValue(realValue) {
      var _a2;
      const clamped = Math.max(this.min, Math.min(this.max, realValue));
      let emitValue;
      if (this.mode === "string") {
        if ((_a2 = this._sortedTags) == null ? void 0 : _a2.length) {
          const item = this._sortedTags.find((item2) => item2[0] === clamped);
          emitValue = (item == null ? void 0 : item[1]) ?? clamped;
        } else {
          emitValue = clamped;
        }
      } else {
        emitValue = clamped;
      }
      this.value = emitValue;
      this.dispatchEvent(new CustomEvent("change", {
        detail: emitValue,
        bubbles: true,
        composed: true
      }));
    }
    _adsorb(realValue) {
      var _a2, _b, _c;
      if (this.adsorption === "int") {
        return Math.round(realValue);
      } else if (this.adsorption === "tags") {
        if ((_a2 = this._sortedTags) == null ? void 0 : _a2.length) {
          let minDist = Number.MAX_VALUE;
          let closest = realValue;
          for (const [tagValue] of this._sortedTags) {
            const dist = Math.abs(realValue - tagValue);
            if (dist <= minDist) {
              minDist = dist;
              closest = tagValue;
            }
          }
          return closest;
        }
        return realValue;
      } else if (typeof this.adsorption === "function") {
        return this.adsorption(realValue);
      } else if (this.mode === "string") {
        if ((_b = this._sortedTags) == null ? void 0 : _b.length) {
          let minDist = Number.MAX_VALUE;
          let closest = realValue;
          for (const [tagValue] of this._sortedTags) {
            const dist = Math.abs(realValue - tagValue);
            if (dist <= minDist) {
              minDist = dist;
              closest = tagValue;
            }
          }
          return closest;
        }
        return realValue;
      } else if ((_c = this._sortedTags) == null ? void 0 : _c.length) {
        const range = this.max - this.min;
        const threshold = 0.01 * range;
        for (const [tagValue] of this._sortedTags) {
          if (Math.abs(tagValue - realValue) < threshold) {
            realValue = tagValue;
          }
        }
        return realValue;
      }
      return realValue;
    }
    _handleDragStart(event) {
      event.preventDefault();
      const mouseDownX = event.pageX ?? event.touches[0].pageX;
      const target = event.target;
      let sliderLeft, sliderWidth, slipperOffsetX;
      const isSlipper = target.classList.contains("slider-module-slipper");
      if (isSlipper) {
        sliderLeft = target.parentElement.getBoundingClientRect().left;
        sliderWidth = target.parentElement.offsetWidth;
        slipperOffsetX = event.offsetX - target.offsetWidth / 2;
        target.focus();
      } else {
        sliderLeft = target.getBoundingClientRect().left;
        sliderWidth = target.offsetWidth;
        slipperOffsetX = 0;
      }
      let lastValue = NaN;
      const handleMouseMove = (e2) => {
        var _a2, _b;
        const pageX = e2.pageX ?? ((_b = (_a2 = e2.touches) == null ? void 0 : _a2[0]) == null ? void 0 : _b.pageX) ?? mouseDownX;
        let limitedValue = (Math.floor(pageX) - sliderLeft - slipperOffsetX) / sliderWidth;
        limitedValue = Math.max(0, Math.min(1, limitedValue));
        const range = this.max - this.min;
        let realValue = this.min + range * limitedValue;
        realValue = range <= 1 ? Number(realValue.toFixed(6)) : Number(realValue.toFixed(3));
        realValue = this._adsorb(realValue);
        if (realValue !== lastValue) {
          this._emitNewValue(realValue);
          lastValue = realValue;
        }
      };
      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.removeEventListener("touchmove", handleMouseMove);
        document.removeEventListener("touchend", handleMouseUp);
      };
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.addEventListener("touchmove", handleMouseMove);
      document.addEventListener("touchend", handleMouseUp);
      handleMouseMove({ pageX: mouseDownX });
    }
    _handleKeydown(event) {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        const originalValue = this._numericalValue ?? (this.max + this.min) / 2;
        const range = this.max - this.min;
        const delta = this.arrowKeyStep ? range / this.arrowKeyStep : 1;
        let newRealValue = Number((originalValue + direction * delta).toFixed(6));
        newRealValue = Math.max(this.min, Math.min(this.max, newRealValue));
        this._emitNewValue(newRealValue);
      }
    }
  };
  exports.FFBoxSlider.styles = i$6`
		:host {
			display: block;
		}

		.slider {
			position: relative;
			flex-grow: 1;
			height: 56px;
			display: flex;
			align-items: center;
		}

		.slider-module {
			position: relative;
			flex-grow: 1;
			height: 100%;
			margin: 0 16px;
			font-size: 14px;
		}

		.slider-module-track {
			position: absolute;
			top: 17px;
			width: 100%;
			height: 6px;
			border-radius: 8px;
			box-shadow: 0px 2px 2px 0px rgba(0, 0, 0, 0.15) inset;
		}

		.slider-module-track-background {
			position: absolute;
			top: 17px;
			height: 6px;
			background: #49e;
			border-radius: 8px;
			box-shadow: 0px 2px 2px 0px rgba(0, 0, 0, 0.15) inset;
			pointer-events: none;
		}

		.slider-module-slipper {
			position: absolute;
			top: 4px;
			transform: translateX(-50%);
			width: 18px;
			height: 30px;
			background: linear-gradient(180deg, #fefefe, #f0f0f0);
			border-radius: 4px;
			box-shadow: 0px 2px 2px 0px rgba(0, 0, 0, 0.2);
			border: none;
			outline: none;
		}

		.slider-module-slipper:hover {
			background: linear-gradient(180deg, #ffffff, #fefefe);
		}

		.slider-module-slipper:active {
			background: linear-gradient(180deg, #f0f0f0, #ededed);
		}

		.slider-module-mark {
			position: absolute;
			bottom: 0px;
			transform: translateX(-50%);
			width: max-content;
			font-size: 10px;
			text-align: center;
			opacity: 0.7;
			pointer-events: none;
		}

		.slider-module-mark::before {
			content: "";
			position: absolute;
			left: calc(50% - 2px);
			top: -8px;
			width: 4px;
			height: 4px;
			border-radius: 4px;
			box-shadow: 0px 1px 1px 0px rgba(0, 0, 0, 0.2) inset;
			z-index: -10;
		}

		.slider-text {
			width: 88px;
			font-size: 14px;
			text-align: center;
		}

		:host([data-theme="light"]) .slider-module-track {
			background: #FFF;
		}
		:host([data-theme="light"]) .slider-module-mark::before {
			background: #FFF;
		}

		:host([data-theme="dark"]) .slider-module-track {
			background: #444;
		}
		:host([data-theme="dark"]) .slider-module-mark::before {
			background: #777;
		}
	`;
  exports.FFBoxSlider._numberOrStringConverter = {
    fromAttribute(value) {
      if (value === null) return void 0;
      const num = Number(value);
      return isNaN(num) ? value : num;
    },
    toAttribute(value) {
      return (value == null ? void 0 : value.toString()) ?? null;
    }
  };
  __decorateClass$b([
    n$4({ reflect: true, converter: exports.FFBoxSlider._numberOrStringConverter })
  ], exports.FFBoxSlider.prototype, "value", 2);
  __decorateClass$b([
    n$4({ type: Number })
  ], exports.FFBoxSlider.prototype, "min", 2);
  __decorateClass$b([
    n$4({ type: Number })
  ], exports.FFBoxSlider.prototype, "max", 2);
  __decorateClass$b([
    n$4({ type: Number })
  ], exports.FFBoxSlider.prototype, "arrowKeyStep", 2);
  __decorateClass$b([
    n$4()
  ], exports.FFBoxSlider.prototype, "adsorption", 2);
  __decorateClass$b([
    n$4({ attribute: false })
  ], exports.FFBoxSlider.prototype, "tags", 2);
  __decorateClass$b([
    n$4()
  ], exports.FFBoxSlider.prototype, "mode", 2);
  __decorateClass$b([
    n$4({ attribute: false })
  ], exports.FFBoxSlider.prototype, "valueToDisplay", 2);
  __decorateClass$b([
    n$4({ type: Boolean, attribute: false })
  ], exports.FFBoxSlider.prototype, "useIEC", 2);
  __decorateClass$b([
    c$1({ context: themeContext, subscribe: true }),
    n$4({ reflect: true, attribute: "data-theme" })
  ], exports.FFBoxSlider.prototype, "theme", 2);
  exports.FFBoxSlider = __decorateClass$b([
    t$3("ffbox-slider")
  ], exports.FFBoxSlider);
  var __defProp$a = Object.defineProperty;
  var __getOwnPropDesc$a = Object.getOwnPropertyDescriptor;
  var __decorateClass$a = (decorators, target, key, kind) => {
    var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc$a(target, key) : target;
    for (var i2 = decorators.length - 1, decorator; i2 >= 0; i2--)
      if (decorator = decorators[i2])
        result = (kind ? decorator(target, key, result) : decorator(result)) || result;
    if (kind && result) __defProp$a(target, key, result);
    return result;
  };
  exports.FFBoxNormalInput = class FFBoxNormalInput extends i$3 {
    constructor() {
      super(...arguments);
      this.value = "";
      this.type = "text";
      this.disabled = false;
      this.placeholder = "";
      this.theme = "light";
      this._focused = false;
    }
    willUpdate(changed) {
      if (changed.has("value") || changed.has("validator")) {
        this._validate(this.value);
      }
    }
    render() {
      const classes = ["inputbox-selector"];
      if (this._focused) classes.push("focused");
      if (this._invalidMsg) classes.push("invalid");
      return b`
			<div class=${classes.join(" ")}>
				<input
					.type=${this.type}
					?disabled=${this.disabled}
					.value=${this.value}
					.placeholder=${this.placeholder}
					@blur=${this._handleBlur}
					@focus=${this._handleFocus}
					@input=${this._handleInput}
					@keydown=${this._handleKeydown}
				/>
			</div>
		`;
    }
    _handleBlur() {
      this._focused = false;
      this.requestUpdate();
    }
    _handleFocus(e2) {
      const input = e2.target;
      input.selectionEnd = input.selectionStart;
      this._focused = true;
      this.requestUpdate();
    }
    _handleInput(e2) {
      const input = e2.target;
      let newValue = input.value;
      if (this.inputFixer) {
        newValue = this.inputFixer(newValue);
      }
      this.value = newValue;
      this._validate(newValue);
      this.dispatchEvent(new CustomEvent("change", {
        detail: newValue,
        bubbles: true,
        composed: true
      }));
    }
    _handleKeydown(e2) {
      if (e2.key === "Enter") {
        this.dispatchEvent(new CustomEvent("enter", {
          bubbles: true,
          composed: true
        }));
      }
    }
    _validate(value) {
      if (this.validator) {
        this._invalidMsg = this.validator(value);
      } else {
        this._invalidMsg = void 0;
      }
    }
  };
  exports.FFBoxNormalInput.styles = i$6`
		:host {
			display: inline-block;
		}

		.inputbox-selector {
			position: relative;
			height: 24px;
			flex-grow: 1;
			margin: 15px 0;
			border-radius: 24px;
			background: var(--f7);
			border: #AAA 1px solid;
			box-shadow: 0px 4px 8px rgba(0, 0, 0, 0.1);
			transition: box-shadow 0.2s linear, border 0.2s linear;
		}

		.inputbox-selector:hover {
			background: var(--ff);
		}

		// 这个其实会被 .focused 覆盖，Vue 那边一直有这个问题，而且是通过 style 而不是 class 控制的，代码上没这边好懂
		.inputbox-selector:active {
			background: var(--e7);
		}

		.inputbox-selector.focused {
			background: var(--ff);
		}

		.inputbox-selector.invalid {
			border: var(--errorBorder) 1px solid;
			box-shadow: 0 0 12px hsla(0, 100%, 60%, 0.3), 0px 4px 8px rgba(0, 0, 0, 0.05);
		}

		.inputbox-selector.invalid.focused {
			background: var(--errorBgActive);
		}

		.inputbox-selector.invalid:not(.focused) {
			background: var(--errorBg);
		}

		:host([disabled]) .inputbox-selector {
			opacity: 0.6;
			color: var(--66);
			background: var(--f7);
		}

		.inputbox-selector input {
			position: absolute;
			left: 6px;
			width: calc(100% - 12px);
			height: 24px;
			line-height: 24px;
			background: none;
			border: none;
			margin: 0;
			padding: 0;
			outline: none;
			font-family: inherit;
			font-size: 13px;
			color: inherit;
		}

		.inputbox-selector input::placeholder {
			font-size: 13px;
			opacity: 0.1;
			font-style: italic;
			transition: opacity 0.15s linear;
		}

		.inputbox-selector input:hover::placeholder {
			font-size: 13px;
			opacity: 0.25;
		}
	`;
  __decorateClass$a([
    n$4({ reflect: true })
  ], exports.FFBoxNormalInput.prototype, "value", 2);
  __decorateClass$a([
    n$4({ reflect: true })
  ], exports.FFBoxNormalInput.prototype, "type", 2);
  __decorateClass$a([
    n$4({ type: Boolean, reflect: true })
  ], exports.FFBoxNormalInput.prototype, "disabled", 2);
  __decorateClass$a([
    n$4()
  ], exports.FFBoxNormalInput.prototype, "placeholder", 2);
  __decorateClass$a([
    n$4({ attribute: false })
  ], exports.FFBoxNormalInput.prototype, "validator", 2);
  __decorateClass$a([
    n$4({ attribute: false })
  ], exports.FFBoxNormalInput.prototype, "inputFixer", 2);
  __decorateClass$a([
    c$1({ context: themeContext, subscribe: true }),
    n$4({ reflect: true, attribute: "data-theme" })
  ], exports.FFBoxNormalInput.prototype, "theme", 2);
  exports.FFBoxNormalInput = __decorateClass$a([
    t$3("ffbox-normal-input")
  ], exports.FFBoxNormalInput);
  var __defProp$9 = Object.defineProperty;
  var __getOwnPropDesc$9 = Object.getOwnPropertyDescriptor;
  var __decorateClass$9 = (decorators, target, key, kind) => {
    var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc$9(target, key) : target;
    for (var i2 = decorators.length - 1, decorator; i2 >= 0; i2--)
      if (decorator = decorators[i2])
        result = (kind ? decorator(target, key, result) : decorator(result)) || result;
    if (kind && result) __defProp$9(target, key, result);
    return result;
  };
  exports.FFBoxInputAutoSize = class FFBoxInputAutoSize extends i$3 {
    constructor() {
      super(...arguments);
      this.value = "";
      this.focusOnMounted = false;
      this.theme = "light";
      this._inputWidth = 8;
    }
    connectedCallback() {
      super.connectedCallback();
      this._resizeObserver = new ResizeObserver(() => {
        this._refreshSize();
      });
    }
    firstUpdated() {
      if (this._hiddenDivEl && this._resizeObserver) {
        this._resizeObserver.observe(this._hiddenDivEl);
        this._hiddenDivEl.style.fontFamily = getComputedStyle(this._inputEl).fontFamily;
      }
      if (this.focusOnMounted && this._inputEl) {
        this._inputEl.focus();
      }
    }
    disconnectedCallback() {
      var _a2;
      (_a2 = this._resizeObserver) == null ? void 0 : _a2.disconnect();
      super.disconnectedCallback();
    }
    _refreshSize() {
      var _a2;
      const rect = (_a2 = this._hiddenDivEl) == null ? void 0 : _a2.getBoundingClientRect();
      if (rect) {
        this._inputWidth = Math.max(8, rect.width);
        this.requestUpdate();
      }
    }
    render() {
      return b`
			<div>
				<input
					type="text"
					.value=${this.value}
					style=${`width: ${this._inputWidth}px`}
					@keydown=${this._handleKeydown}
					@input=${this._handleInput}
					@blur=${this._handleBlur}
					@change=${this._handleChange}
				/>
				<div class="hidden-div">${this.value}</div>
			</div>
		`;
    }
    _handleInput(e2) {
      this.value = e2.target.value;
    }
    _handleKeydown(e2) {
      if (e2.key === "Enter") {
        this.dispatchEvent(new CustomEvent("press-enter", {
          detail: this.value,
          bubbles: true,
          composed: true
        }));
      }
    }
    _handleBlur(e2) {
      e2.stopPropagation();
      this.dispatchEvent(new CustomEvent("blur", {
        detail: this.value,
        bubbles: true,
        composed: true
      }));
    }
    _handleChange(e2) {
      e2.stopPropagation();
      this.dispatchEvent(new CustomEvent("change", {
        detail: this.value,
        bubbles: true,
        composed: true
      }));
    }
  };
  exports.FFBoxInputAutoSize.styles = i$6`
		:host {
			display: inline-block;
		}

		.hidden-div {
			display: inline-block;
			position: fixed;
			visibility: hidden;
			font-size: inherit;
		}

		input {
			font-size: inherit;
			font-family: inherit;
		}
	`;
  __decorateClass$9([
    n$4({ reflect: true })
  ], exports.FFBoxInputAutoSize.prototype, "value", 2);
  __decorateClass$9([
    n$4({ type: Boolean, attribute: "focus-on-mounted" })
  ], exports.FFBoxInputAutoSize.prototype, "focusOnMounted", 2);
  __decorateClass$9([
    c$1({ context: themeContext, subscribe: true }),
    n$4({ reflect: true, attribute: "data-theme" })
  ], exports.FFBoxInputAutoSize.prototype, "theme", 2);
  __decorateClass$9([
    e$4("input")
  ], exports.FFBoxInputAutoSize.prototype, "_inputEl", 2);
  __decorateClass$9([
    e$4(".hidden-div")
  ], exports.FFBoxInputAutoSize.prototype, "_hiddenDivEl", 2);
  exports.FFBoxInputAutoSize = __decorateClass$9([
    t$3("ffbox-input-auto-size")
  ], exports.FFBoxInputAutoSize);
  var __defProp$8 = Object.defineProperty;
  var __getOwnPropDesc$8 = Object.getOwnPropertyDescriptor;
  var __decorateClass$8 = (decorators, target, key, kind) => {
    var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc$8(target, key) : target;
    for (var i2 = decorators.length - 1, decorator; i2 >= 0; i2--)
      if (decorator = decorators[i2])
        result = (kind ? decorator(target, key, result) : decorator(result)) || result;
    if (kind && result) __defProp$8(target, key, result);
    return result;
  };
  exports.FFBoxControlBox = class FFBoxControlBox extends i$3 {
    constructor() {
      super(...arguments);
      this.title = "";
      this.description = "";
      this.long = false;
      this.optional = false;
      this.hasValue = false;
      this.theme = "light";
    }
    render() {
      return b`
			<div class="controlBox">
				${this.optional ? b`<ffbox-checkbox
						.checked=${this.hasValue}
						@change=${this._handleCheckboxChange}
					></ffbox-checkbox>` : ""}
				<div
					class="controlBox-title"
					title=${this.description}
				>
					${this.title}
				</div>
				<slot></slot>
			</div>
		`;
    }
    _handleCheckboxChange(e2) {
      this.hasValue = e2.detail;
      this.dispatchEvent(new CustomEvent("enabledChange", {
        detail: e2.detail,
        bubbles: true,
        composed: true
      }));
    }
  };
  exports.FFBoxControlBox.styles = i$6`
		:host {
			display: block;
			width: 210px;
			margin: 4px 20px;
			margin-right: 28px;
		}
		:host([long]) {
			width: 100%;
		}
		:host(:not([long])[optional]),
		:host([long]:not([optional])) {
			margin-right: 20px;
		}
		:host([long][optional]) {
			margin-right: 8px;
		}

		.controlBox {
			height: 56px;
			width: 100%;
			display: flex;
			justify-content: space-between;
			align-items: center;
			gap: 4px;
		}

		.controlBox-title {
			min-width: 88px;
			font-size: 14px;
			text-align: center;
		}

		:host([optional]:not([has-value])) .controlBox-title {
			opacity: 0.5;
		}
	`;
  __decorateClass$8([
    n$4({ reflect: true })
  ], exports.FFBoxControlBox.prototype, "title", 2);
  __decorateClass$8([
    n$4({ reflect: true })
  ], exports.FFBoxControlBox.prototype, "description", 2);
  __decorateClass$8([
    n$4({ type: Boolean, reflect: true })
  ], exports.FFBoxControlBox.prototype, "long", 2);
  __decorateClass$8([
    n$4({ type: Boolean, reflect: true })
  ], exports.FFBoxControlBox.prototype, "optional", 2);
  __decorateClass$8([
    n$4({ type: Boolean, reflect: true, attribute: "has-value" })
  ], exports.FFBoxControlBox.prototype, "hasValue", 2);
  __decorateClass$8([
    c$1({ context: themeContext, subscribe: true }),
    n$4({ reflect: true, attribute: "data-theme" })
  ], exports.FFBoxControlBox.prototype, "theme", 2);
  exports.FFBoxControlBox = __decorateClass$8([
    t$3("ffbox-control-box")
  ], exports.FFBoxControlBox);
  const closeIcon$1 = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="48" height="48"><path d="M743.2 701.21a37.84 37.84 0 0 1-0.39 52.88l5.51-5.51a36.5 36.5 0 0 1-52.19-0.3L281.64 322.79a37.84 37.84 0 0 1 0.39-52.88l-5.5 5.51a36.5 36.5 0 0 1 52.19 0.3z" fill="currentColor"></path><path d="M701.21 284.3a37.84 37.84 0 0 1 52.88 0.39l-5.51-5.51a36.5 36.5 0 0 1-0.3 52.19L322.79 745.86a37.84 37.84 0 0 1-52.88-0.39l5.51 5.51a36.5 36.5 0 0 1 0.3-52.19z" fill="currentColor"></path></svg>';
  var __defProp$7 = Object.defineProperty;
  var __getOwnPropDesc$7 = Object.getOwnPropertyDescriptor;
  var __decorateClass$7 = (decorators, target, key, kind) => {
    var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc$7(target, key) : target;
    for (var i2 = decorators.length - 1, decorator; i2 >= 0; i2--)
      if (decorator = decorators[i2])
        result = (kind ? decorator(target, key, result) : decorator(result)) || result;
    if (kind && result) __defProp$7(target, key, result);
    return result;
  };
  exports.FFBoxRadioList = class FFBoxRadioList extends i$3 {
    constructor() {
      super(...arguments);
      this.list = [];
      this.value = "";
      this.placeholder = "";
      this.theme = "light";
      this._editingIndex = -1;
    }
    render() {
      return b`
			<div class="radioList">
				${this.list.map((item, index) => this._renderItem(item, index))}
			</div>
		`;
    }
    _renderItem(item, index) {
      const isSelected = item.value === this.value;
      const isDisabled = item.disabled;
      const isEditing = this._editingIndex === index;
      const classes = ["item"];
      if (isSelected) classes.push("itemSelected");
      if (isDisabled) classes.push("itemDisabled");
      const label = item.caption || (item.value === "" ? this.placeholder : item.value);
      const isEmpty = item.value === "";
      return b`
			<button
				class=${classes.join(" ")}
				@mousedown=${(e2) => this._handleItemClick(e2, item, index)}
			>
				${isEditing ? b`<ffbox-input-auto-size
						class="editingInput"
						focus-on-mounted
						.value=${item.value}
						@blur=${(e2) => this._handleEditConfirm(item, e2.detail, index)}
						@press-enter=${(_e) => this._editingIndex = -1}
						@change=${(e2) => e2.stopPropagation()}
					></ffbox-input-auto-size>` : b`<span
						class=${["itemLabel", isEmpty ? "itemLabelEmpty" : ""].filter(Boolean).join(" ")}
						@click=${(e2) => this._handleLabelClick(e2, item, index)}
					>${label}</span>`}
				${item.deletable && !isEditing ? b`<button
						class="itemDelete"
						aria-label="删除此项"
						@click=${(e2) => this._handleDelete(e2, item, index)}
					>${o$3(closeIcon$1)}</button>` : A}
			</button>
		`;
    }
    _handleItemClick(_e, item, index) {
      if (this._editingIndex !== -1) return;
      if (item.value !== this.value) {
        this.value = item.value;
        this.dispatchEvent(new CustomEvent("change", {
          detail: { value: item.value, index },
          bubbles: true,
          composed: true
        }));
      }
    }
    _handleLabelClick(e2, item, index) {
      if (item.editable && item.caption == null) {
        e2.stopPropagation();
        this._editingIndex = index;
      }
    }
    _handleEditConfirm(item, newValue, index) {
      this._editingIndex = -1;
      this.dispatchEvent(new CustomEvent("edit", {
        detail: { oldValue: item.value, newValue, index },
        bubbles: true,
        composed: true
      }));
    }
    _handleDelete(e2, item, index) {
      e2.stopImmediatePropagation();
      this.dispatchEvent(new CustomEvent("delete", {
        detail: { value: item.value, index },
        bubbles: true,
        composed: true
      }));
    }
  };
  exports.FFBoxRadioList.styles = i$6`
		:host {
			display: block;
		}

		.radioList {
			display: flex;
			flex-direction: column;
			flex-wrap: wrap;
			justify-content: center;
			align-content: center;
			box-sizing: border-box;
			height: 100%;
			min-height: 120px;
			padding: 16px;
			gap: 6px;
			isolation: isolate;
		}

		.item {
			height: 30px;
			box-sizing: border-box;
			padding: 0 23px 0 20px;
			position: relative;
			outline: none;
			border: none;
			font-size: 13px;
			line-height: 30px;
			white-space: nowrap;
			color: inherit;
			background-color: hwb(var(--bg99) / 0.8);
			border-radius: 4px;
			box-shadow: 0 0 1px 0.5px hwb(var(--highlight)),
						0 1.5px 3px 0 hwb(var(--hoverShadow) / 0.2);
			border-left: transparent 3px solid;
			transition: all 0.3s cubic-bezier(0, 1.5, 0.3, 1);
		}

		.item:not(.itemSelected):hover::after {
			content: '';
			position: absolute;
			top: 0;
			left: -3px;
			width: calc(100% + 3px);
			height: 100%;
			border-radius: inherit;
			box-shadow: 0 0 2px hwb(var(--hoverShadow) / 0.2);
			z-index: 1;
		}

		.itemSelected {
			background-color: hwb(var(--bg97) / 0.8);
			border-radius: 3px 4px 4px 3px;
			box-shadow: 0 0 2px 1px hwb(var(--hoverShadow) / 0.05),
						0 3px 6px hwb(var(--hoverShadow) / 0.1) inset;
			border-left: #49e 3px solid;
		}

		.itemDisabled {
			color: #77777777;
			pointer-events: none;
		}

		.itemLabel {
			user-select: none;
			-webkit-user-select: none;
		}

		.itemLabelEmpty {
			opacity: 0.5;
		}

		.itemDelete {
			position: absolute;
			top: 0;
			right: 0;
			height: 100%;
			width: 20px;
			border: none;
			border-radius: 0 4px 4px 0;
			outline: none;
			background: none;
			padding: 0;
			display: flex;
			justify-content: center;
			align-items: center;
			opacity: 0.5;
			z-index: 2;
			user-select: none;
		}

		.itemDelete:hover {
			box-shadow: 0 0 3px hwb(var(--hoverShadow) / 0.1);
			background: hwb(var(--hoverLightBg) / 0.5);
			opacity: 1;
		}

		.itemDelete:active {
			box-shadow: 0 0 2px 1px hwb(var(--hoverShadow) / 0.05),
						0 6px 12px hwb(var(--hoverShadow) / 0.15) inset;
			transform: translateY(0.5px);
		}

		.itemDelete svg {
			width: 16px;
		}

		.editingInput {
			margin: 0 -4px;
		}
	`;
  __decorateClass$7([
    n$4({ attribute: false })
  ], exports.FFBoxRadioList.prototype, "list", 2);
  __decorateClass$7([
    n$4({ reflect: true })
  ], exports.FFBoxRadioList.prototype, "value", 2);
  __decorateClass$7([
    n$4()
  ], exports.FFBoxRadioList.prototype, "placeholder", 2);
  __decorateClass$7([
    c$1({ context: themeContext, subscribe: true }),
    n$4({ reflect: true, attribute: "data-theme" })
  ], exports.FFBoxRadioList.prototype, "theme", 2);
  __decorateClass$7([
    r$2()
  ], exports.FFBoxRadioList.prototype, "_editingIndex", 2);
  exports.FFBoxRadioList = __decorateClass$7([
    t$3("ffbox-radio-list")
  ], exports.FFBoxRadioList);
  /**
   * @license
   * Copyright 2018 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   */
  const n$2 = "important", i = " !" + n$2, o$2 = e$1(class extends i$1 {
    constructor(t2) {
      var _a2;
      if (super(t2), t2.type !== t$1.ATTRIBUTE || "style" !== t2.name || ((_a2 = t2.strings) == null ? void 0 : _a2.length) > 2) throw Error("The `styleMap` directive must be used in the `style` attribute and must be the only part in the attribute.");
    }
    render(t2) {
      return Object.keys(t2).reduce((e2, r2) => {
        const s2 = t2[r2];
        return null == s2 ? e2 : e2 + `${r2 = r2.includes("-") ? r2 : r2.replace(/(?:^(webkit|moz|ms|o)|)(?=[A-Z])/g, "-$&").toLowerCase()}:${s2};`;
      }, "");
    }
    update(e2, [r2]) {
      const { style: s2 } = e2.element;
      if (void 0 === this.ft) return this.ft = new Set(Object.keys(r2)), this.render(r2);
      for (const t2 of this.ft) null == r2[t2] && (this.ft.delete(t2), t2.includes("-") ? s2.removeProperty(t2) : s2[t2] = null);
      for (const t2 in r2) {
        const e3 = r2[t2];
        if (null != e3) {
          this.ft.add(t2);
          const r3 = "string" == typeof e3 && e3.endsWith(i);
          t2.includes("-") || r3 ? s2.setProperty(t2, r3 ? e3.slice(0, -11) : e3, r3 ? n$2 : "") : s2[t2] = e3;
        }
      }
      return E;
    }
  });
  var __defProp$6 = Object.defineProperty;
  var __getOwnPropDesc$6 = Object.getOwnPropertyDescriptor;
  var __decorateClass$6 = (decorators, target, key, kind) => {
    var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc$6(target, key) : target;
    for (var i2 = decorators.length - 1, decorator; i2 >= 0; i2--)
      if (decorator = decorators[i2])
        result = (kind ? decorator(target, key, result) : decorator(result)) || result;
    if (kind && result) __defProp$6(target, key, result);
    return result;
  };
  exports.FFBoxAutoSizeWrapper = class FFBoxAutoSizeWrapper extends i$3 {
    constructor() {
      super(...arguments);
      this.useResizeObserver = false;
      this.theme = "light";
      this.width = 0;
      this.height = 0;
    }
    connectedCallback() {
      super.connectedCallback();
      if (!this._resizeObserver) {
        this._resizeObserver = new ResizeObserver(() => this._updateSize());
      }
    }
    firstUpdated() {
      requestAnimationFrame(() => this._updateSize());
      if (this.useResizeObserver) {
        this._observeSlot(true);
      }
    }
    updated(changed) {
      if (changed.has("useResizeObserver")) {
        this._observeSlot(this.useResizeObserver);
      }
    }
    disconnectedCallback() {
      this._observeSlot(false);
      super.disconnectedCallback();
    }
    _observeSlot(observe) {
      var _a2;
      const target = (_a2 = this._containerEl) == null ? void 0 : _a2.firstElementChild;
      if (!target || !this._resizeObserver) return;
      if (observe) {
        this._resizeObserver.observe(target);
      } else {
        this._resizeObserver.unobserve(target);
      }
    }
    /** 重新测量 slot 尺寸。外部在 slot 内容变化后也可主动调用 */
    updateSize() {
      this._updateSize();
    }
    _updateSize() {
      var _a2;
      const target = (_a2 = this._containerEl) == null ? void 0 : _a2.firstElementChild;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      this.width = rect.width;
      this.height = rect.height;
      this.dispatchEvent(new CustomEvent("resize", {
        detail: { width: this.width, height: this.height },
        bubbles: true,
        composed: true
      }));
    }
    render() {
      var _a2;
      return b`
			<div class="autoSizeWrapper" style=${o$2(((_a2 = this.customStyle) == null ? void 0 : _a2.call(this, { width: this.width, height: this.height })) || {})}>
				<div>
					<slot></slot>
				</div>
			</div>
		`;
    }
  };
  exports.FFBoxAutoSizeWrapper.styles = i$6`
		:host {
			display: block;
		}

		.autoSizeWrapper > div {
			/* 测量层：宽度撑满以便反映 slot 的真实高度，不做任何裁剪 */
			display: block;
		}
	`;
  __decorateClass$6([
    n$4({ type: Boolean, attribute: "use-resize-observer" })
  ], exports.FFBoxAutoSizeWrapper.prototype, "useResizeObserver", 2);
  __decorateClass$6([
    n$4({ attribute: false })
  ], exports.FFBoxAutoSizeWrapper.prototype, "customStyle", 2);
  __decorateClass$6([
    c$1({ context: themeContext, subscribe: true }),
    n$4({ reflect: true, attribute: "data-theme" })
  ], exports.FFBoxAutoSizeWrapper.prototype, "theme", 2);
  __decorateClass$6([
    r$2()
  ], exports.FFBoxAutoSizeWrapper.prototype, "width", 2);
  __decorateClass$6([
    r$2()
  ], exports.FFBoxAutoSizeWrapper.prototype, "height", 2);
  __decorateClass$6([
    e$4(".autoSizeWrapper")
  ], exports.FFBoxAutoSizeWrapper.prototype, "_containerEl", 2);
  exports.FFBoxAutoSizeWrapper = __decorateClass$6([
    t$3("ffbox-auto-size-wrapper")
  ], exports.FFBoxAutoSizeWrapper);
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
  var __defProp$5 = Object.defineProperty;
  var __getOwnPropDesc$5 = Object.getOwnPropertyDescriptor;
  var __decorateClass$5 = (decorators, target, key, kind) => {
    var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc$5(target, key) : target;
    for (var i2 = decorators.length - 1, decorator; i2 >= 0; i2--)
      if (decorator = decorators[i2])
        result = (kind ? decorator(target, key, result) : decorator(result)) || result;
    if (kind && result) __defProp$5(target, key, result);
    return result;
  };
  exports.FFBoxCutTimeInput = class FFBoxCutTimeInput extends i$3 {
    constructor() {
      super(...arguments);
      this.value = [void 0, void 0];
      this.disabled = false;
      this.theme = "light";
      this._inputText = [void 0, void 0];
      this._focused = [false, false];
    }
    /** 两个输入框任一校验不通过时的提示文本 */
    get _invalidMsg() {
      return durationValidator(this._inputText[0] ?? "") || durationValidator(this._inputText[1] ?? "");
    }
    get _selectorStyle() {
      const ret = {};
      if (this._invalidMsg) {
        ret.border = "var(--errorBorder) 1px solid";
        ret.boxShadow = "0 0 12px hsla(0, 100%, 60%, 0.3), 0px 4px 8px rgba(0, 0, 0, 0.05)";
        if (this._focused[0] || this._focused[1]) {
          ret.background = "var(--errorBgActive)";
        } else {
          ret.background = "var(--errorBg)";
        }
      } else {
        if (this._focused[0] || this._focused[1]) {
          ret.background = "var(--ff)";
        }
      }
      if (this.disabled) {
        ret.opacity = "0.6";
        ret.color = "var(--66)";
        ret.background = "var(--f7)";
      }
      return ret;
    }
    // 监听 value，并在其更新时依此更新内部 inputText（与输入框双向绑定）
    willUpdate(changed) {
      if (changed.has("value")) {
        const [from, to] = this.value ?? [void 0, void 0];
        if (this._inputText[0] !== from || this._inputText[1] !== to) {
          this._inputText = [from, to];
        }
      }
    }
    render() {
      var _a2, _b;
      return b`
			<div class="inputbox-selector">
				<div class="inputbox-selectorBackground-wrapper">
					<div style=${o$2(this._selectorStyle)}></div>
				</div>
				<input
					?disabled=${this.disabled}
					.value=${this._inputText[0] ?? ""}
					.placeholder=${((_a2 = this.placeholder) == null ? void 0 : _a2[0]) ?? ""}
					@blur=${() => this._handleBlur(0)}
					@focus=${() => this._handleFocus(0)}
					@input=${(e2) => this._handleInput(e2, 0)}
					@keydown=${this._handleKeydown}
				>
				<div class="opButton">
					<div class="hiddenButton">
						<ffbox-button size="small" type="danger" @click=${this._handleClear}>清空</ffbox-button>
					</div>
					<ffbox-button size="small" @click=${this._handleButtonClick}>编✂️辑</ffbox-button>
				</div>
				<input
					?disabled=${this.disabled}
					.value=${this._inputText[1] ?? ""}
					.placeholder=${((_b = this.placeholder) == null ? void 0 : _b[1]) ?? ""}
					@blur=${() => this._handleBlur(1)}
					@focus=${() => this._handleFocus(1)}
					@input=${(e2) => this._handleInput(e2, 1)}
					@keydown=${this._handleKeydown}
				>
			</div>
		`;
    }
    _handleBlur(index) {
      this._focused = index === 0 ? [false, this._focused[1]] : [this._focused[0], false];
    }
    _handleFocus(index) {
      this._focused = index === 0 ? [true, this._focused[1]] : [this._focused[0], true];
    }
    _handleInput(event, index) {
      const input = event.target;
      const fixed = durationFixer(input.value);
      const newValue = [this._inputText[0], this._inputText[1]];
      newValue[index] = fixed;
      this._inputText = newValue;
      if (input.value !== fixed) {
        input.value = fixed;
      }
      this.value = newValue;
      this._emitChange();
    }
    _handleKeydown(event) {
      if (event.key === "Enter") {
        this.dispatchEvent(new CustomEvent("enter", { bubbles: true, composed: true }));
      }
    }
    _handleClear(e2) {
      e2.stopImmediatePropagation();
      this._inputText = ["", ""];
      this.value = ["", ""];
      this._emitChange();
    }
    _handleButtonClick(e2) {
      e2.stopImmediatePropagation();
      this.dispatchEvent(new CustomEvent("button-click", { bubbles: true, composed: true }));
    }
    _emitChange() {
      this.dispatchEvent(new CustomEvent("change", {
        detail: [this._inputText[0], this._inputText[1]],
        bubbles: true,
        composed: true
      }));
    }
  };
  exports.FFBoxCutTimeInput.styles = i$6`
		:host {
			display: inline-block;
		}

		.inputbox-selector {
			position: relative;
			display: flex;
			justify-content: center;
			align-items: center;
			gap: 6px;
			height: 24px;
			flex-grow: 1;
			margin: 15px 0;
		}

		.inputbox-selector:hover .inputbox-selectorBackground-wrapper > div {
			background: var(--ff);
		}

		.inputbox-selectorBackground-wrapper {
			position: absolute;
			top: -4px;
			left: -8px;
			width: calc(100% + 16px);
			height: calc(100% + 16px);
			-webkit-mask-image: linear-gradient(to right, black calc(50% - 34px), #0003 calc(50% - 18px), #0003 calc(50% + 18px), black calc(50% + 34px));
			z-index: -1;
		}

		.inputbox-selectorBackground-wrapper > div {
			position: absolute;
			top: 3px;	/* border 有 1px 往下顶，所以这里减去 1px */
			left: 8px;
			width: calc(100% - 16px);
			height: calc(100% - 16px);
			border-radius: 24px;
			background: var(--f7);
			border: #AAA 1px solid;
			box-shadow: 0px 4px 8px rgba(0, 0, 0, 0.1);
			transition: box-shadow 0.2s linear, border 0.2s linear;
		}

		.inputbox-selector > input {
			width: calc(50% - 28px - 12px);
			height: 24px;
			line-height: 24px;
			background: none;
			border: none;
			margin: 0;
			padding: 0;
			outline: none;
			font-family: inherit;
			font-size: 13px;
			text-align: center;
			color: inherit;
		}

		.inputbox-selector > input::placeholder {
			font-size: 13px;
			opacity: 0.1;
			font-style: italic;
			transition: opacity 0.15s linear;
		}

		.inputbox-selector > input:hover::placeholder {
			font-size: 13px;
			opacity: 0.25;
		}

		.opButton {
			position: relative;
			display: flex;
			align-items: center;
		}

		.opButton ffbox-button {
			width: 60px; /* TODO: 由于 Shadow DOM 机制，此设定失效 */
		}

		.opButton:hover .hiddenButton {
			height: calc(24px + 24px);
			transform: translateY(-24px);
			opacity: 1;
			pointer-events: auto;
			/* outline: red 1px solid; */
			transition: transform 0.4s cubic-bezier(0.2, 1.5, 0.3, 1);
		}

		.hiddenButton {
			position: absolute;
			top: 0;
			left: 0;
			height: 24px;
			opacity: 0;
			/* 原版未处理：opacity 为 0 时仍会拦截点击，此处补充 pointer-events */
			pointer-events: none;
			transition: transform 0.4s, opacity 0.1s;
		}
	`;
  __decorateClass$5([
    n$4({ attribute: false })
  ], exports.FFBoxCutTimeInput.prototype, "value", 2);
  __decorateClass$5([
    n$4({ type: Boolean, reflect: true })
  ], exports.FFBoxCutTimeInput.prototype, "disabled", 2);
  __decorateClass$5([
    n$4({ attribute: false })
  ], exports.FFBoxCutTimeInput.prototype, "placeholder", 2);
  __decorateClass$5([
    c$1({ context: themeContext, subscribe: true }),
    n$4({ reflect: true, attribute: "data-theme" })
  ], exports.FFBoxCutTimeInput.prototype, "theme", 2);
  __decorateClass$5([
    r$2()
  ], exports.FFBoxCutTimeInput.prototype, "_inputText", 2);
  __decorateClass$5([
    r$2()
  ], exports.FFBoxCutTimeInput.prototype, "_focused", 2);
  exports.FFBoxCutTimeInput = __decorateClass$5([
    t$3("ffbox-cut-time-input")
  ], exports.FFBoxCutTimeInput);
  var __defProp$4 = Object.defineProperty;
  var __getOwnPropDesc$4 = Object.getOwnPropertyDescriptor;
  var __decorateClass$4 = (decorators, target, key, kind) => {
    var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc$4(target, key) : target;
    for (var i2 = decorators.length - 1, decorator; i2 >= 0; i2--)
      if (decorator = decorators[i2])
        result = (kind ? decorator(target, key, result) : decorator(result)) || result;
    if (kind && result) __defProp$4(target, key, result);
    return result;
  };
  const defaultButton = {
    text: "好嘅",
    type: "normal",
    callback: () => console.log("cancelled")
  };
  exports.FFBoxMsgbox = class FFBoxMsgbox extends i$3 {
    constructor() {
      super(...arguments);
      this.title = "";
      this.theme = "light";
      this._entered = false;
      this._leaving = false;
      this._disable = false;
      this._backgroundMouseDown = false;
      this.previousActiveElement = null;
      this._handleKeyPress = (e2) => {
        const buttons = this._buttons;
        if (buttons.length === 1 && (e2.key === "Escape" || e2.key === "Enter")) {
          this._handleButtonClick(buttons[0]);
          e2.stopPropagation();
        } else if (e2.key === "Escape") {
          const button = buttons.find((button2) => button2.role === "cancel");
          if (button) {
            this._handleButtonClick(button);
            e2.stopPropagation();
          }
        } else if (e2.key === "Enter") {
          const button = buttons.find((button2) => button2.role === "confirm");
          if (button) {
            this._handleButtonClick(button);
            e2.stopPropagation();
          }
        }
      };
    }
    get _mouseDownTransformStyle() {
      return this._backgroundMouseDown ? { transform: "scale(0.97)", transition: "all cubic-bezier(0.1, 2.5, 0.6, 1) 0.5s" } : {};
    }
    firstUpdated() {
      requestAnimationFrame(() => {
        this.previousActiveElement = document.activeElement;
        this._entered = true;
        this.addEventListener("keydown", this._handleKeyPress);
        this.tabIndex = -1;
        this.focus();
      });
    }
    disconnectedCallback() {
      this.removeEventListener("keydown", this._handleKeyPress);
      if (this.previousActiveElement && typeof this.previousActiveElement.focus === "function") {
        this.previousActiveElement.focus();
      }
      super.disconnectedCallback();
    }
    get _buttons() {
      return this.buttons || [defaultButton];
    }
    _handleButtonClick(button) {
      if (button.callback) {
        this._disable = true;
        const ret = button.callback();
        if (ret === void 0 || ret === true) {
          this.close();
        } else if (ret instanceof Promise) {
          ret.then(() => this.close());
        } else {
          this._disable = false;
        }
      } else {
        this.close();
      }
    }
    /** 播放离场动画，动画结束后组件自行从 DOM 移除并派发 closed 事件 */
    close() {
      var _a2;
      if (this._leaving) return;
      this._leaving = true;
      this.removeEventListener("keydown", this._handleKeyPress);
      const finish = () => {
        this.dispatchEvent(new CustomEvent("closed", { bubbles: true, composed: true }));
        this.remove();
      };
      let done = false;
      const once = (e2) => {
        if (e2.target !== this._boxEl || done) return;
        done = true;
        finish();
      };
      (_a2 = this._boxEl) == null ? void 0 : _a2.addEventListener("transitionend", once);
      setTimeout(() => {
        if (done) return;
        done = true;
        finish();
      }, 300);
    }
    render() {
      const buttons = this._buttons;
      const backgroundClasses = ["background", this._entered && !this._leaving ? "entered" : ""].filter(Boolean).join(" ");
      const boxClasses = ["box", this._entered && !this._leaving ? "entered" : "", this._leaving ? "leaving" : ""].filter(Boolean).join(" ");
      const content = typeof this.content === "function" ? this.content() : this.content;
      return b`
			<dialog class="dialog">
				<div
					class=${backgroundClasses}
					@mousedown=${() => this._backgroundMouseDown = true}
					@mouseup=${() => this._backgroundMouseDown = false}
				></div>
				<div class=${boxClasses} style=${o$2(this._mouseDownTransformStyle)}>
					${this.image ? b`<div class="image">${this.image}</div>` : ""}
					${this.title ? b`<div class="title">${this.title}</div>` : ""}
					${content ? b`<div class="content">${content}</div>` : ""}
					<div class="buttons">
						${buttons.map((button) => b`
							<ffbox-button
								type=${button.type ?? "normal"}
								?disabled=${this._disable}
								@click=${() => this._handleButtonClick(button)}
							>${button.text}</ffbox-button>
						`)}
					</div>
				</div>
			</dialog>
		`;
    }
  };
  exports.FFBoxMsgbox.styles = i$6`
		:host {
			/* host 承担原版 <dialog> 的铺满定位（Web Component 多了一层宿主，若不做定位则高度为 0） */
			display: block;
			position: fixed;
			top: 0;
			left: 0;
			width: 100%;
			height: 100%;
			color: inherit;
			outline: none;
			z-index: 5;
		}

		.dialog {
			display: flex;
			justify-content: center;
			align-items: center;
			background: none;
			border: none;
			margin: 0;
			padding: 0;
			position: relative;
			width: 100%;
			height: 100%;
			overflow: hidden;
			color: inherit;
		}

		.background {
			position: absolute;
			top: 0;
			left: 0;
			width: 100%;
			height: 100%;
			will-change: opacity;
			background-color: hwb(var(--bg90) / 0.3);
			backdrop-filter: blur(1.5px);
			opacity: 0;
			transition: opacity 0.2s ease-out;	/* 对应 bganimate-leave-active */
		}
		.background.entered {
			opacity: 1;
			transition: opacity 0.3s ease-out;	/* 对应 bganimate-enter-active */
		}

		.box {
			display: flex;
			flex-direction: column;
			align-items: center;
			min-width: 200px;
			padding: 16px 24px;
			border-radius: 8px;
			background-color: hwb(var(--bg97) / 0.8);
			box-shadow: 0 3px 2px -2px hwb(var(--highlight)) inset,	/* 上亮光 */
					0 16px 32px 0px hwb(var(--hoverShadow) / 0.02),
					0 6px 6px 0px hwb(var(--hoverShadow) / 0.02),
					0 0 0 1px hwb(var(--highlight) / 0.9);	/* 包边 */
			transition: transform cubic-bezier(0.33, 1, 1, 1) 0.3s, opacity linear 0.2s;
			z-index: 0;	/* 可能是由于 chromium 的 bug，不加这个会导致背景的 backdrop-filter 应用到 box 上 */
			/* 对应 boxanimate-enter-from */
			transform: scale(1.1);
			opacity: 0;
		}
		.box > *:not(:last-child) {
			margin-bottom: 12px;
		}
		.box.entered {
			/* 对应 boxanimate-enter-to / boxanimate-leave-from */
			transform: scale(1);
			opacity: 1;
		}
		.box.leaving {
			/* 对应 boxanimate-leave-active + boxanimate-leave-to */
			transition: all linear 0.2s;
			transform: scale(0.9);
			opacity: 0;
		}

		.image {
			height: 96px;
		}
		.image > * {
			height: 100%;
		}
		.title {
			font-size: 17px;
			font-weight: 500;
		}
		.content {
			font-size: 14px;
			margin: 4px 0 24px;
		}
		.buttons {
			display: flex;
		}
	`;
  __decorateClass$4([
    n$4({ reflect: true })
  ], exports.FFBoxMsgbox.prototype, "title", 2);
  __decorateClass$4([
    n$4({ attribute: false })
  ], exports.FFBoxMsgbox.prototype, "image", 2);
  __decorateClass$4([
    n$4({ attribute: false })
  ], exports.FFBoxMsgbox.prototype, "content", 2);
  __decorateClass$4([
    n$4({ attribute: false })
  ], exports.FFBoxMsgbox.prototype, "buttons", 2);
  __decorateClass$4([
    c$1({ context: themeContext, subscribe: true }),
    n$4({ reflect: true, attribute: "data-theme" })
  ], exports.FFBoxMsgbox.prototype, "theme", 2);
  __decorateClass$4([
    r$2()
  ], exports.FFBoxMsgbox.prototype, "_entered", 2);
  __decorateClass$4([
    r$2()
  ], exports.FFBoxMsgbox.prototype, "_leaving", 2);
  __decorateClass$4([
    r$2()
  ], exports.FFBoxMsgbox.prototype, "_disable", 2);
  __decorateClass$4([
    r$2()
  ], exports.FFBoxMsgbox.prototype, "_backgroundMouseDown", 2);
  __decorateClass$4([
    e$4(".box")
  ], exports.FFBoxMsgbox.prototype, "_boxEl", 2);
  exports.FFBoxMsgbox = __decorateClass$4([
    t$3("ffbox-msgbox")
  ], exports.FFBoxMsgbox);
  function _detectTheme$3() {
    const provider = document.querySelector("ffbox-theme-provider");
    if (provider) return provider.theme === "dark" ? "dark" : "light";
    return "light";
  }
  exports.FFBoxMsgbox.show = function(options = {}) {
    const el = document.createElement("ffbox-msgbox");
    el.title = options.title ?? "";
    el.image = options.image;
    el.content = options.content;
    el.buttons = options.buttons;
    el.theme = _detectTheme$3();
    const container2 = options.container || document.body;
    container2.appendChild(el);
    return el;
  };
  const closeIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="48" height="48"><path d="M743.2 701.21a37.84 37.84 0 0 1-0.39 52.88l5.51-5.51a36.5 36.5 0 0 1-52.19-0.3L281.64 322.79a37.84 37.84 0 0 1 0.39-52.88l-5.5 5.51a36.5 36.5 0 0 1 52.19 0.3z" fill="currentColor"></path><path d="M701.21 284.3a37.84 37.84 0 0 1 52.88 0.39l-5.51-5.51a36.5 36.5 0 0 1-0.3 52.19L322.79 745.86a37.84 37.84 0 0 1-52.88-0.39l5.51 5.51a36.5 36.5 0 0 1 0.3-52.19z" fill="currentColor"></path></svg>\n';
  var __defProp$3 = Object.defineProperty;
  var __getOwnPropDesc$3 = Object.getOwnPropertyDescriptor;
  var __decorateClass$3 = (decorators, target, key, kind) => {
    var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc$3(target, key) : target;
    for (var i2 = decorators.length - 1, decorator; i2 >= 0; i2--)
      if (decorator = decorators[i2])
        result = (kind ? decorator(target, key, result) : decorator(result)) || result;
    if (kind && result) __defProp$3(target, key, result);
    return result;
  };
  const instances = [];
  let seed = 0;
  let container;
  exports.FFBoxPopup = class FFBoxPopup extends i$3 {
    constructor() {
      super(...arguments);
      this.message = "";
      this.level = 0;
      this.verticalOffset = 0;
      this.index = 0;
      this.theme = "light";
      this._show = false;
      this._duration = 0;
      this._timeLeft = 0;
      this._mouseIn = false;
      this._delayedVerticalOffset = 0;
      this._userClosing = false;
      this._leaving = false;
      this._handleMouseEnter = () => {
        this._mouseIn = true;
      };
      this._handleMouseLeave = () => {
        this._mouseIn = false;
      };
    }
    get _bgClass() {
      switch (this.level) {
        case 1:
          return "popup-box popup-ok";
        case 2:
          return "popup-box popup-warning";
        case 3:
          return "popup-box popup-error";
        default:
          return "popup-box";
      }
    }
    get _strokeColor() {
      switch (this.level) {
        case 1:
          return "#FFFFFF";
        case 2:
          return "#3F330D";
        case 3:
          return "#FFFFFF";
        default:
          return "currentColor";
      }
    }
    connectedCallback() {
      super.connectedCallback();
      this.addEventListener("mouseenter", this._handleMouseEnter);
      this.addEventListener("mouseleave", this._handleMouseLeave);
    }
    firstUpdated() {
      this._show = true;
      this._duration = 2500 + this.message.length * 100;
      this._timeLeft = this._duration;
      let lastTime = (/* @__PURE__ */ new Date()).getTime();
      const count = () => {
        const now = (/* @__PURE__ */ new Date()).getTime();
        if (!this._mouseIn) {
          this._timeLeft = this._timeLeft - (now - lastTime);
          if (this._timeLeft <= 0) {
            this._close();
          }
        } else {
          this._timeLeft += (this._duration - this._timeLeft) * 0.2;
        }
        if (this._show) {
          {
            this._timerId = setTimeout(count, 67);
          }
        }
        lastTime = now;
      };
      count();
    }
    disconnectedCallback() {
      this.removeEventListener("mouseenter", this._handleMouseEnter);
      this.removeEventListener("mouseleave", this._handleMouseLeave);
      this._show = false;
      if (this._timerId !== void 0) clearTimeout(this._timerId);
      super.disconnectedCallback();
    }
    willUpdate(changed) {
      if (changed.has("verticalOffset")) {
        setTimeout(() => {
          this._delayedVerticalOffset = this.verticalOffset;
        }, 33 * this.index);
      }
    }
    updated() {
      this.style.transform = `translateY(${-this._delayedVerticalOffset}px)`;
      this.style.pointerEvents = this._show ? "auto" : "none";
    }
    render() {
      const lines = this.message.split("\n");
      const boxClasses = [this._bgClass, this._show && !this._leaving ? "entered" : "", this._leaving ? "leaving" : "", this._leaving && this._userClosing ? "user" : ""].filter(Boolean).join(" ");
      const dashOffset = -125.664 * (1 - this._timeLeft / (this._duration || 1));
      return b`
			<div class=${boxClasses} @mousedown=${this._handleMouseDown} @mouseup=${this._handleMouseUp}>
				<div class="popup-progress">
					<svg viewBox="-24 -24 48 48" class="popup-progress-circle">
						<circle
							fill="transparent"
							stroke-width="6"
							stroke=${this._strokeColor}
							stroke-dasharray="125.664"
							stroke-dashoffset=${dashOffset}
							r="20"
						></circle>
					</svg>
					<div class="popup-progress-x" style="color: ${this._strokeColor}" @click=${() => this._close(true)}>${o$3(closeIcon)}</div>
				</div>
				<div class="popup-message">
					${lines.map((line, i2) => b`${line}${i2 < lines.length - 1 ? b`<br/>` : ""}`)}
				</div>
			</div>
		`;
    }
    _handleMouseDown(event) {
      if (event.button === 1) {
        event.preventDefault();
      }
    }
    _handleMouseUp(event) {
      if (event.button === 1) {
        this._close(true);
      }
    }
    _close(isUserInteraction) {
      var _a2;
      if (this._leaving) return;
      if (isUserInteraction) {
        this._userClosing = true;
      }
      this._show = false;
      this._leaving = true;
      this.dispatchEvent(new CustomEvent("will-close", {
        detail: { isUserInteraction: isUserInteraction ?? false },
        bubbles: true,
        composed: true
      }));
      const finish = () => {
        this.dispatchEvent(new CustomEvent("closed", { bubbles: true, composed: true }));
      };
      let done = false;
      const once = (e2) => {
        if (e2.target !== this._boxEl || done) return;
        done = true;
        finish();
      };
      (_a2 = this._boxEl) == null ? void 0 : _a2.addEventListener("transitionend", once);
      setTimeout(() => {
        if (done) return;
        done = true;
        finish();
      }, this._userClosing ? 550 : 750);
    }
  };
  exports.FFBoxPopup.styles = i$6`
		:host {
			display: block;
			position: absolute;
			bottom: 10%;
			left: 0;
			right: 0;
			width: fit-content;
			max-width: 60%;
			background: none;
			border: none;
			margin: auto;
			padding: 0;
			transition: transform 0.7s cubic-bezier(0.35, 1.4, 0.2, 0.95);
			z-index: 10;
		}

		.popup-box {
			width: fit-content;
			display: flex;
			align-items: stretch;
			padding: 8px;
			background: hwb(var(--bg98));
			border: hsl(0, 0%, 67%) 1px solid;
			border-radius: 12px;
			overflow: hidden;
			box-shadow: 0px 4px 8px hwb(0 0% 100% / 0.3);
			/* 对应 popupanimate-enter-from */
			opacity: 0;
			transform: scale(0) translateY(120px);
		}
		.popup-box.entered {
			/* 对应 popupanimate-enter-active + enter-to */
			transition: transform 0.5s cubic-bezier(0.4, 1.3, 0.4, 1), opacity 0.2s linear;
			opacity: 1;
			transform: scale(1);
		}
		.popup-box.leaving {
			/* 对应 popupanimate-leave-active + leave-to */
			transition: opacity 0.7s ease-out, transform 0.6s cubic-bezier(1, 0, 1, 1) 0.1s;
			opacity: 0;
			transform: scale(0.5);
		}
		.popup-box.leaving.user {
			/* 对应 popupanimateUser-leave-active + leave-to */
			transition: all 0.5s linear;
			opacity: 0;
			transform: scale(0.5) translateX(calc(100vw + 400px));
		}

		.popup-box:hover .popup-progress .popup-progress-circle {
			opacity: 0;
			transform: rotate(-90deg) scale(0.5);
		}
		.popup-box:hover .popup-progress .popup-progress-x {
			opacity: 1;
			transform: translateX(0);
		}

		.popup-message {
			margin: 4px;
			font-size: 16px;
			line-height: 1.3em;
			text-align: center;
			word-break: break-word;
		}

		.popup-progress {
			position: relative;
			width: 24px;
			height: auto;
			display: flex;
			justify-content: center;
			align-items: center;
			opacity: 0.8;
		}
		.popup-progress-circle {
			width: 16px;
			height: 16px;
			transform: rotate(-90deg) scale(1);
			transition: transform 0.3s cubic-bezier(0.1, 0.8, 0.3, 1), opacity 0.3s cubic-bezier(0.1, 0.8, 0.3, 1);
		}
		.popup-progress-circle:hover {
			visibility: hidden;
		}
		.popup-progress-x {
			position: absolute;
			width: 24px;
			height: 100%;
			margin: auto;
			border-radius: 4px;
			opacity: 0;
			transform: translateX(-32px);
			transition: transform 0.3s cubic-bezier(0.1, 0.8, 0.3, 1), opacity 0.3s cubic-bezier(0.1, 0.8, 0.3, 1);
			cursor: pointer;
		}
		.popup-progress-x svg {
			width: 100%;
			height: 100%;
			color: inherit;
		}
		.popup-progress-x:hover {
			box-shadow: 0 1px 4px hwb(var(--hoverShadow) / 0.2),
						0 4px 2px -2px hwb(var(--highlight) / 0.5) inset;
		}
		.popup-progress-x:active {
			box-shadow: 0 0px 1px hwb(var(--hoverShadow) / 0.2),
						0 15px 20px -10px hwb(var(--hoverShadow) / 0.15) inset;
			transform: translateY(0.25px);
		}

		/* 主题 */
		:host([data-theme="light"]) .popup-ok {
			background: linear-gradient(180deg, hwb(120 40% 10%), hwb(120 20% 20%));
			border-color: hwb(120 15% 35%);
			box-shadow: 0px 4px 8px hwb(120 10% 35% / 0.4);
			color: #FFF;
		}
		:host([data-theme="light"]) .popup-warning {
			background: linear-gradient(180deg, hwb(45 50% 0%), hwb(45 30% 0%));
			border-color: hwb(45 30% 10%);
			box-shadow: 0px 4px 8px hwb(45 10% 35% / 0.4);
			color: hsl(46, 66%, 15%);
		}
		:host([data-theme="light"]) .popup-error {
			background: hwb(0 35% 5%);
			border-color: hwb(0 20% 20%);
			box-shadow: 0px 4px 8px hwb(0 5% 40% / 0.4);
			color: #FFF;
		}

		:host([data-theme="dark"]) .popup-ok {
			background: linear-gradient(180deg, hwb(120 30% 15%), hwb(120 10% 25%));
			border-color: hwb(120 10% 45%);
			box-shadow: 0px 4px 8px hwb(120 5% 45% / 0.4);
			color: #FFF;
		}
		:host([data-theme="dark"]) .popup-warning {
			background: linear-gradient(180deg, hwb(45 40% 0%), hwb(45 20% 0%));
			border-color: hwb(45 25% 15%);
			box-shadow: 0px 4px 8px hwb(45 10% 30% / 0.4);
			color: hsl(46, 66%, 15%);
		}
		:host([data-theme="dark"]) .popup-error {
			background: hwb(0 30% 10%);
			border-color: hwb(0 20% 30%);
			box-shadow: 0px 4px 8px hwb(0 5% 40% / 0.4);
			color: #FFF;
		}
	`;
  __decorateClass$3([
    n$4({ reflect: true })
  ], exports.FFBoxPopup.prototype, "message", 2);
  __decorateClass$3([
    n$4({ type: Number })
  ], exports.FFBoxPopup.prototype, "level", 2);
  __decorateClass$3([
    n$4({ type: Number })
  ], exports.FFBoxPopup.prototype, "verticalOffset", 2);
  __decorateClass$3([
    n$4({ type: Number })
  ], exports.FFBoxPopup.prototype, "index", 2);
  __decorateClass$3([
    c$1({ context: themeContext, subscribe: true }),
    n$4({ reflect: true, attribute: "data-theme" })
  ], exports.FFBoxPopup.prototype, "theme", 2);
  __decorateClass$3([
    r$2()
  ], exports.FFBoxPopup.prototype, "_show", 2);
  __decorateClass$3([
    r$2()
  ], exports.FFBoxPopup.prototype, "_duration", 2);
  __decorateClass$3([
    r$2()
  ], exports.FFBoxPopup.prototype, "_timeLeft", 2);
  __decorateClass$3([
    r$2()
  ], exports.FFBoxPopup.prototype, "_mouseIn", 2);
  __decorateClass$3([
    r$2()
  ], exports.FFBoxPopup.prototype, "_delayedVerticalOffset", 2);
  __decorateClass$3([
    r$2()
  ], exports.FFBoxPopup.prototype, "_userClosing", 2);
  __decorateClass$3([
    r$2()
  ], exports.FFBoxPopup.prototype, "_leaving", 2);
  __decorateClass$3([
    e$4(".popup-box")
  ], exports.FFBoxPopup.prototype, "_boxEl", 2);
  exports.FFBoxPopup = __decorateClass$3([
    t$3("ffbox-popup")
  ], exports.FFBoxPopup);
  function _getContainer() {
    if (!container) {
      container = document.createElement("div");
      container.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;";
      document.body.appendChild(container);
    }
    return container;
  }
  function _detectTheme$2() {
    const provider = document.querySelector("ffbox-theme-provider");
    if (provider) return provider.theme === "dark" ? "dark" : "light";
    return "light";
  }
  function _handleOnWillClose(id, isUserInteraction) {
    const index = instances.findIndex((item) => item.id === id);
    if (index === -1) return;
    instances.splice(index, 1);
    setTimeout(() => {
      _reCalcVerticalOffset();
    }, isUserInteraction ? 0 : 300);
  }
  function _reCalcVerticalOffset() {
    for (let i2 = 0, totalHeight = 0; i2 < instances.length; i2++) {
      const instance = instances[i2];
      instance.el.index = i2;
      instance.el.verticalOffset = totalHeight;
      totalHeight += instances[i2].el.offsetHeight + 16;
    }
  }
  exports.FFBoxPopup.show = function(options) {
    const el = document.createElement("ffbox-popup");
    el.message = options.message;
    el.level = options.level ?? 0;
    el.verticalOffset = 0;
    el.index = instances.length;
    el.theme = _detectTheme$2();
    const id = seed++;
    el.addEventListener("will-close", (e2) => {
      var _a2;
      return _handleOnWillClose(id, (_a2 = e2.detail) == null ? void 0 : _a2.isUserInteraction);
    });
    el.addEventListener("closed", () => {
      var _a2;
      (_a2 = el.parentElement) == null ? void 0 : _a2.removeChild(el);
    });
    _getContainer().appendChild(el);
    instances.unshift({ el, id });
    if (instances.length > 30) {
      const oldest = instances.pop();
      oldest.el.remove();
    }
    el.updateComplete.then(_reCalcVerticalOffset);
    return el;
  };
  function computeTooltipStyle(position, e2) {
    const rect = e2.target.getBoundingClientRect();
    switch (position) {
      case "mtl":
        return { top: `${e2.clientY}px`, right: `${window.innerWidth - e2.clientX}px` };
      case "t":
        return { bottom: `${window.innerHeight - rect.top}px`, left: `${rect.left + rect.width / 2}px`, transform: "translateX(-50%)" };
      case "tl":
        return { bottom: `${window.innerHeight - rect.top}px`, left: `${rect.left}px` };
      case "tr":
        return { bottom: `${window.innerHeight - rect.top}px`, right: `${window.innerWidth - rect.right}px` };
      case "r":
        return { top: `${rect.top + rect.height / 2}px`, left: `${rect.left + rect.width}px`, transform: "translateY(-50%)" };
      case "br":
      default:
        return { top: `${rect.top + rect.height}px`, right: `${window.innerWidth - rect.right}px` };
    }
  }
  class TooltipDirective extends i$1 {
    constructor(partInfo) {
      super(partInfo);
      this._onMouseenter = null;
      this._onMouseleave = null;
      if (partInfo.type !== t$1.ELEMENT) {
        throw new Error("tooltip 指令只能用于元素");
      }
    }
    update(part, [content, position, styleName]) {
      const el = part.element;
      if (this._onMouseenter) {
        el.removeEventListener("mouseenter", this._onMouseenter);
        el.removeEventListener("mouseleave", this._onMouseleave);
      }
      this._onMouseenter = (e2) => {
        exports.FFBoxTooltip.show({
          content,
          style: computeTooltipStyle(position, e2),
          className: styleName === "small" ? "small" : void 0
        });
      };
      this._onMouseleave = () => {
        exports.FFBoxTooltip.hide();
      };
      el.addEventListener("mouseenter", this._onMouseenter);
      el.addEventListener("mouseleave", this._onMouseleave);
      return E;
    }
    render(_content, _position, _styleName) {
      return E;
    }
  }
  const tooltip = e$1(TooltipDirective);
  function useTooltip(content, position = "br", styleName = "small") {
    return {
      onmouseenter: (e2) => {
        exports.FFBoxTooltip.show({
          content,
          style: computeTooltipStyle(position, e2),
          className: styleName === "small" ? "small" : void 0
        });
      },
      onmouseleave: () => {
        exports.FFBoxTooltip.hide();
      }
    };
  }
  const _DEFAULT_ATTR = "data-tooltip";
  const _observedElements = /* @__PURE__ */ new WeakSet();
  let _observer = null;
  let _attrName = _DEFAULT_ATTR;
  function _parseAttr(value) {
    var _a2, _b;
    const parts = value.split(";");
    const content = parts[0];
    const position = ((_a2 = parts[1]) == null ? void 0 : _a2.trim()) || "br";
    const styleName = ((_b = parts[2]) == null ? void 0 : _b.trim()) || "small";
    return [content, position, styleName];
  }
  function _bindTooltipFromAttr(el) {
    if (_observedElements.has(el)) return;
    const raw = el.getAttribute(_attrName);
    if (raw === null) return;
    _observedElements.add(el);
    const [content, position, styleName] = _parseAttr(raw);
    const { onmouseenter, onmouseleave } = useTooltip(content, position, styleName);
    el.addEventListener("mouseenter", onmouseenter);
    el.addEventListener("mouseleave", onmouseleave);
  }
  function _bindDescendants(root) {
    root.querySelectorAll(`[${_attrName}]`).forEach(_bindTooltipFromAttr);
  }
  function enableTooltipAutoscan(attrName = _DEFAULT_ATTR) {
    if (_observer) return;
    _attrName = attrName;
    _observer = new MutationObserver((mutations) => {
      for (const m2 of mutations) {
        for (const node of m2.addedNodes) {
          if (node instanceof HTMLElement) {
            _bindTooltipFromAttr(node);
            _bindDescendants(node);
          }
        }
      }
    });
    const start = () => {
      _bindDescendants(document);
      _observer.observe(document.body, { childList: true, subtree: true });
    };
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start, { once: true });
  }
  function disableTooltipAutoscan() {
    if (!_observer) return;
    _observer.disconnect();
    _observer = null;
  }
  var __defProp$2 = Object.defineProperty;
  var __getOwnPropDesc$2 = Object.getOwnPropertyDescriptor;
  var __decorateClass$2 = (decorators, target, key, kind) => {
    var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc$2(target, key) : target;
    for (var i2 = decorators.length - 1, decorator; i2 >= 0; i2--)
      if (decorator = decorators[i2])
        result = (kind ? decorator(target, key, result) : decorator(result)) || result;
    if (kind && result) __defProp$2(target, key, result);
    return result;
  };
  exports.FFBoxTooltip = class FFBoxTooltip extends i$3 {
    constructor() {
      super(...arguments);
      this.content = "";
      this.show = false;
      this.className = "";
      this.theme = "light";
    }
    render() {
      const lines = this.content.split("\n");
      const boxClasses = ["tooltip-box", this.show ? "" : "hidden", this.className].filter(Boolean);
      return b`
			<div class=${boxClasses.join(" ")}>
				<div class="tooltip-message">
					${lines.map((line, i2) => b`${line}${i2 < lines.length - 1 ? b`<br/>` : ""}`)}
				</div>
			</div>
		`;
    }
  };
  exports.FFBoxTooltip.styles = i$6`
		:host {
			display: block;
			position: fixed;
			z-index: 100;
			pointer-events: none;
			max-width: calc(200px + 25%);
		}

		.tooltip-box {
			padding: 10px 12px;
			background: hwb(var(--bg98));
			border: hsl(0, 0%, 67%) 1px solid;
			border-radius: 10px;
			box-shadow: 0px 4px 8px hsla(0, 0%, 0%, 0.3);
			z-index: 5;
			opacity: 1;
			transition: opacity 0.1s linear;
		}

		.tooltip-box.hidden {
			opacity: 0;
			transition: opacity 0.2s linear;
		}

		.tooltip-box.small {
			position: relative;
			top: -1px;
			padding: 6px 10px;
			border-radius: 8px;
			border: none;
			background-color: hwb(var(--hoverLightBg) / 0.5);
			backdrop-filter: blur(8px) contrast(110%);
			box-shadow: 0 0 1px 0.5px hwb(var(--hoverLightBg)),
						0 1.5px 4px 0 hwb(var(--hoverShadow) / 0.2),
						0 1px 0.5px 0px hwb(var(--highlight) / 0.5) inset;
		}

		.tooltip-box.small .tooltip-message {
			font-size: 12px;
			line-height: 16px;
		}

		.tooltip-message {
			font-size: 14px;
			line-height: 1.3em;
			text-align: left;
		}
	`;
  __decorateClass$2([
    n$4({ reflect: true })
  ], exports.FFBoxTooltip.prototype, "content", 2);
  __decorateClass$2([
    n$4({ type: Boolean, reflect: true })
  ], exports.FFBoxTooltip.prototype, "show", 2);
  __decorateClass$2([
    n$4({ reflect: true })
  ], exports.FFBoxTooltip.prototype, "className", 2);
  __decorateClass$2([
    n$4({ reflect: true, attribute: "data-theme" })
  ], exports.FFBoxTooltip.prototype, "theme", 2);
  exports.FFBoxTooltip = __decorateClass$2([
    t$3("ffbox-tooltip")
  ], exports.FFBoxTooltip);
  let _instance = null;
  function _getInstance() {
    if (!_instance) {
      _instance = document.createElement("ffbox-tooltip");
      document.body.appendChild(_instance);
    }
    return _instance;
  }
  function _detectTheme$1() {
    const provider = document.querySelector("ffbox-theme-provider");
    if (provider) return provider.theme;
    return "light";
  }
  exports.FFBoxTooltip.show = function(options) {
    const el = _getInstance();
    el.theme = _detectTheme$1();
    el.content = options.content;
    el.className = options.className ?? "";
    el.show = true;
    el.style.top = "";
    el.style.bottom = "";
    el.style.left = "";
    el.style.right = "";
    el.style.transform = "";
    if (options.style) {
      Object.assign(el.style, options.style);
    }
  };
  exports.FFBoxTooltip.hide = function() {
    if (_instance) {
      _instance.show = false;
    }
  };
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
  const s = (i2, t2) => {
    var _a2;
    const e2 = i2._$AN;
    if (void 0 === e2) return false;
    for (const i3 of e2) (_a2 = i3._$AO) == null ? void 0 : _a2.call(i3, t2, false), s(i3, t2);
    return true;
  }, o$1 = (i2) => {
    let t2, e2;
    do {
      if (void 0 === (t2 = i2._$AM)) break;
      e2 = t2._$AN, e2.delete(i2), i2 = t2;
    } while (0 === (e2 == null ? void 0 : e2.size));
  }, r = (i2) => {
    for (let t2; t2 = i2._$AM; i2 = t2) {
      let e2 = t2._$AN;
      if (void 0 === e2) t2._$AN = e2 = /* @__PURE__ */ new Set();
      else if (e2.has(i2)) break;
      e2.add(i2), c(t2);
    }
  };
  function h(i2) {
    void 0 !== this._$AN ? (o$1(this), this._$AM = i2, r(this)) : this._$AM = i2;
  }
  function n$1(i2, t2 = false, e2 = 0) {
    const r2 = this._$AH, h2 = this._$AN;
    if (void 0 !== h2 && 0 !== h2.size) if (t2) if (Array.isArray(r2)) for (let i3 = e2; i3 < r2.length; i3++) s(r2[i3], false), o$1(r2[i3]);
    else null != r2 && (s(r2, false), o$1(r2));
    else s(this, i2);
  }
  const c = (i2) => {
    i2.type == t$1.CHILD && (i2._$AP ?? (i2._$AP = n$1), i2._$AQ ?? (i2._$AQ = h));
  };
  class f extends i$1 {
    constructor() {
      super(...arguments), this._$AN = void 0;
    }
    _$AT(i2, t2, e2) {
      super._$AT(i2, t2, e2), r(this), this.isConnected = i2._$AU;
    }
    _$AO(i2, t2 = true) {
      var _a2, _b;
      i2 !== this.isConnected && (this.isConnected = i2, i2 ? (_a2 = this.reconnected) == null ? void 0 : _a2.call(this) : (_b = this.disconnected) == null ? void 0 : _b.call(this)), t2 && (s(this, i2), o$1(this));
    }
    setValue(t2) {
      if (r$1(this._$Ct)) this._$Ct._$AI(t2, this);
      else {
        const i2 = [...this._$Ct._$AH];
        i2[this._$Ci] = t2, this._$Ct._$AI(i2, this, 0);
      }
    }
    disconnected() {
    }
    reconnected() {
    }
  }
  const o = /* @__PURE__ */ new WeakMap(), n = e$1(class extends f {
    render(i2) {
      return A;
    }
    update(i2, [s2]) {
      var _a2;
      const e2 = s2 !== this.G;
      return e2 && this.rt(void 0), (e2 || this.lt !== this.ct) && (this.G = s2, this.ht = (_a2 = i2.options) == null ? void 0 : _a2.host, this.rt(this.ct = i2.element)), A;
    }
    rt(t2) {
      if (void 0 !== this.G) if (this.isConnected || (t2 = void 0), "function" == typeof this.G) {
        const i2 = this.ht ?? globalThis;
        let s2 = o.get(i2);
        void 0 === s2 && (s2 = /* @__PURE__ */ new WeakMap(), o.set(i2, s2)), void 0 !== s2.get(this.G) && this.G.call(this.ht, void 0), s2.set(this.G, t2), void 0 !== t2 && this.G.call(this.ht, t2);
      } else this.G.value = t2;
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
  const rightIcon = '<?xml version="1.0" standalone="no"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg t="1697533442768" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="3305" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="200"><path d="M761.056 532.128c0.512-0.992 1.344-1.824 1.792-2.848 8.8-18.304 5.92-40.704-9.664-55.424L399.936 139.744a48 48 0 0 0-65.984 69.76l316.96 299.84L335.2 813.632a48 48 0 0 0 66.624 69.12l350.048-337.376c0.672-0.672 0.928-1.6 1.6-2.304 0.512-0.48 1.056-0.832 1.568-1.344 2.72-2.848 4.16-6.336 6.016-9.6z" fill="currentColor" p-id="3306"></path></svg>';
  function getMenuItemByValue(menu, value, compareFunc) {
    function dfs(menu2) {
      for (const menuItem of menu2) {
        if (menuItem.type === "submenu") {
          const result = dfs(menuItem.subMenu);
          if (result) {
            return result;
          }
        } else if ("value" in menuItem && (compareFunc ? compareFunc(menuItem.value, value) : menuItem.value === value)) {
          return menuItem;
        }
      }
    }
    return dfs(menu);
  }
  var __defProp$1 = Object.defineProperty;
  var __getOwnPropDesc$1 = Object.getOwnPropertyDescriptor;
  var __decorateClass$1 = (decorators, target, key, kind) => {
    var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc$1(target, key) : target;
    for (var i2 = decorators.length - 1, decorator; i2 >= 0; i2--)
      if (decorator = decorators[i2])
        result = (kind ? decorator(target, key, result) : decorator(result)) || result;
    if (kind && result) __defProp$1(target, key, result);
    return result;
  };
  exports.FFBoxMenu = class FFBoxMenu extends i$3 {
    constructor() {
      super(...arguments);
      this.menu = [];
      this.type = "action";
      this.theme = "light";
      this._openedSubMenus = [];
      this._openedSubMenuItemPos = {};
      this._currentHoveredItem = void 0;
      this._currentSelectedItem = void 0;
      this._leaving = false;
      this._flattenedMenus = [];
      this._menuElemRefs = [];
      this._unmounted = false;
      this._calcSubMenuPosition = async (menuIndex) => {
        if (this._openedSubMenuItemPos[menuIndex]) {
          return;
        }
        const menu = this._flattenedMenus[menuIndex];
        const parentMenu = menu.parent;
        if (!parentMenu) {
          return;
        }
        if (!this._openedSubMenuItemPos[parentMenu.menuIndex]) {
          await this._calcSubMenuPosition(parentMenu.menuIndex);
          await this.updateComplete;
        }
        const parentIndexInFlattened = parentMenu.menuIndex;
        const parentIndexInMenu = parentMenu.menu.findIndex((menuItem) => menuItem.type === "submenu" && menuItem.key === menuIndex);
        const menuElem = this._menuElemRefs[parentIndexInFlattened];
        const menuItemElem = menuElem.children[parentIndexInMenu];
        menuItemElem.scrollIntoView({
          behavior: "instant",
          block: "center",
          inline: "center"
        });
        const menuItemElemRect = menuItemElem.getBoundingClientRect();
        this._openedSubMenuItemPos[menuIndex] = {
          xMin: menuItemElemRect.x,
          yMin: menuItemElemRect.y,
          xMax: menuItemElemRect.x + menuItemElemRect.width,
          yMax: menuItemElemRect.y + menuItemElemRect.height,
          preferDirection: "r"
        };
        this._openedSubMenuItemPos = { ...this._openedSubMenuItemPos };
      };
      this._showTooltip = (menuItem) => {
        var _a2;
        if (menuItem.type !== "separator" && menuItem.tooltip) {
          const { menu: _menu, indexInFlattened, indexInMenu } = this._getMenuByItem(menuItem);
          let position = {};
          const menuElem = this._menuElemRefs[indexInFlattened];
          if (!menuElem) {
            return;
          }
          const menuItemElem = menuElem.children[indexInMenu];
          const menuItemElemRect = menuItemElem.getBoundingClientRect();
          const screenHeight = document.documentElement.clientHeight;
          const leftSpace = menuItemElemRect.left;
          if (((_a2 = this._openedSubMenuItemPos[indexInFlattened]) == null ? void 0 : _a2.preferDirection) === "l" || leftSpace < 220) {
            position = {
              ...position,
              left: `${menuItemElemRect.left + menuItemElemRect.width + 12}px`
            };
          } else {
            position = {
              ...position,
              right: `calc(100% - ${menuItemElemRect.left - 12}px)`
            };
          }
          if (menuItemElemRect.top + menuItemElemRect.height / 2 < screenHeight / 2) {
            position = {
              ...position,
              top: `${menuItemElemRect.top}px`
            };
          } else {
            position = {
              ...position,
              bottom: `calc(100% - ${menuItemElemRect.top + menuItemElemRect.height}px)`
            };
          }
          exports.FFBoxTooltip.show({
            content: menuItem.tooltip,
            style: position
          });
        }
      };
      this._onItemSelect = (event, menuItem) => {
        if (!("value" in menuItem) || menuItem.disabled) {
          return;
        }
        const isClickEvent = event.type === "mouseup" || event.type === "keydown" && event.key === "Enter";
        if (this.type === "action") {
          if (isClickEvent) {
            const result = this.onSelect ? this.onSelect(event, menuItem.value, menuItem.type !== "normal" ? menuItem.checked : void 0) : false;
            if (result === false) {
              (menuItem.onClick || (() => {
              }))(event, menuItem.value);
            }
            this.close();
          }
        } else if (this.type === "select") {
          if (menuItem.onClick) {
            if (isClickEvent) {
              menuItem.onClick(event, menuItem.value);
            }
          } else {
            (this.onSelect || (() => {
            }))(event, menuItem.value, menuItem.type !== "normal" ? menuItem.checked : void 0);
            if (isClickEvent) {
              this.close();
            }
          }
        }
      };
      this._handleSelect = (e2, menuItem) => {
        e2.stopPropagation();
        if ("value" in menuItem) {
          this._onItemSelect(e2, menuItem);
        }
      };
      this._handleMenuItemMouseEnter = (menuItem) => {
        this._setHoveredItem(menuItem);
      };
      this._handleMenuItemMouseLeave = () => {
        this._setHoveredItem(void 0);
      };
      this._handleMenuItemFocused = (e2, menuItem) => {
        var _a2;
        this._setHoveredItem(menuItem);
        (_a2 = this.returnFocus) == null ? void 0 : _a2.call(this, e2);
      };
      this._setHoveredItem = (newItem) => {
        var _a2;
        const oldItem = this._currentHoveredItem;
        this._currentHoveredItem = newItem;
        if (newItem !== void 0) {
          const found = this._getMenuByItem(newItem);
          if (!found) {
            return;
          }
          const { menu, indexInFlattened, indexInMenu } = found;
          const newOpenedKeys = [menu.menuIndex];
          let current = menu;
          while (current.parent) {
            current = current.parent;
            newOpenedKeys.unshift(current.menuIndex);
          }
          if (newItem.type === "submenu") {
            newOpenedKeys.push(newItem.key);
            const menuElem = this._menuElemRefs[indexInFlattened];
            const menuItemElem = menuElem.children[indexInMenu];
            const menuItemElemRect = menuItemElem.getBoundingClientRect();
            const currentPreferDirection = ((_a2 = this._openedSubMenuItemPos[menu.menuIndex]) == null ? void 0 : _a2.preferDirection) || "r";
            this._openedSubMenuItemPos[newItem.key] = {
              xMin: menuItemElemRect.x,
              yMin: menuItemElemRect.y,
              xMax: menuItemElemRect.x + menuItemElemRect.width,
              yMax: menuItemElemRect.y + menuItemElemRect.height,
              preferDirection: currentPreferDirection === "r" ? menuItemElemRect.x + menuItemElemRect.width * 1.5 > window.innerWidth ? "l" : "r" : menuItemElemRect.x < menuItemElemRect.width * 0.5 ? "r" : "l"
            };
            this._openedSubMenuItemPos = { ...this._openedSubMenuItemPos };
          }
          if (JSON.stringify(newOpenedKeys) !== JSON.stringify(this._openedSubMenus)) {
            this._openedSubMenus = newOpenedKeys;
            const newPos = { ...this._openedSubMenuItemPos };
            for (const key of Object.keys(newPos)) {
              if (!newOpenedKeys.includes(+key)) {
                delete newPos[+key];
              }
            }
            this._openedSubMenuItemPos = newPos;
          }
          setTimeout(() => {
            this._showTooltip(newItem);
          }, 0);
        }
        if ((newItem === void 0 || !("tooltip" in newItem)) && oldItem !== void 0) {
          exports.FFBoxTooltip.hide();
        }
      };
      this._keydownListener = (e2) => {
        var _a2, _b, _c;
        if (e2.key === "Escape") {
          this._handleCancel(e2);
        }
        let menuItem = this._currentHoveredItem;
        if (e2.key === "Enter") {
          if (menuItem) {
            this._handleSelect(e2, menuItem);
          }
        }
        if (!menuItem) {
          if (e2.key === "ArrowDown" || e2.key === "Home") {
            menuItem = Object.values(this._flattenedMenus)[0].menu[Object.values(this._flattenedMenus)[0].menu.length - 1];
          } else if (e2.key === "ArrowUp" || e2.key === "End") {
            menuItem = Object.values(this._flattenedMenus)[0].menu[0];
          } else {
            (_a2 = this.onKeyDown) == null ? void 0 : _a2.call(this, e2);
          }
        }
        if (!menuItem) {
          return;
        }
        const { menu, indexInFlattened, indexInMenu } = this._getMenuByItem(menuItem);
        if (e2.key === "ArrowUp" || e2.key === "ArrowDown") {
          e2.preventDefault();
          const menuElem = this._menuElemRefs[indexInFlattened];
          let currentIndex = indexInMenu;
          do {
            if (e2.key === "ArrowUp") {
              currentIndex = currentIndex === 0 ? menu.menu.length - 1 : currentIndex - 1;
            } else {
              currentIndex = currentIndex === menu.menu.length - 1 ? 0 : currentIndex + 1;
            }
            if (menu.menu[currentIndex].type !== "separator") {
              break;
            }
          } while (currentIndex !== indexInMenu);
          menuElem.children[currentIndex].focus();
          if (this.type === "select") {
            this._handleSelect(e2, menu.menu[currentIndex]);
          }
        }
        if (e2.key === "Home" || e2.key === "End") {
          const menuElem = this._menuElemRefs[indexInFlattened];
          const index = e2.key === "Home" ? 0 : menuElem.children.length - 1;
          menuElem.children[index].focus();
          if (this.type === "select") {
            this._handleSelect(e2, menu.menu[index]);
          }
        }
        if (e2.key === "ArrowLeft") {
          if (menu.parent) {
            const parentDOM = this._menuElemRefs[menu.parent.menuIndex];
            const menuItemIndex = menu.parent.menu.findIndex((menuItem2) => menuItem2.type === "submenu" && menuItem2.key === menu.menuIndex);
            parentDOM.children[menuItemIndex].focus();
          } else {
            (_b = this.onKeyDown) == null ? void 0 : _b.call(this, e2);
          }
        } else if (e2.key === "ArrowRight") {
          if (menuItem.type === "submenu") {
            const childDOM = this._menuElemRefs[menuItem.key];
            const activeIndex = menuItem.subMenu.findIndex((menuItem2) => "value" in menuItem2 && menuItem2.value === this._currentSelectedItem);
            const finalIndex = activeIndex !== -1 ? activeIndex : 0;
            childDOM.children[finalIndex].focus();
            if (this.type === "select") {
              this._handleSelect(e2, menuItem.subMenu[finalIndex]);
            }
          } else {
            (_c = this.onKeyDown) == null ? void 0 : _c.call(this, e2);
          }
        }
      };
      this._handleCancel = (event) => {
        const result = (this.onCancel || (() => {
        }))(event);
        if (result !== false) {
          this.close();
        }
        return result;
      };
    }
    willUpdate(changed) {
      if (changed.has("menu")) {
        this._flattenedMenus = this._flattenMenus();
      }
    }
    firstUpdated() {
      this._currentSelectedItem = this.selectedValue;
      if (!this.returnFocus) {
        document.addEventListener("keydown", this._keydownListener);
      }
      this._openedSubMenus = [0];
      const res = this._getMenuAndItemByValue(this.selectedValue);
      if (res) {
        const { menu, menuItem } = res;
        this._setHoveredItem(menuItem);
        setTimeout(() => {
          this._calcSubMenuPosition(menu.menuIndex);
          const { indexInFlattened, indexInMenu } = this._getMenuByItem(menuItem);
          const menuElem = this._menuElemRefs[indexInFlattened];
          const menuItemElem = menuElem.children[indexInMenu];
          menuItemElem.focus();
        }, 0);
      }
    }
    disconnectedCallback() {
      if (!this.returnFocus) {
        document.removeEventListener("keydown", this._keydownListener);
      }
      exports.FFBoxTooltip.hide();
      super.disconnectedCallback();
    }
    render() {
      const menus = Object.values(this._flattenedMenus).filter((menu) => this._openedSubMenus.includes(menu.menuIndex));
      return b`
			<div
				class=${["mask", this._leaving ? "maskLeaving" : ""].filter(Boolean).join(" ")}
				@click=${(e2) => this._handleCancel(e2)}
			>
				${menus.map((menu) => this._renderMenu(menu))}
			</div>
		`;
    }
    _renderMenu(menu) {
      return b`
			<div
				class="menu"
				style=${o$2(this._getMenuPosition(menu))}
				${n((el) => {
        if (el) this._menuElemRefs[menu.menuIndex] = el;
      })}
				@mouseup=${(e2) => e2.stopPropagation()}
				@click=${(e2) => e2.stopPropagation()}
			>
				${menu.menu.map((menuItem, index) => this._renderMenuItem(menuItem, index))}
			</div>
		`;
    }
    _renderMenuItem(menuItem, _index) {
      var _a2;
      return b`
			<div
				class=${this._getMenuItemClassName(menuItem)}
				tabindex=${menuItem.type === "separator" ? -1 : 0}
				@mouseup=${(e2) => this._handleSelect(e2, menuItem)}
				@mouseenter=${() => this._handleMenuItemMouseEnter(menuItem)}
				@mouseleave=${() => this._handleMenuItemMouseLeave()}
				@focus=${(e2) => this._handleMenuItemFocused(e2, menuItem)}
			>
				${menuItem.type !== "separator" ? b`
					<div class="label">
						${menuItem.label}
					</div>
				` : ""}
				${menuItem.type === "checkbox" || menuItem.type === "radio" ? b`
					<div class="iconArea">
						${menuItem.type === "checkbox" ? b`<ffbox-checkbox .checked=${menuItem.checked}></ffbox-checkbox>` : b`<ffbox-radio .checked=${menuItem.checked}></ffbox-radio>`}
					</div>
				` : ""}
				${"icon" in menuItem && menuItem.icon ? b`
					<div class="iconArea">
						${menuItem.icon}
					</div>
				` : ""}
				${menuItem.type === "submenu" ? b`
					<div class=${["iconRightArea", ((_a2 = this._openedSubMenuItemPos[menuItem.key ?? -1]) == null ? void 0 : _a2.preferDirection) === "l" ? "flipped" : ""].filter(Boolean).join(" ")}>
						${o$3(rightIcon)}
					</div>
				` : ""}
			</div>
		`;
    }
    // 将所有子菜单打平，这样就能使用一个循环渲染所有菜单
    // （Vue 版本需 toRaw 解除响应式代理才能做 === 比较，Lit 直接持有原始引用，无需此步骤）
    _flattenMenus() {
      const allMenus = [];
      let i2 = 0;
      const queue = [{
        menu: this.menu,
        menuIndex: i2,
        parent: null
      }];
      while (queue.length) {
        const menu = queue.shift();
        allMenus.push(menu);
        for (const menuItem of menu.menu) {
          if (menuItem.type === "submenu") {
            i2++;
            menuItem.key = i2;
            queue.push({
              menu: menuItem.subMenu,
              menuIndex: i2,
              parent: menu
            });
          }
        }
      }
      const ret = [];
      for (const menu of allMenus) {
        ret[menu.menuIndex] = menu;
      }
      return ret;
    }
    _getMenuItemClassName(menuItem) {
      if (menuItem.type === "separator") {
        return "menuSeparator";
      } else {
        let retStr = ["menuItem"];
        if (menuItem.disabled) {
          retStr.push("menuItemDisabled");
        }
        if ("value" in menuItem && this._currentSelectedItem === menuItem.value) {
          retStr.push("menuItemSelected");
        } else {
          if (this._currentHoveredItem === menuItem) {
            retStr.push("menuItemHovered");
          }
          if (menuItem.type === "submenu") {
            if (this._openedSubMenus.includes(menuItem.key)) {
              retStr.push("menuItemHovered");
            }
          }
        }
        return retStr.join(" ");
      }
    }
    _getMenuPosition(menu) {
      const menuItemHeight = 32;
      const menuSeparatorHeight = 9;
      const menuPaddingY = 6;
      let ScreenWidth = document.documentElement.clientWidth;
      let ScreenHeight = document.documentElement.clientHeight;
      const canvas = document.createElement("canvas");
      canvas.style.position = "fixed";
      canvas.style.top = "150px";
      const context = canvas.getContext("2d");
      context.font = getComputedStyle(document.body).font.replace(/\d+px/, "14px");
      const listWidth2 = menu.menu.reduce((prev, curr) => {
        if ("label" in curr) {
          const metrics = context.measureText(curr.label);
          context.fillText(curr.label, 0, Math.random() * 150);
          return Math.max(metrics.width, prev);
        } else {
          return prev;
        }
      }, 0);
      const listWidth = Math.min(listWidth2 + 86, Math.min(window.innerWidth, 800));
      const listHeight = menu.menu.reduce((prev, curr) => prev + (curr.type === "separator" ? menuSeparatorHeight : menuItemHeight), 0) + menuPaddingY * 2;
      const _triggerRect = this._openedSubMenuItemPos[menu.menuIndex] || this.triggerRect || { xMin: 0, yMin: 0, xMax: listWidth, yMax: 0 };
      const isHorizontal = this._openedSubMenuItemPos[menu.menuIndex] !== void 0;
      let finalPosition = {};
      if (isHorizontal) {
        const direction = "preferDirection" in _triggerRect && _triggerRect.preferDirection === "l" ? "l" : "r";
        const finalLeft = direction === "r" ? Math.min(_triggerRect.xMax, ScreenWidth - listWidth) : Math.max(_triggerRect.xMin - listWidth, 0);
        finalPosition = {
          left: `${finalLeft}px`,
          width: `${listWidth}px`
        };
      } else {
        const finalWidth = Math.max(listWidth, _triggerRect.xMax - _triggerRect.xMin);
        const centralX = Math.max(finalWidth / 2, Math.min((_triggerRect.xMax + _triggerRect.xMin) / 2, ScreenWidth - finalWidth / 2));
        finalPosition = {
          left: `${centralX - finalWidth / 2}px`,
          width: `${finalWidth}px`
        };
      }
      let upperSpace = isHorizontal ? _triggerRect.yMax : _triggerRect.yMin;
      let lowerSpace = ScreenHeight - (isHorizontal ? _triggerRect.yMin : _triggerRect.yMax);
      if (upperSpace >= lowerSpace) {
        if (listHeight <= upperSpace) {
          finalPosition = { ...finalPosition, height: `${listHeight}px`, bottom: `${ScreenHeight - upperSpace}px` };
        } else {
          finalPosition = { ...finalPosition, height: `${upperSpace}px`, top: `${0}px` };
        }
      } else {
        if (listHeight <= lowerSpace) {
          finalPosition = { ...finalPosition, height: `${listHeight}px`, top: `${ScreenHeight - lowerSpace}px` };
        } else {
          finalPosition = { ...finalPosition, height: `${lowerSpace}px`, bottom: `${0}px` };
        }
      }
      return finalPosition;
    }
    _getMenuByItem(menuItem) {
      for (const [keyInFlattened, menu] of Object.entries(this._flattenedMenus)) {
        for (const [keyInMenu, _menuItem] of Object.entries(menu.menu)) {
          if (_menuItem === menuItem) {
            return {
              menu,
              indexInFlattened: Number(keyInFlattened),
              indexInMenu: Number(keyInMenu)
            };
          }
        }
      }
    }
    _getMenuAndItemByValue(value) {
      for (const menu of Object.values(this._flattenedMenus)) {
        for (const menuItem of menu.menu) {
          if ("value" in menuItem && menuItem.value === value) {
            return {
              menu,
              menuItem
            };
          }
        }
      }
    }
    /** 关闭前给个机会展示退出动画（对应 Vue 版 exposed.preClose） */
    preClose() {
      this._leaving = true;
    }
    /**
     * 关闭菜单，播完离场动画后组件自行从 DOM 移除
     * （对应 Vue 版 Menu.tsx 的 handleClose：同一次 render 内第二次调用时，需判断是否已经被卸载）
     */
    close() {
      if (!this._unmounted) {
        this.preClose();
        (this.onClose || (() => {
        }))();
        this._unmounted = true;
        setTimeout(() => {
          this.remove();
        }, 150);
      }
    }
    /** 由外部（如 DropdownInput）转发键盘事件（对应 Vue 版 exposed.triggerKeyboardEvent） */
    triggerKeyboardEvent(event) {
      this._keydownListener(event);
    }
    /** 更改选中值并主动反馈至菜单（对应 Vue 版 exposed.setSelectedValue） */
    setSelectedValue(value) {
      this._currentSelectedItem = value;
    }
  };
  exports.FFBoxMenu.styles = i$6`
		:host {
			display: block;
			position: fixed;
			left: 0;
			top: 0;
			width: 100%;
			height: 100%;
			color: inherit;
			z-index: 10;
		}
		.mask {
			position: relative;
			width: 100%;
			height: 100%;
			// pointer-events: none;
		}
		.menu {
			position: absolute;
			// width: 200px;
			box-sizing: border-box;
			padding: 6px;
			border-radius: 8px;
			font-size: 0;
			text-align: left;
			overflow-y: auto;
			background: hwb(var(--bg98));
			box-shadow: 0px 4px 12px rgba(0, 0, 0, 0.3);
			-webkit-app-region: none;
			user-select: none;
			/* 对应 Vue TransitionGroup 的 menuAnimate-enter 动画，原生 animation 在元素插入时自动触发 */
			animation: menuAnimateEnter cubic-bezier(0.33, 1, 1, 1) 0.15s, menuAnimateEnterOpacity linear 0.1s;
		}
		@keyframes menuAnimateEnter {
			from { transform: scale(0.95); }
			to { transform: scale(1); }
		}
		@keyframes menuAnimateEnterOpacity {
			from { opacity: 0; }
			to { opacity: 1; }
		}
		/* 对应 menuAnimate-leave 动画。Lit 无 TransitionGroup，由 maskLeaving 类统一驱动离场 */
		.maskLeaving .menu {
			transform: scale(0.95);
			opacity: 0;
			transition: all linear 0.1s;
		}
		.menu::-webkit-scrollbar {
			position: relative;
			width: 12px;
			// background: transparent;
			box-shadow: 12px 0 12px -12px hwb(0 50% 50% / 0.08) inset;
		}
		.menu::-webkit-scrollbar-thumb {
			border-radius: 12px;
			background: hwb(0 50% 50% / 0.3);
			border: 3px solid transparent;
			background-clip: content-box;
			// box-shadow: 0 0 4px red;
		}
		.menu::-webkit-scrollbar-track {
			background: none;
		}
		.menuItem {
			display: inline-block;
			position: relative;
			box-sizing: border-box;
			width: 100%;
			height: 32px;
			// border-bottom: #EEE 1px solid;
			border-radius: 4px;
			font-size: 14px;
			// outline: none;
		}
		.menuItem .label {
			position: absolute;
			top: 0;
			left: 30px;
			right: 30px;
			line-height: 32px;
			white-space: nowrap;
			text-overflow: ellipsis;
			overflow: hidden;
		}
		.menuItem .iconArea {
			position: absolute;
			top: 0;
			left: 0;
			width: 28px;
			height: 32px;
			display: flex;
			justify-content: center;
			align-items: center;
		}
		.menuItem .iconArea > svg {
			width: 20px;
			height: 20px;
		}
		.menuItem .iconRightArea {
			position: absolute;
			top: 0;
			right: 0;
			width: 28px;
			height: 32px;
		}
		.menuItem .iconRightArea svg {
			position: absolute;
			left: 25%;
			top: 25%;
			width: 50%;
			height: 50%;
		}
		/* 子菜单倾向向左打开时，右三角翻转（对应 Vue 的 :style transform rotate） */
		.menuItem .iconRightArea.flipped svg {
			transform: rotate(180deg);
		}
		.menuItem .opArea {
			position: absolute;
			top: 0;
			left: 0;
			width: 28px;
			height: 32px;
		}
		.menuItemDisabled {
			opacity: 0.3;
		}
		.menuItemSelected {
			background: hwb(var(--menuItemSelected));
		}
		.menuItemHovered {
			background: hwb(var(--menuItemHovered));
		}
		.menuSeparator {
			display: inline-block;
			position: relative;
			width: 100%;
			height: 1px;
			margin: 4px 0;
			background-color: #77777733;
		}
	`;
  __decorateClass$1([
    n$4({ attribute: false })
  ], exports.FFBoxMenu.prototype, "menu", 2);
  __decorateClass$1([
    n$4({ attribute: false })
  ], exports.FFBoxMenu.prototype, "type", 2);
  __decorateClass$1([
    n$4({ attribute: false })
  ], exports.FFBoxMenu.prototype, "selectedValue", 2);
  __decorateClass$1([
    n$4({ attribute: false })
  ], exports.FFBoxMenu.prototype, "triggerRect", 2);
  __decorateClass$1([
    n$4({ attribute: false })
  ], exports.FFBoxMenu.prototype, "onSelect", 2);
  __decorateClass$1([
    n$4({ attribute: false })
  ], exports.FFBoxMenu.prototype, "onCancel", 2);
  __decorateClass$1([
    n$4({ attribute: false })
  ], exports.FFBoxMenu.prototype, "onClose", 2);
  __decorateClass$1([
    n$4({ attribute: false })
  ], exports.FFBoxMenu.prototype, "onKeyDown", 2);
  __decorateClass$1([
    n$4({ attribute: false })
  ], exports.FFBoxMenu.prototype, "returnFocus", 2);
  __decorateClass$1([
    c$1({ context: themeContext, subscribe: true }),
    n$4({ reflect: true, attribute: "data-theme" })
  ], exports.FFBoxMenu.prototype, "theme", 2);
  __decorateClass$1([
    r$2()
  ], exports.FFBoxMenu.prototype, "_openedSubMenus", 2);
  __decorateClass$1([
    r$2()
  ], exports.FFBoxMenu.prototype, "_openedSubMenuItemPos", 2);
  __decorateClass$1([
    r$2()
  ], exports.FFBoxMenu.prototype, "_currentHoveredItem", 2);
  __decorateClass$1([
    r$2()
  ], exports.FFBoxMenu.prototype, "_currentSelectedItem", 2);
  __decorateClass$1([
    r$2()
  ], exports.FFBoxMenu.prototype, "_leaving", 2);
  exports.FFBoxMenu = __decorateClass$1([
    t$3("ffbox-menu")
  ], exports.FFBoxMenu);
  function _detectTheme() {
    const provider = document.querySelector("ffbox-theme-provider");
    if (provider) return provider.theme === "dark" ? "dark" : "light";
    return "light";
  }
  exports.FFBoxMenu.showMenu = function(options) {
    const el = document.createElement("ffbox-menu");
    el.menu = options.menu;
    el.type = options.type || "action";
    el.selectedValue = options.selectedValue;
    if (options.triggerRect) {
      el.triggerRect = options.triggerRect;
    } else if (options.triggerElem) {
      const rect = options.triggerElem.getBoundingClientRect();
      el.triggerRect = { xMin: rect.left, yMin: rect.top, xMax: rect.right, yMax: rect.bottom };
    }
    el.onSelect = options.onSelect;
    el.onCancel = options.onCancel;
    el.onClose = options.onClose;
    el.onKeyDown = options.onKeyDown;
    el.returnFocus = options.returnFocus;
    el.theme = _detectTheme();
    const container2 = options.container || document.body;
    container2.appendChild(el);
    return {
      menu: el,
      close: () => el.close(),
      triggerKeyboardEvent: (event) => el.triggerKeyboardEvent(event),
      setSelectedValue: (value) => el.setSelectedValue(value)
    };
  };
  const menuButtonIcon = '<?xml version="1.0" standalone="no"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg t="1565771142011" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="2592" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><style type="text/css"></style></defs><path d="M230.4 588.8c42.415 0 76.8-34.385 76.8-76.8s-34.385-76.8-76.8-76.8-76.8 34.385-76.8 76.8 34.385 76.8 76.8 76.8zM512 588.8c42.415 0 76.8-34.385 76.8-76.8s-34.385-76.8-76.8-76.8-76.8 34.385-76.8 76.8 34.385 76.8 76.8 76.8zM793.6 588.8c42.415 0 76.8-34.385 76.8-76.8s-34.385-76.8-76.8-76.8-76.8 34.385-76.8 76.8 34.385 76.8 76.8 76.8z" fill="#7f7f7f" p-id="2593"></path></svg>';
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __decorateClass = (decorators, target, key, kind) => {
    var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
    for (var i2 = decorators.length - 1, decorator; i2 >= 0; i2--)
      if (decorator = decorators[i2])
        result = (kind ? decorator(target, key, result) : decorator(result)) || result;
    if (kind && result) __defProp(target, key, result);
    return result;
  };
  exports.FFBoxDropdownInput = class FFBoxDropdownInput extends i$3 {
    constructor() {
      super(...arguments);
      this.list = [];
      this.readonly = false;
      this.disabled = false;
      this.placeholder = "";
      this.theme = "light";
      this._focused = false;
      this._inputText = "-";
      this._invalidMsg = void 0;
      this._menuHandle = null;
      this._openMenu = () => {
        if (this.disabled) {
          return;
        }
        this._menuHandle = exports.FFBoxMenu.showMenu({
          menu: this.list,
          type: "select",
          selectedValue: this.text,
          triggerElem: this._selectorEl,
          // 传入触发元素，菜单据此计算弹出位置与方向
          onSelect: (_event, value) => {
            this._inputText = value;
            this.text = value;
            this._validate();
            this._dispatchChange(value);
            this._menuHandle.setSelectedValue(value);
          },
          onClose: () => {
            this._menuHandle = null;
          },
          returnFocus: (_e) => {
            this._selectorEl.firstElementChild.focus();
          },
          onKeyDown: (e2) => {
            if (["ArrowLeft", "ArrowRight"].includes(e2.key)) {
              let selPos = this._selectorEl.firstChild.selectionStart || 0;
              if (e2.key === "ArrowLeft") {
                selPos--;
              } else if (e2.key === "ArrowRight") {
                selPos++;
              }
              this._selectorEl.firstChild.selectionStart = selPos;
              this._selectorEl.firstChild.selectionEnd = selPos;
            }
          }
        });
        this._selectorEl.firstElementChild.focus();
      };
    }
    willUpdate(changed) {
      if (changed.has("text")) {
        this._inputText = this.text !== void 0 ? this.text + "" : "";
        this._validate();
      }
      if (changed.has("validator")) {
        this._validate();
      }
    }
    render() {
      const classes = ["combobox-selector"];
      if (this._focused) classes.push("focused");
      if (this._invalidMsg) classes.push("invalid");
      return b`
			<div class=${classes.join(" ")} @click=${this._openMenu}>
				<input
					type="text"
					.value=${this._inputText}
					?readonly=${this.readonly || this.disabled}
					?disabled=${this.disabled}
					.placeholder=${this.placeholder}
					@blur=${this._handleBlur}
					@focus=${this._handleFocus}
					@input=${this._handleInput}
					@keydown=${this._handleKeydown}
				/>
				<span class="combobox-selector-img">${o$3(menuButtonIcon)}</span>
			</div>
		`;
    }
    _handleBlur() {
      this._focused = false;
    }
    _handleFocus() {
      this._focused = true;
    }
    _handleInput(event) {
      var _a2;
      const input = event.target;
      this._inputText = this.inputFixer ? this.inputFixer(input.value) : input.value;
      this.text = this._inputText;
      let newValue = input.value;
      (_a2 = this._menuHandle) == null ? void 0 : _a2.setSelectedValue(newValue);
      this._validate();
      this._dispatchChange(newValue);
    }
    _handleKeydown(event) {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Enter", "Escape"].includes(event.key)) {
        if (this._menuHandle) {
          this._menuHandle.triggerKeyboardEvent(event);
          event.preventDefault();
        } else {
          if (event.key === "Enter") {
            this.dispatchEvent(new CustomEvent("enter", {
              bubbles: true,
              composed: true
            }));
          }
          if (["ArrowUp", "ArrowDown", "Enter"].includes(event.key)) {
            this._openMenu();
            event.preventDefault();
          }
        }
      }
    }
    _validate() {
      if (this.validator) {
        this._invalidMsg = this.validator(this._inputText ?? "");
      } else {
        this._invalidMsg = void 0;
      }
    }
    _dispatchChange(value) {
      this.dispatchEvent(new CustomEvent("change", {
        detail: value,
        bubbles: true,
        composed: true
      }));
    }
  };
  exports.FFBoxDropdownInput.styles = i$6`
		:host {
			display: inline-block;
		}

		.combobox-selector {
			position: relative;
			height: 24px;
			/* width: 122px; */
			flex-grow: 1;
			border-radius: 24px;
			background: var(--f7);
			border: #AAA 1px solid;
			box-shadow: 0px 4px 8px rgba(0, 0, 0, 0.1);
		}
		.combobox-selector:hover {
			background: var(--ff);
		}
		.combobox-selector:active {
			background: var(--e7);
		}
		.combobox-selector.focused {
			background: var(--ff);
		}
		/* 校验有误的情况下背景和边框都变红 */
		.combobox-selector.invalid {
			border: var(--errorBorder) 1px solid;
			box-shadow: 0 0 12px hsla(0, 100%, 60%, 0.3), 0px 4px 8px hwb(0 0 0 / 0.05);
		}
		.combobox-selector.invalid.focused {
			background: var(--errorBgActive);
		}
		.combobox-selector.invalid:not(.focused) {
			background: var(--errorBg);
		}
		/* 禁用的情况下整体变透明，并且固定背景颜色 */
		:host([disabled]) .combobox-selector {
			opacity: 0.6;
			color: var(--66); /* 默认，20% 亮度黑色，变灰 40% 亮度黑色 */
			background: var(--f7);
		}

		.combobox-selector input {
			position: absolute;
			left: 6px;
			width: calc(100% - 28px);
			height: 24px;
			line-height: 24px;
			background: none;
			border: none;
			margin: 0;
			padding: 0;
			outline: none;
			font-family: inherit;
			font-size: 13px;
			color: inherit;
		}

		.combobox-selector-img {
			position: absolute;
			right: 6px;
			top: 4px;
			width: 16px;
			height: 16px;
			font-size: 0; /* 纯 HTML 状态下，代码中的换行会被渲染出来，需要设置为 0 来屏蔽 */
		}
	`;
  __decorateClass([
    n$4({ attribute: false })
  ], exports.FFBoxDropdownInput.prototype, "text", 2);
  __decorateClass([
    n$4({ attribute: false })
  ], exports.FFBoxDropdownInput.prototype, "list", 2);
  __decorateClass([
    n$4({ type: Boolean, reflect: true })
  ], exports.FFBoxDropdownInput.prototype, "readonly", 2);
  __decorateClass([
    n$4({ type: Boolean, reflect: true })
  ], exports.FFBoxDropdownInput.prototype, "disabled", 2);
  __decorateClass([
    n$4()
  ], exports.FFBoxDropdownInput.prototype, "placeholder", 2);
  __decorateClass([
    n$4({ attribute: false })
  ], exports.FFBoxDropdownInput.prototype, "validator", 2);
  __decorateClass([
    n$4({ attribute: false })
  ], exports.FFBoxDropdownInput.prototype, "inputFixer", 2);
  __decorateClass([
    c$1({ context: themeContext, subscribe: true }),
    n$4({ reflect: true, attribute: "data-theme" })
  ], exports.FFBoxDropdownInput.prototype, "theme", 2);
  __decorateClass([
    r$2()
  ], exports.FFBoxDropdownInput.prototype, "_focused", 2);
  __decorateClass([
    r$2()
  ], exports.FFBoxDropdownInput.prototype, "_inputText", 2);
  __decorateClass([
    r$2()
  ], exports.FFBoxDropdownInput.prototype, "_invalidMsg", 2);
  __decorateClass([
    e$4(".combobox-selector")
  ], exports.FFBoxDropdownInput.prototype, "_selectorEl", 2);
  exports.FFBoxDropdownInput = __decorateClass([
    t$3("ffbox-dropdown-input")
  ], exports.FFBoxDropdownInput);
  exports.LitElement = i$3;
  exports.css = i$6;
  exports.disableTooltipAutoscan = disableTooltipAutoscan;
  exports.durationFixer = durationFixer;
  exports.durationValidator = durationValidator;
  exports.enableTooltipAutoscan = enableTooltipAutoscan;
  exports.getMenuItemByValue = getMenuItemByValue;
  exports.html = b;
  exports.notEmptyValidator = notEmptyValidator;
  exports.numberValidator = numberValidator;
  exports.svg = w;
  exports.themeContext = themeContext;
  exports.tooltip = tooltip;
  exports.useTooltip = useTooltip;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  return exports;
})({});
//# sourceMappingURL=ffbox-ui.iife.js.map
