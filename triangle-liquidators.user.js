// ==UserScript==
// @name         Triangle Liquidators – Hide, Filter & Bid Confirm
// @namespace    https://triangleliquidators.com/
// @version      3.4.0
// @description  A fast cached catalog view at /tlx, with confirmed bidding. The site's other pages are left unchanged.
// @homepageURL  https://github.com/spencersutton/tampermonkey
// @downloadURL  https://raw.githubusercontent.com/spencersutton/tampermonkey/main/triangle-liquidators.user.js
// @updateURL    https://raw.githubusercontent.com/spencersutton/tampermonkey/main/triangle-liquidators.user.js
// @match        https://triangleliquidators.com/tlx*
// @match        https://www.triangleliquidators.com/tlx*
// @grant        GM_addValueChangeListener
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-start
// ==/UserScript==

(function() {
	"use strict";
	var n;
	var l$1;
	var u$2;
	var i$2;
	var r$1;
	var o$1;
	var e$1;
	var f$2;
	var c$1;
	var a$1;
	var s$1;
	var h$1;
	var p$1;
	var v$1;
	var d$1 = {};
	var w$1 = [];
	var _$1 = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;
	var g$1 = Array.isArray;
	function m$1(n, l) {
		for (var u in l) n[u] = l[u];
		return n;
	}
	function b(n) {
		n && n.parentNode && n.parentNode.removeChild(n);
	}
	function k$1(l, u, t) {
		var i, r, o, e = {};
		for (o in u) "key" == o ? i = u[o] : "ref" == o ? r = u[o] : e[o] = u[o];
		if (arguments.length > 2 && (e.children = arguments.length > 3 ? n.call(arguments, 2) : t), "function" == typeof l && null != l.defaultProps) for (o in l.defaultProps) void 0 === e[o] && (e[o] = l.defaultProps[o]);
		return x(l, e, i, r, null);
	}
	function x(n, t, i, r, o) {
		var e = {
			type: n,
			props: t,
			key: i,
			ref: r,
			__k: null,
			__: null,
			__b: 0,
			__e: null,
			__c: null,
			constructor: void 0,
			__v: null == o ? ++u$2 : o,
			__i: -1,
			__u: 0
		};
		return null == o && null != l$1.vnode && l$1.vnode(e), e;
	}
	function S(n) {
		return n.children;
	}
	function C$2(n, l) {
		this.props = n, this.context = l;
	}
	function $(n, l) {
		if (null == l) return n.__ ? $(n.__, n.__i + 1) : null;
		for (var u; l < n.__k.length; l++) if (null != (u = n.__k[l]) && null != u.__e) return u.__e;
		return "function" == typeof n.type ? $(n) : null;
	}
	function I(n) {
		if (n.__P && n.__d) {
			var u = n.__v, t = u.__e, i = [], r = [], o = m$1({}, u);
			o.__v = u.__v + 1, l$1.vnode && l$1.vnode(o), q$2(n.__P, o, u, n.__n, n.__P.namespaceURI, 32 & u.__u ? [t] : null, i, null == t ? $(u) : t, !!(32 & u.__u), r), o.__v = u.__v, o.__.__k[o.__i] = o, D$1(i, o, r), u.__e = u.__ = null, o.__e != t && P$1(o);
		}
	}
	function P$1(n) {
		if (null != (n = n.__) && null != n.__c) return n.__e = n.__c.base = null, n.__k.some(function(l) {
			if (null != l && null != l.__e) return n.__e = n.__c.base = l.__e;
		}), P$1(n);
	}
	function A$2(n) {
		(!n.__d && (n.__d = !0) && i$2.push(n) && !H$1.__r++ || r$1 != l$1.debounceRendering) && ((r$1 = l$1.debounceRendering) || o$1)(H$1);
	}
	function H$1() {
		try {
			for (var n, l = 1; i$2.length;) i$2.length > l && i$2.sort(e$1), n = i$2.shift(), l = i$2.length, I(n);
		} finally {
			i$2.length = H$1.__r = 0;
		}
	}
	function L(n, l, u, t, i, r, o, e, f, c, a) {
		var s, h, p, v, y, _, g = t && t.__k || w$1, m = l.length;
		for (f = T$2(u, l, g, f, m), s = 0; s < m; s++) null != (p = u.__k[s]) && (h = -1 != p.__i && g[p.__i] || d$1, p.__i = s, _ = q$2(n, p, h, i, r, o, e, f, c, a), v = p.__e, p.ref && h.ref != p.ref && (h.ref && J$1(h.ref, null, p), a.push(p.ref, p.__c || v, p)), null == y && null != v && (y = v), 4 & p.__u ? (f = j$2(p, f, n), h.__e && (h.__e = null)) : "function" == typeof p.type && void 0 !== _ ? f = _ : v && (f = v.nextSibling), p.__u &= -7);
		return u.__e = y, f;
	}
	function T$2(n, l, u, t, i) {
		var r, o, e, f, c, a = u.length, s = a, h = 0;
		for (n.__k = new Array(i), r = 0; r < i; r++) null != (o = l[r]) && "boolean" != typeof o && "function" != typeof o ? ("string" == typeof o || "number" == typeof o || "bigint" == typeof o || o.constructor == String ? o = n.__k[r] = x(null, o, null, null, null) : g$1(o) ? o = n.__k[r] = x(S, { children: o }, null, null, null) : void 0 === o.constructor && o.__b > 0 ? o = n.__k[r] = x(o.type, o.props, o.key, o.ref ? o.ref : null, o.__v) : n.__k[r] = o, f = r + h, o.__ = n, o.__b = n.__b + 1, e = null, -1 != (c = o.__i = O$1(o, u, f, s)) && (s--, (e = u[c]) && (e.__u |= 2)), null == e || null == e.__v ? (-1 == c && (i > a ? h-- : i < a && h++), "function" != typeof o.type && (o.__u |= 4)) : c != f && (c == f - 1 ? h-- : c == f + 1 ? h++ : (c > f ? h-- : h++, o.__u |= 4))) : n.__k[r] = null;
		if (s) for (r = 0; r < a; r++) null != (e = u[r]) && 0 == (2 & e.__u) && (e.__e == t && (t = $(e)), K$1(e, e));
		return t;
	}
	function j$2(n, l, u) {
		var t, i;
		if ("function" == typeof n.type) {
			for (t = n.__k, i = 0; t && i < t.length; i++) t[i] && (t[i].__ = n, l = j$2(t[i], l, u));
			return l;
		}
		n.__e != l && (l && n.type && !l.parentNode && (l = $(n)), l = u.insertBefore(n.__e, l || null));
		do
			l = l && l.nextSibling;
		while (null != l && 8 == l.nodeType);
		return l;
	}
	function F(n, l) {
		return l = l || [], null == n || "boolean" == typeof n || (g$1(n) ? n.some(function(n) {
			F(n, l);
		}) : l.push(n)), l;
	}
	function O$1(n, l, u, t) {
		var i, r, o, e = n.key, f = n.type, c = l[u], a = null != c && 0 == (2 & c.__u);
		if (null === c && null == e || a && e == c.key && f == c.type) return u;
		if (t > (a ? 1 : 0)) {
			for (i = u - 1, r = u + 1; i >= 0 || r < l.length;) if (null != (c = l[o = i >= 0 ? i-- : r++]) && 0 == (2 & c.__u) && e == c.key && f == c.type) return o;
		}
		return -1;
	}
	function z$1(n, l, u) {
		"-" == l[0] ? n.setProperty(l, null == u ? "" : u) : n[l] = null == u ? "" : "number" != typeof u || _$1.test(l) ? u : u + "px";
	}
	function N$1(n, l, u, t, i) {
		var r, o;
		n: if ("style" == l) if ("string" == typeof u) n.style.cssText = u;
		else {
			if ("string" == typeof t && (n.style.cssText = t = ""), t) for (l in t) u && l in u || z$1(n.style, l, "");
			if (u) for (l in u) t && u[l] == t[l] || z$1(n.style, l, u[l]);
		}
		else if ("o" == l[0] && "n" == l[1]) r = l != (l = l.replace(s$1, "$1")), o = l.toLowerCase(), l = o in n || "onFocusOut" == l || "onFocusIn" == l ? o.slice(2) : l.slice(2), n.l || (n.l = {}), n.l[l + r] = u, u ? t ? u[a$1] = t[a$1] : (u[a$1] = h$1, n.addEventListener(l, r ? v$1 : p$1, r)) : n.removeEventListener(l, r ? v$1 : p$1, r);
		else {
			if ("http://www.w3.org/2000/svg" == i) l = l.replace(/xlink(H|:h)/, "h").replace(/sName$/, "s");
			else if ("width" != l && "height" != l && "href" != l && "list" != l && "form" != l && "tabIndex" != l && "download" != l && "rowSpan" != l && "colSpan" != l && "role" != l && "popover" != l && l in n) try {
				n[l] = null == u ? "" : u;
				break n;
			} catch (n) {}
			"function" == typeof u || (null == u || !1 === u && "-" != l[4] ? n.removeAttribute(l) : n.setAttribute(l, "popover" == l && 1 == u ? "" : u));
		}
	}
	function V$1(n) {
		return function(u) {
			if (this.l) {
				var t = this.l[u.type + n];
				if (null == u[c$1]) u[c$1] = h$1++;
				else if (u[c$1] < t[a$1]) return;
				return t(l$1.event ? l$1.event(u) : u);
			}
		};
	}
	function q$2(n, u, t, i, r, o, e, f, c, a) {
		var s, h, p, v, y, d, _, k, x, M, I, P, A, H, T, j, F = u.type;
		if (void 0 !== u.constructor) return null;
		128 & t.__u && (c = !!(32 & t.__u), o = [f = u.__e = t.__e]), (s = l$1.__b) && s(u);
		n: if ("function" == typeof F) {
			h = e.length;
			try {
				if (x = u.props, M = F.prototype && F.prototype.render, I = (s = F.contextType) && i[s.__c], P = s ? I ? I.props.value : s.__ : i, t.__c ? k = (p = u.__c = t.__c).__ = p.__E : (M ? u.__c = p = new F(x, P) : (u.__c = p = new C$2(x, P), p.constructor = F, p.render = Q$1), I && I.sub(p), p.state || (p.state = {}), p.__n = i, v = p.__d = !0, p.__h = [], p._sb = []), M && null == p.__s && (p.__s = p.state), M && null != F.getDerivedStateFromProps && (p.__s == p.state && (p.__s = m$1({}, p.__s)), m$1(p.__s, F.getDerivedStateFromProps(x, p.__s))), y = p.props, d = p.state, p.__v = u, v) M && null == F.getDerivedStateFromProps && null != p.componentWillMount && p.componentWillMount(), M && null != p.componentDidMount && p.__h.push(p.componentDidMount);
				else {
					if (M && null == F.getDerivedStateFromProps && x !== y && null != p.componentWillReceiveProps && p.componentWillReceiveProps(x, P), u.__v == t.__v || !p.__e && null != p.shouldComponentUpdate && !1 === p.shouldComponentUpdate(x, p.__s, P)) {
						u.__v != t.__v && (p.props = x, p.state = p.__s, p.__d = !1), u.__e = t.__e, u.__k = t.__k, u.__k.some(function(n) {
							n && (n.__ = u);
						}), w$1.push.apply(p.__h, p._sb), p._sb = [], p.__h.length && e.push(p), f = $(t);
						break n;
					}
					null != p.componentWillUpdate && p.componentWillUpdate(x, p.__s, P), M && null != p.componentDidUpdate && p.__h.push(function() {
						p.componentDidUpdate(y, d, _);
					});
				}
				if (p.context = P, p.props = x, p.__P = n, p.__e = !1, A = l$1.__r, H = 0, M) p.state = p.__s, p.__d = !1, A && A(u), s = p.render(p.props, p.state, p.context), w$1.push.apply(p.__h, p._sb), p._sb = [];
				else do
					p.__d = !1, A && A(u), s = p.render(p.props, p.state, p.context), p.state = p.__s;
				while (p.__d && ++H < 25);
				p.state = p.__s, null != p.getChildContext && (i = m$1(m$1({}, i), p.getChildContext())), M && !v && null != p.getSnapshotBeforeUpdate && (_ = p.getSnapshotBeforeUpdate(y, d)), T = null != s && s.type === S && null == s.key ? E$1(s.props.children) : s, f = L(n, g$1(T) ? T : [T], u, t, i, r, o, e, f, c, a), p.base = u.__e, u.__u &= -161, p.__h.length && e.push(p), k && (p.__E = p.__ = null);
			} catch (n) {
				if (e.length = h, u.__v = null, c || null != o) {
					if (n.then) {
						for (u.__u |= c ? 160 : 128; f && 8 == f.nodeType && f.nextSibling;) f = f.nextSibling;
						null != o && (o[o.indexOf(f)] = null), u.__e = f;
					} else if (null != o) for (j = o.length; j--;) b(o[j]);
				} else u.__e = t.__e;
				u.__k ??= t.__k || [], n.then || B$2(u), l$1.__e(n, u, t);
			}
		} else null == o && u.__v == t.__v ? (u.__k = t.__k, u.__e = t.__e) : f = u.__e = G$1(t.__e, u, t, i, r, o, e, c, a);
		return (s = l$1.diffed) && s(u), 128 & u.__u ? void 0 : f;
	}
	function B$2(n) {
		n && (n.__c && (n.__c.__e = !0), n.__k && n.__k.some(B$2));
	}
	function D$1(n, u, t) {
		for (var i = 0; i < t.length; i++) J$1(t[i], t[++i], t[++i]);
		l$1.__c && l$1.__c(u, n), n.some(function(u) {
			try {
				n = u.__h, u.__h = [], n.some(function(n) {
					n.call(u);
				});
			} catch (n) {
				l$1.__e(n, u.__v);
			}
		});
	}
	function E$1(n) {
		return "object" != typeof n || null == n || n.__b > 0 ? n : g$1(n) ? n.map(E$1) : void 0 !== n.constructor ? null : m$1({}, n);
	}
	function G$1(u, t, i, r, o, e, f, c, a) {
		var s, h, p, v, y, w, _, m = i.props || d$1, k = t.props, x = t.type;
		if ("svg" == x ? o = "http://www.w3.org/2000/svg" : "math" == x ? o = "http://www.w3.org/1998/Math/MathML" : o || (o = "http://www.w3.org/1999/xhtml"), null != e) {
			for (s = 0; s < e.length; s++) if ((y = e[s]) && "setAttribute" in y == !!x && (x ? y.localName == x : 3 == y.nodeType)) {
				u = y, e[s] = null;
				break;
			}
		}
		if (null == u) {
			if (null == x) return document.createTextNode(k);
			u = document.createElementNS(o, x, k.is && k), c && (l$1.__m && l$1.__m(t, e), c = !1), e = null;
		}
		if (null == x) m === k || c && u.data == k || (u.data = k);
		else {
			if (e = "textarea" == x && null != k.defaultValue ? null : e && n.call(u.childNodes), !c && null != e) for (m = {}, s = 0; s < u.attributes.length; s++) m[(y = u.attributes[s]).name] = y.value;
			for (s in m) y = m[s], "dangerouslySetInnerHTML" == s ? p = y : "children" == s || s in k || "value" == s && "defaultValue" in k || "checked" == s && "defaultChecked" in k || N$1(u, s, null, y, o);
			for (s in k) y = k[s], "children" == s ? v = y : "dangerouslySetInnerHTML" == s ? h = y : "value" == s ? w = y : "checked" == s ? _ = y : c && "function" != typeof y || m[s] === y || N$1(u, s, y, m[s], o);
			if (h) c || p && (h.__html == p.__html || h.__html == u.innerHTML) || (u.innerHTML = h.__html), t.__k = [];
			else if (p && (u.innerHTML = ""), L("template" == t.type ? u.content : u, g$1(v) ? v : [v], t, i, r, "foreignObject" == x ? "http://www.w3.org/1999/xhtml" : o, e, f, e ? e[0] : i.__k && $(i, 0), c, a), null != e) for (s = e.length; s--;) b(e[s]);
			c && "textarea" != x || (s = "value", "progress" == x && null == w ? u.removeAttribute("value") : null != w && (w !== u[s] || "progress" == x && !w || "option" == x && w != m[s]) && N$1(u, s, w, m[s], o), s = "checked", null != _ && _ != u[s] && N$1(u, s, _, m[s], o));
		}
		return u;
	}
	function J$1(n, u, t) {
		try {
			if ("function" == typeof n) {
				var i = "function" == typeof n.__u;
				i && n.__u(), i && null == u || (n.__u = n(u));
			} else n.current = u;
		} catch (n) {
			l$1.__e(n, t);
		}
	}
	function K$1(n, u, t) {
		var i, r;
		if (l$1.unmount && l$1.unmount(n), (i = n.ref) && (i.current && i.current != n.__e || J$1(i, null, u)), null != (i = n.__c)) {
			if (i.componentWillUnmount) try {
				i.componentWillUnmount();
			} catch (n) {
				l$1.__e(n, u);
			}
			i.base = i.__P = i.__n = null;
		}
		if (i = n.__k) for (r = 0; r < i.length; r++) i[r] && K$1(i[r], u, t || "function" != typeof n.type);
		t || b(n.__e), n.__c = n.__ = n.__e = void 0;
	}
	function Q$1(n, l, u) {
		return this.constructor(n, u);
	}
	function R$1(u, t, i) {
		var r, o, e, f;
		t == document && (t = document.documentElement), l$1.__ && l$1.__(u, t), o = (r = "function" == typeof i) ? null : i && i.__k || t.__k, e = [], f = [], q$2(t, u = (!r && i || t).__k = k$1(S, null, [u]), o || d$1, d$1, t.namespaceURI, !r && i ? [i] : o ? null : t.firstChild ? n.call(t.childNodes) : null, e, !r && i ? i : o ? o.__e : t.firstChild, r, f), D$1(e, u, f), u.props.children = null;
	}
	n = w$1.slice, l$1 = { __e: function(n, l, u, t) {
		for (var i, r, o; l = l.__;) if ((i = l.__c) && !i.__) try {
			if ((r = i.constructor) && null != r.getDerivedStateFromError && (i.setState(r.getDerivedStateFromError(n)), o = i.__d), null != i.componentDidCatch && (i.componentDidCatch(n, t || {}), o = i.__d), o) return i.__E = i;
		} catch (l) {
			n = l;
		}
		throw n;
	} }, u$2 = 0, C$2.prototype.setState = function(n, l) {
		var u = null != this.__s && this.__s != this.state ? this.__s : this.__s = m$1({}, this.state);
		"function" == typeof n && (n = n(m$1({}, u), this.props)), n && m$1(u, n), null != n && this.__v && (l && this._sb.push(l), A$2(this));
	}, C$2.prototype.forceUpdate = function(n) {
		this.__v && (this.__e = !0, n && this.__h.push(n), A$2(this));
	}, C$2.prototype.render = S, i$2 = [], o$1 = "function" == typeof Promise ? Promise.prototype.then.bind(Promise.resolve()) : setTimeout, e$1 = function(n, l) {
		return n.__v.__b - l.__v.__b;
	}, H$1.__r = 0, f$2 = Math.random().toString(8), c$1 = "__d" + f$2, a$1 = "__a" + f$2, s$1 = /(PointerCapture)$|Capture$/i, h$1 = 0, p$1 = V$1(!1), v$1 = V$1(!0);
	var app_default = ":root{--bg:#f4f5f7;--paper:#fff;--text:#1a1d21;--muted:#5f6670;--line:#dde1e6;--hover:#0000000d;--primary:#0e3a7e;--primary-soft:#0e3a7e17;--on-primary:#fff;--good:#1b7a3d;--good-soft:#e3f4e8;--bad:#b3261e;--bad-soft:#fbe5e3;--warn:#c2410c;--shadow:0 1px 2px #0000000f, 0 1px 6px #0000000d;--radius:10px;color-scheme:light}@media (prefers-color-scheme:dark){:root{--bg:#111317;--paper:#1b1e23;--text:#e8eaed;--muted:#9aa1ab;--line:#2e333a;--hover:#ffffff0f;--primary:#8cb4ff;--primary-soft:#8cb4ff1f;--on-primary:#0b1730;--good:#6fd08f;--good-soft:#6fd08f24;--bad:#ff8a80;--bad-soft:#ff8a8024;--warn:#ffb27a;--shadow:0 1px 2px #0006;color-scheme:dark}}*{box-sizing:border-box}html,body{margin:0}body{background:var(--bg);color:var(--text);-webkit-font-smoothing:antialiased;font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}body.modal-open{overflow:hidden}a{color:var(--primary)}button,input,select{font:inherit;color:inherit}h2{margin:0;font-size:15px;font-weight:600}h3{margin:16px 0 6px;font-size:14px;font-weight:600}.muted{color:var(--muted)}.small{font-size:12.5px}.error{color:var(--bad)}.row-gap{flex-wrap:wrap;align-items:center;gap:8px 12px;margin-top:12px;display:flex}.btn{cursor:pointer;background:var(--primary);min-height:36px;color:var(--on-primary);white-space:nowrap;border:0;border-radius:8px;justify-content:center;align-items:center;gap:6px;padding:6px 14px;font-weight:600;text-decoration:none;display:inline-flex}.btn:hover{filter:brightness(1.08)}.btn[aria-disabled=true]{background:var(--line);color:var(--muted);cursor:not-allowed;filter:none}.btn-small{min-height:30px;padding:4px 12px;font-size:13px}.btn-outline{color:var(--text);border:1px solid var(--line);background:0 0}.btn-outline:hover{background:var(--hover);filter:none}.btn-text,.btn.btn-text{color:var(--primary);cursor:pointer;background:0 0;border:0;border-radius:6px;align-items:center;gap:4px;min-height:0;padding:4px 8px;font-weight:600;display:inline-flex}.btn-text:hover:not(:disabled){background:var(--primary-soft);filter:none}.btn-text:disabled{color:var(--muted);cursor:default;opacity:.75}.icon-btn{color:var(--muted);cursor:pointer;background:0 0;border:0;border-radius:50%;justify-content:center;align-items:center;padding:6px;display:inline-flex}.icon-btn:hover{background:var(--hover);color:var(--text)}:focus-visible{outline:2px solid var(--primary);outline-offset:2px}.topbar{z-index:20;background:var(--paper);border-bottom:1px solid var(--line);align-items:center;gap:12px;padding:10px 20px;display:flex;position:sticky;top:0}.brand{color:var(--primary);white-space:nowrap;font-size:18px;font-weight:800;text-decoration:none}.brand span{color:var(--text);font-weight:500}.search,.sort,.field input,.field select,.add-filter{border:1px solid var(--line);background:var(--paper);border-radius:8px;min-width:0;height:38px;padding:0 10px}.search{flex:1;max-width:560px}.sort{max-width:230px}.search:focus,.sort:focus,.field input:focus,.field select:focus{outline:2px solid var(--primary);outline-offset:-1px}.filters-toggle{display:none}.layout{grid-template-columns:290px minmax(0,1fr);gap:20px;max-width:1800px;margin:0 auto;padding:16px 20px 40px;display:grid}.sidebar{scrollbar-width:thin;align-self:start;max-height:calc(100vh - 92px);position:sticky;top:76px;overflow-y:auto}.sidebar-inner{flex-direction:column;gap:12px;padding-bottom:8px;display:flex}.panel{background:var(--paper);border:1px solid var(--line);border-radius:var(--radius);flex-direction:column;gap:10px;padding:14px;display:flex}.panel-head{justify-content:space-between;align-items:center;display:flex}.collapsible{flex-direction:column;gap:6px;display:flex}.collapse-head{cursor:pointer;text-align:left;background:0 0;border:0;justify-content:space-between;align-items:center;width:100%;padding:4px 0;font-weight:600;display:flex}.collapse-head svg{color:var(--muted);flex:none;transition:transform .15s}.collapse-head[aria-expanded=true] svg{transform:rotate(180deg)}.collapse-body{flex-direction:column;gap:4px;display:flex}.field{color:var(--muted);flex-direction:column;flex:1;gap:4px;min-width:0;font-size:12.5px;display:flex}.field input,.field select{color:var(--text);width:100%;font-size:14px}.field-row{gap:8px;display:flex}.check{cursor:pointer;align-items:center;gap:8px;padding:2px 0;display:flex}.check input{accent-color:var(--primary);margin:0}.check .count{color:var(--muted);font-variant-numeric:tabular-nums;margin-left:auto;font-size:12px}.switch-row{cursor:pointer;justify-content:space-between;align-items:center;gap:12px;display:flex}.switch-row input{appearance:none;background:var(--line);cursor:pointer;border-radius:10px;flex:none;width:34px;height:20px;margin:0;transition:background .15s;position:relative}.switch-row input:after{content:\"\";background:#fff;border-radius:50%;width:16px;height:16px;transition:left .15s;position:absolute;top:2px;left:2px;box-shadow:0 1px 2px #0000004d}.switch-row input:checked{background:var(--primary)}.switch-row input:checked:after{left:16px}.add-filter{align-items:center;padding:0 4px 0 10px;display:flex}.add-filter:focus-within{outline:2px solid var(--primary);outline-offset:-1px}.add-filter.has-error{border-color:var(--bad)}.add-filter input{background:0 0;border:0;outline:0;flex:1;min-width:0;height:100%}.filter-list{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}.filter-row{align-items:flex-start;gap:4px;padding:2px 0;display:flex}.filter-remove{color:var(--muted);cursor:pointer;background:0 0;border:0;border-radius:50%;flex:none;margin-top:2px;padding:2px;display:inline-flex}.filter-remove:hover{color:var(--bad);background:var(--hover)}.filter-pattern{text-align:left;cursor:text;background:0 0;border:0;border-radius:6px;flex:auto;min-width:0;padding:2px 6px}.filter-pattern:hover{background:var(--hover)}.pattern{overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;line-height:18px}.pattern .seg{max-width:100%;display:inline-block}.filter-row .count{color:var(--muted);font-variant-numeric:tabular-nums;flex:none;margin-top:2px;font-size:12px;line-height:18px}.filter-error .pattern{color:var(--bad);text-decoration:line-through}.filter-edit{flex-direction:column;flex:auto;gap:2px;min-width:0;display:flex}.filter-edit textarea{resize:vertical;border:1px solid var(--line);background:var(--paper);border-radius:6px;width:100%;padding:4px 6px;font:12.5px/18px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.filter-edit textarea:focus{outline:2px solid var(--primary);outline-offset:-1px}.filter-edit textarea.has-error{border-color:var(--bad);outline-color:var(--bad)}.filter-label{overflow-wrap:anywhere;flex:none;max-width:45%;margin-top:2px;font-size:13px;font-weight:600;line-height:18px}.custom-cats{border-top:1px solid var(--line);flex-direction:column;gap:6px;margin-top:8px;padding-top:8px;display:flex}.custom-cats h3{margin:0;font-size:13px}.custom-cats p{margin:0}.saved-row{border-radius:6px;align-items:center}.saved-row.active{background:var(--primary-soft)}.saved-name{cursor:pointer;text-align:left;text-overflow:ellipsis;white-space:nowrap;background:0 0;border:0;border-radius:6px;flex:auto;min-width:0;padding:3px 6px;font-weight:600;overflow:hidden}.saved-name:hover{background:var(--hover)}.saved-row .count{margin-top:0}.saved-row .rename{border:1px solid var(--line);background:var(--paper);border-radius:6px;flex:auto;min-width:0;height:28px;padding:0 6px}.saved-row .filter-remove{margin-top:0}.pill-new{background:var(--primary);color:var(--on-primary);cursor:pointer;border:0;flex:none;padding:1px 7px;font-size:11.5px}.card-media .pill-new{background:var(--primary);color:#fff;box-shadow:0 1px 3px #0003}.filters-toggle .pill-new{margin-left:2px}.results-line{flex-wrap:wrap;justify-content:space-between;align-items:center;gap:6px 16px;display:flex}.new-line{color:var(--primary);align-items:center;gap:6px;font-weight:600;display:inline-flex}.hidden-list{max-height:240px;margin:0;padding:0;list-style:none;overflow-y:auto}.hidden-list li{align-items:center;gap:4px;display:flex}.hidden-list a{min-width:0;color:inherit;white-space:nowrap;text-overflow:ellipsis;flex:1;font-size:13px;text-decoration:none;overflow:hidden}.hidden-list a:hover{text-decoration:underline}.hidden-list .icon-btn{padding:3px}.statusbar{color:var(--muted);flex-wrap:wrap;align-items:center;gap:6px 14px;font-size:13px;display:flex}.live{white-space:nowrap;font-size:12px}.live-connected{color:var(--good)}.live-connecting{color:var(--warn)}.live-disconnected{color:var(--bad)}.progress{background:var(--primary-soft);border-radius:2px;flex-basis:100%;height:4px;overflow:hidden}.progress>span{background:var(--primary);height:100%;transition:width .2s;display:block}.notice{background:var(--primary-soft);border-radius:8px;margin:10px 0 0;padding:8px 12px;font-size:13px}.results-line{margin:12px 0;scroll-margin-top:80px;font-weight:600}.results-line .muted{font-weight:400}.grid{grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;display:grid}.card{background:var(--paper);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);flex-direction:column;transition:opacity .15s;display:flex;overflow:hidden}.card.dim{opacity:.45;filter:grayscale()}.card.dim:hover{opacity:.75}.card-media{aspect-ratio:4/3;background:#fff;position:relative}.card-media>a{justify-content:center;align-items:center;display:flex;position:absolute;inset:0}.card-media img{object-fit:contain;width:100%;height:100%}.noimg{color:#888;font-size:13px}.hide-btn{color:#444;background:#ffffffeb;position:absolute;top:8px;left:8px;box-shadow:0 1px 3px #0003}.hide-btn:hover{color:#111;background:#fff}.media-tr{gap:4px;display:flex;position:absolute;top:8px;right:8px}.media-badge{color:#222;white-space:nowrap;text-overflow:ellipsis;background:#fffffff2;border:1px solid #ddd;border-radius:12px;max-width:calc(100% - 16px);padding:3px 9px;font-size:12px;font-weight:600;position:absolute;bottom:8px;left:8px;overflow:hidden}.pill{border-radius:10px;align-items:center;gap:3px;padding:2px 8px;font-size:12px;font-weight:700;display:inline-flex}.pill-good{background:var(--good-soft);color:var(--good)}.pill-bad{background:var(--bad-soft);color:var(--bad)}.card-media .pill-good,.card-media .pill-bad{background:#fff;box-shadow:0 1px 3px #0003}.card-media .pill-good{color:#1b7a3d}.card-media .pill-bad{color:#b3261e}.pill-dupes{cursor:pointer;color:#333;background:#fff;border:0;padding:1px 7px;font-size:11.5px;box-shadow:0 1px 3px #0003}.pill-watch{color:#d49a00;background:#fff;padding:3px 5px;box-shadow:0 1px 3px #0003}.watch-btn{cursor:pointer;color:#666;border:0}.watch-btn.on,.watch-btn:hover{color:#d49a00}.watch-btn:disabled{cursor:default;opacity:.7}.modal-info .btn-text[aria-pressed=true] svg{color:#d49a00}.card-body{flex-direction:column;flex:1;gap:5px;padding:10px 12px 12px;display:flex}.card-title{color:var(--text);-webkit-line-clamp:2;-webkit-box-orient:vertical;min-height:2.6em;font-weight:600;line-height:1.3;text-decoration:none;display:-webkit-box;overflow:hidden}.card-title:hover{text-decoration:underline}.card-meta{color:var(--muted);flex-wrap:wrap;gap:2px 10px;font-size:12.5px;display:flex}.card-meta>span+span:before{content:\"·\";opacity:.6;margin-left:-6px;margin-right:10px}.card-price{flex-wrap:wrap;align-items:baseline;gap:8px;display:flex}.price{font-variant-numeric:tabular-nums;font-size:20px;font-weight:700}.total{color:var(--muted);white-space:nowrap;font-size:12.5px}.total b{color:var(--text);font-weight:600}.card-sub{justify-content:space-between;gap:8px;font-size:12.5px;display:flex}.card-foot{justify-content:space-between;align-items:center;gap:8px;margin-top:auto;padding-top:6px;display:flex}.time{font-variant-numeric:tabular-nums;font-weight:600}.time.soon{color:var(--bad)}.pager{flex-wrap:wrap;justify-content:center;align-items:center;gap:4px;margin-top:28px;display:flex}.pager button{cursor:pointer;font-variant-numeric:tabular-nums;background:0 0;border:0;border-radius:19px;justify-content:center;align-items:center;min-width:38px;height:38px;padding:0 10px;display:inline-flex}.pager button:hover:not(:disabled){background:var(--hover)}.pager button[aria-current=page]{background:var(--primary);color:var(--on-primary);font-weight:700}.pager button:disabled{opacity:.35;cursor:default}.pager .gap{text-align:center;min-width:24px;color:var(--muted)}.backdrop{z-index:50;background:#0000008c;justify-content:center;align-items:center;padding:24px;display:flex;position:fixed;inset:0}.modal{background:var(--paper);border-radius:14px;outline:none;width:100%;max-width:1100px;max-height:calc(100vh - 48px);position:relative;overflow-y:auto;box-shadow:0 20px 60px #00000059}.modal-close{z-index:2;background:var(--paper);position:absolute;top:10px;right:10px}.modal-grid{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:24px;padding:24px;display:grid}.gallery-main{aspect-ratio:1;background:#fff;border-radius:10px;justify-content:center;align-items:center;display:flex;position:relative;overflow:hidden}.gallery-main img{object-fit:contain;width:100%;height:100%}.gal-prev,.gal-next{color:#222;background:#ffffffe6;position:absolute;top:50%;transform:translateY(-50%);box-shadow:0 1px 4px #00000040}.gal-prev{left:8px}.gal-next{right:8px}.thumbs{gap:6px;margin-top:8px;padding-bottom:4px;display:flex;overflow-x:auto}.thumbs button{cursor:pointer;background:#fff;border:2px solid #0000;border-radius:6px;flex:none;width:60px;height:60px;padding:0;overflow:hidden}.thumbs button.on{border-color:var(--primary)}.thumbs img{object-fit:contain;width:100%;height:100%}.modal-info h2{margin-bottom:6px;padding-right:36px;font-size:21px;line-height:1.3}.modal-price{border-top:1px solid var(--line);border-bottom:1px solid var(--line);flex-wrap:wrap;gap:12px 28px;margin-top:14px;padding:12px 0;display:flex}.big{font-size:22px;font-weight:700}.modal-price .total{color:var(--text);font-size:22px}.description{white-space:pre-wrap;max-height:280px;margin-top:14px;padding-right:6px;font-size:13.5px;overflow-y:auto}.bids{max-height:220px;margin:0;padding:0;font-size:13px;list-style:none;overflow-y:auto}.bids li{border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums;justify-content:space-between;padding:4px 0;display:flex}.bids li.you{color:var(--primary);font-weight:700}.dupes{max-height:220px;margin:0 0 14px;padding:0;font-size:13px;list-style:none;overflow-y:auto}.dupes button{border:0;border-bottom:1px solid var(--line);width:100%;color:inherit;text-align:left;cursor:pointer;font-variant-numeric:tabular-nums;background:0 0;align-items:baseline;gap:10px;padding:5px 6px;display:flex}.dupes button:hover{background:var(--hover)}.dupes button.on{background:var(--primary-soft);font-weight:700}.dupes .small{flex:1}.bid-panel{flex-direction:column;gap:6px;margin-top:14px;display:flex}.bid-row{flex-wrap:wrap;gap:8px;display:flex}.bid-input{border:1px solid var(--line);background:var(--paper);cursor:text;border-radius:8px;flex:140px;align-items:center;gap:2px;max-width:220px;height:38px;padding:0 10px;display:flex}.bid-input:focus-within{outline:2px solid var(--primary);outline-offset:-1px}.bid-input.has-error{border-color:var(--bad);outline-color:var(--bad)}.bid-input span{color:var(--muted)}.bid-input input{font-variant-numeric:tabular-nums;background:0 0;border:0;outline:0;flex:1;min-width:0;height:100%}.btn:disabled{background:var(--line);color:var(--muted);cursor:not-allowed;filter:none}.btn-outline:disabled{background:0 0}.backdrop-top{z-index:60}.confirm{background:var(--paper);border-radius:14px;width:100%;max-width:440px;max-height:calc(100vh - 48px);padding:20px;overflow-y:auto;box-shadow:0 20px 60px #00000059}.confirm h2{font-size:18px}.confirm-body{flex-direction:column;gap:10px;margin-top:10px;display:flex}.confirm-body p{margin:0}.confirm-lot{font-weight:600;line-height:1.3}.confirm-amount{flex-direction:column;display:flex}.confirm-facts{grid-template-columns:auto 1fr;gap:4px 14px;margin:0;font-size:13px;display:grid}.confirm-facts dt{color:var(--muted)}.confirm-facts dd{font-variant-numeric:tabular-nums;margin:0;font-weight:600}.confirm-warn{background:var(--bad-soft);color:var(--text);border-radius:8px;padding:8px 10px;font-size:13px}.confirm-actions{justify-content:flex-end;gap:8px;margin-top:18px;display:flex}.toasts{z-index:70;flex-direction:column;align-items:center;gap:8px;width:max-content;max-width:calc(100vw - 32px);display:flex;position:fixed;bottom:20px;left:50%;transform:translate(-50%)}.toast{background:var(--text);color:var(--paper);text-align:left;cursor:pointer;border:0;border-radius:10px;padding:10px 16px;font-weight:600;box-shadow:0 6px 24px #00000040}.toast-good{background:var(--good);color:#fff}.toast-bad{background:var(--bad);color:#fff}@media (prefers-color-scheme:dark){.toast-good,.toast-bad{color:#111}}@media (width<=900px){.topbar{flex-wrap:wrap;gap:8px;padding:10px 16px}.search{flex-basis:100%;order:3;max-width:none}.sort{flex:1;max-width:none}.filters-toggle{display:inline-flex}.layout{grid-template-columns:minmax(0,1fr);padding:12px 16px 32px}.sidebar{max-height:none;display:none;position:static}.sidebar.open{display:block}.modal-grid{grid-template-columns:minmax(0,1fr);padding:16px}.backdrop{padding:0}.modal{border-radius:0;height:100%;max-height:100vh}.backdrop-top{padding:16px}}@media (width<=520px){.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.price{font-size:17px}.card-sub{flex-direction:column;gap:2px}}";
	var t;
	var r;
	var u$1;
	var i$1;
	var o = 0;
	var f$1 = [];
	var c = l$1;
	var e = c.__b;
	var a = c.__r;
	var v = c.diffed;
	var l = c.__c;
	var m = c.unmount;
	var p = c.__;
	function s(n, t) {
		c.__h && c.__h(r, n, o || t), o = 0;
		var u = r.__H || (r.__H = {
			__: [],
			__h: []
		});
		return n >= u.__.length && u.__.push({}), u.__[n];
	}
	function d(n) {
		return o = 1, y(D, n);
	}
	function y(n, u, i) {
		var o = s(t++, 2);
		if (o.t = n, !o.__c && (o.__ = [i ? i(u) : D(void 0, u), function(n) {
			var t = o.__N ? o.__N[0] : o.__[0], r = o.t(t, n);
			t !== r && (o.__N = [r, o.__[1]], o.__c.setState({}));
		}], o.__c = r, !r.__f)) {
			var f = function(n, t, r) {
				if (!o.__c.__H) return !0;
				var u = !1, i = o.__c.props !== n;
				if (o.__c.__H.__.some(function(n) {
					if (n.__N) {
						u = !0;
						var t = n.__[0];
						n.__ = n.__N, n.__N = void 0, t !== n.__[0] && (i = !0);
					}
				}), c) {
					var f = c.call(this, n, t, r);
					return u ? f || i : f;
				}
				return !u || i;
			};
			r.__f = !0;
			var c = r.shouldComponentUpdate, e = r.componentWillUpdate;
			r.componentWillUpdate = function(n, t, r) {
				if (this.__e) {
					var u = c;
					c = void 0, f(n, t, r), c = u;
				}
				e && e.call(this, n, t, r);
			}, r.shouldComponentUpdate = f;
		}
		return o.__N || o.__;
	}
	function h(n, u) {
		var i = s(t++, 3);
		!c.__s && C$1(i.__H, u) && (i.__ = n, i.u = u, r.__H.__h.push(i));
	}
	function _(n, u) {
		var i = s(t++, 4);
		!c.__s && C$1(i.__H, u) && (i.__ = n, i.u = u, r.__h.push(i));
	}
	function A$1(n) {
		return o = 5, T$1(function() {
			return { current: n };
		}, []);
	}
	function T$1(n, r) {
		var u = s(t++, 7);
		return C$1(u.__H, r) && (u.__ = n(), u.__H = r, u.__h = n), u.__;
	}
	function q$1(n, t) {
		return o = 8, T$1(function() {
			return n;
		}, t);
	}
	function j$1() {
		for (var n; n = f$1.shift();) {
			var t = n.__H;
			if (n.__P && t) try {
				t.__h.some(z), t.__h.some(B$1), t.__h = [];
			} catch (r) {
				t.__h = [], c.__e(r, n.__v);
			}
		}
	}
	c.__b = function(n) {
		r = null, e && e(n);
	}, c.__ = function(n, t) {
		n && t.__k && t.__k.__m && (n.__m = t.__k.__m), p && p(n, t);
	}, c.__r = function(n) {
		a && a(n), t = 0;
		var i = (r = n.__c).__H;
		i && (u$1 === r ? (i.__h = [], r.__h = [], i.__.some(function(n) {
			n.__N && (n.__ = n.__N), n.u = n.__N = void 0;
		})) : (i.__h.some(z), i.__h.some(B$1), i.__h = [], t = 0)), u$1 = r;
	}, c.diffed = function(n) {
		v && v(n);
		var t = n.__c;
		t && t.__H && (t.__H.__h.length && (1 !== f$1.push(t) && i$1 === c.requestAnimationFrame || ((i$1 = c.requestAnimationFrame) || w)(j$1)), t.__H.__.some(function(n) {
			n.u && (n.__H = n.u, n.u = void 0);
		})), u$1 = r = null;
	}, c.__c = function(n, t) {
		t.some(function(n) {
			try {
				n.__h.some(z), n.__h = n.__h.filter(function(n) {
					return !n.__ || B$1(n);
				});
			} catch (r) {
				t.some(function(n) {
					n.__h && (n.__h = []);
				}), t = [], c.__e(r, n.__v);
			}
		}), l && l(n, t);
	}, c.unmount = function(n) {
		m && m(n);
		var t, r = n.__c;
		r && r.__H && (r.__H.__.some(function(n) {
			try {
				z(n);
			} catch (n) {
				t = n;
			}
		}), r.__H = void 0, t && c.__e(t, r.__v));
	};
	var k = "function" == typeof requestAnimationFrame;
	function w(n) {
		var t, r = function() {
			clearTimeout(u), k && cancelAnimationFrame(t), setTimeout(n);
		}, u = setTimeout(r, 35);
		k && (t = requestAnimationFrame(r));
	}
	function z(n) {
		var t = r, u = n.__c;
		"function" == typeof u && (n.__c = void 0, u()), r = t;
	}
	function B$1(n) {
		var t = r;
		n.__c = n.__(), r = t;
	}
	function C$1(n, t) {
		return !n || n.length !== t.length || t.some(function(t, r) {
			return t !== n[r];
		});
	}
	function D(n, t) {
		return "function" == typeof t ? t(n) : t;
	}
	var KEYS = {
		hidden: "hiddenLots",
		words: "filterWords",
		filterOn: "filterEnabled",
		showHidden: "showHidden",
		removeFiltered: "removeFiltered",
		collapsed: "collapsedLists",
		syncMinutes: "tlxSyncMinutes",
		pickup: "tlxPickup",
		view: "tlxView",
		savedSearches: "tlxSavedSearches",
		accountPickup: "tlxAccountPickup",
		customCategories: "tlxCustomCategories"
	};
	var DEFAULTS = {
		[KEYS.hidden]: {},
		[KEYS.words]: [],
		[KEYS.filterOn]: true,
		[KEYS.showHidden]: false,
		[KEYS.removeFiltered]: false,
		[KEYS.collapsed]: {
			words: false,
			hidden: false
		},
		[KEYS.syncMinutes]: 5,
		[KEYS.pickup]: null,
		[KEYS.view]: null,
		[KEYS.savedSearches]: [],
		[KEYS.accountPickup]: null,
		[KEYS.customCategories]: []
	};
	var lotHref = (auctionPeriod, id) => `/lots/${auctionPeriod}/${id}`;
	function g(n, t) {
		for (var e in t) n[e] = t[e];
		return n;
	}
	function E(n, t) {
		for (var e in n) if ("__source" !== e && !(e in t)) return !0;
		for (var r in t) if ("__source" !== r && n[r] !== t[r]) return !0;
		return !1;
	}
	function C(n, t) {
		var e = t(), r = d({ t: {
			__: e,
			u: t
		} }), u = r[0].t, o = r[1];
		return _(function() {
			u.__ = e, u.u = t, R(u) && o({ t: u });
		}, [
			n,
			e,
			t
		]), h(function() {
			return R(u) && o({ t: u }), n(function() {
				R(u) && o({ t: u });
			});
		}, [n]), e;
	}
	function R(n) {
		try {
			return !((t = n.__) === (e = n.u()) && (0 !== t || 1 / t == 1 / e) || t != t && e != e);
		} catch (n) {
			return !0;
		}
		var t, e;
	}
	function M(n, t) {
		this.props = n, this.context = t;
	}
	function N(n, e) {
		function r(n) {
			var t = this.props.ref;
			return t != n.ref && t && ("function" == typeof t ? t(null) : t.current = null), e ? !e(this.props, n) || t != n.ref : E(this.props, n);
		}
		function u(e) {
			return this.shouldComponentUpdate = r, k$1(n, e);
		}
		return u.displayName = "Memo(" + (n.displayName || n.name) + ")", u.__f = u.prototype.isReactComponent = !0, u.type = n, u;
	}
	(M.prototype = new C$2()).isPureReactComponent = !0, M.prototype.shouldComponentUpdate = function(n, t) {
		return E(this.props, n) || E(this.state, t);
	};
	var T = l$1.__b;
	l$1.__b = function(n) {
		n.type && n.type.__f && n.ref && (n.props.ref = n.ref, n.ref = null), T && T(n);
	};
	"undefined" != typeof Symbol && Symbol.for;
	var O = l$1.__e;
	l$1.__e = function(n, t, e, r) {
		if (n.then) {
			for (var u, o = t; o = o.__;) if ((u = o.__c) && u.__c) return t.__e ?? (t.__e = e.__e, t.__k = e.__k || []), u.__c(n, t);
		}
		O(n, t, e, r);
	};
	var U = l$1.unmount;
	function V(n, t, e) {
		return n && (n.__c && n.__c.__H && (n.__c.__H.__.forEach(function(n) {
			"function" == typeof n.__c && n.__c();
		}), n.__c.__H = null), null != (n = g({}, n)).__c && (n.__c.__P === e && (n.__c.__P = t), n.__c.__e = !0, n.__c = null), n.__k = n.__k && n.__k.map(function(n) {
			return V(n, t, e);
		})), n;
	}
	function W(n, t, e) {
		return n && e && (n.__v = null, n.__k = n.__k && n.__k.map(function(n) {
			return W(n, t, e);
		}), n.__c && n.__c.__P === t && (n.__e && e.appendChild(n.__e), n.__c.__e = !0, n.__c.__P = e)), n;
	}
	function P() {
		this.__u = 0, this.o = null, this.__b = null;
	}
	function j(n) {
		var t = n.__ && n.__.__c;
		return t && t.__a && t.__a(n);
	}
	function B() {
		this.i = null, this.l = null;
	}
	l$1.unmount = function(n) {
		var t = n.__c;
		t && (t.__z = !0), t && t.__R && t.__R(), t && 32 & n.__u && (n.type = null), U && U(n);
	}, (P.prototype = new C$2()).__c = function(n, t) {
		var e = t.__c, r = this;
		r.o ??= [], r.o.push(e);
		var u = j(r.__v), o = !1, i = function() {
			o || r.__z || (o = !0, e.__R = null, u ? u(f) : f());
		};
		e.__R = i;
		var l = e.__P;
		e.__P = null;
		var f = function() {
			if (!--r.__u) {
				if (r.state.__a) {
					var n = r.state.__a;
					r.__v.__k[0] = W(n, n.__c.__P, n.__c.__O);
				}
				var t;
				for (r.setState({ __a: r.__b = null }); t = r.o.pop();) t.__P = l, t.forceUpdate();
			}
		};
		r.__u++ || 32 & t.__u || r.setState({ __a: r.__b = r.__v.__k[0] }), n.then(i, i);
	}, P.prototype.componentWillUnmount = function() {
		this.o = [];
	}, P.prototype.render = function(n, e) {
		if (this.__b) {
			if (this.__v.__k) {
				var r = document.createElement("div"), o = this.__v.__k[0].__c;
				this.__v.__k[0] = V(this.__b, r, o.__O = o.__P);
			}
			this.__b = null;
		}
		var i = e.__a && k$1(S, null, n.fallback);
		return i && (i.__u &= -33), [k$1(S, null, e.__a ? null : n.children), i];
	};
	var H = function(n, t, e) {
		if (++e[1] === e[0] && n.l.delete(t), n.props.revealOrder && ("t" !== n.props.revealOrder[0] || !n.l.size)) for (e = n.i; e;) {
			for (; e.length > 3;) e.pop()();
			if (e[1] < e[0]) break;
			n.i = e = e[2];
		}
	};
	(B.prototype = new C$2()).__a = function(n) {
		var t = this, e = j(t.__v), r = t.l.get(n);
		return r[0]++, function(u) {
			var o = function() {
				t.props.revealOrder ? (r.push(u), H(t, n, r)) : u();
			};
			e ? e(o) : o();
		};
	}, B.prototype.render = function(n) {
		this.i = null, this.l = new Map();
		var t = F(n.children);
		n.revealOrder && "b" === n.revealOrder[0] && t.reverse();
		for (var e = t.length; e--;) this.l.set(t[e], this.i = [
			1,
			0,
			this.i
		]);
		return n.children;
	}, B.prototype.componentDidUpdate = B.prototype.componentDidMount = function() {
		var n = this;
		this.l.forEach(function(t, e) {
			H(n, e, t);
		});
	};
	var q = "undefined" != typeof Symbol && Symbol.for && Symbol.for("react.element") || 60103;
	var G = /^(?:accent|alignment|arabic|baseline|cap|clip(?!PathU)|color|dominant|fill|flood|font|glyph(?!R)|horiz|image(!S)|letter|lighting|marker(?!H|W|U)|overline|paint|pointer|shape|stop|strikethrough|stroke|text(?!L)|transform|underline|unicode|units|v|vector|vert|word|writing|x(?!C))[A-Z]/;
	var J = /^on(Ani|Tra|Tou|BeforeInp|Compo)/;
	var K = /[A-Z0-9]/g;
	var Q = "undefined" != typeof document;
	var X = function(n) {
		return ("undefined" != typeof Symbol && "symbol" == typeof Symbol() ? /fil|che|rad/ : /fil|che|ra/).test(n);
	};
	C$2.prototype.isReactComponent = !0, [
		"componentWillMount",
		"componentWillReceiveProps",
		"componentWillUpdate"
	].forEach(function(t) {
		Object.defineProperty(C$2.prototype, t, {
			configurable: !0,
			get: function() {
				return this["UNSAFE_" + t];
			},
			set: function(n) {
				Object.defineProperty(this, t, {
					configurable: !0,
					writable: !0,
					value: n
				});
			}
		});
	});
	var en = l$1.event;
	l$1.event = function(n) {
		return en && (n = en(n)), n.persist = function() {}, n.isPropagationStopped = function() {
			return this.cancelBubble;
		}, n.isDefaultPrevented = function() {
			return this.defaultPrevented;
		}, n.nativeEvent = n;
	};
	var un = {
		configurable: !0,
		get: function() {
			return this.class;
		}
	};
	var on = l$1.vnode;
	l$1.vnode = function(n) {
		"string" == typeof n.type && function(n) {
			var t = n.props, e = n.type, u = {}, o = -1 == e.indexOf("-");
			for (var i in t) {
				var l = t[i];
				if (!("value" === i && "defaultValue" in t && null == l || Q && "children" === i && "noscript" === e || "class" === i || "className" === i)) {
					var f = i.toLowerCase();
					"defaultValue" === i && "value" in t && null == t.value ? i = "value" : "download" === i && !0 === l ? l = "" : "translate" === f && "no" === l ? l = !1 : "o" === f[0] && "n" === f[1] ? "ondoubleclick" === f ? i = "ondblclick" : "onchange" !== f || "input" !== e && "textarea" !== e || X(t.type) ? "onfocus" === f ? i = "onfocusin" : "onblur" === f ? i = "onfocusout" : J.test(i) && (i = f) : f = i = "oninput" : o && G.test(i) ? i = i.replace(K, "-$&").toLowerCase() : null === l && (l = void 0), "oninput" === f && u[i = f] && (i = "oninputCapture"), u[i] = l;
				}
			}
			"select" == e && (u.multiple && Array.isArray(u.value) && (u.value = F(t.children).forEach(function(n) {
				n.props.selected = -1 != u.value.indexOf(n.props.value);
			})), null != u.defaultValue && (u.value = F(t.children).forEach(function(n) {
				n.props.selected = u.multiple ? -1 != u.defaultValue.indexOf(n.props.value) : u.defaultValue == n.props.value;
			}))), t.class && !t.className ? (u.class = t.class, Object.defineProperty(u, "className", un)) : t.className && (u.class = u.className = t.className), n.props = u;
		}(n), n.$$typeof = q, on && on(n);
	};
	var ln = l$1.__r;
	l$1.__r = function(n) {
		ln && ln(n), n.__c;
	};
	var fn = l$1.diffed;
	l$1.diffed = function(n) {
		fn && fn(n);
		var t = n.props, e = n.__e;
		null != e && "textarea" === n.type && "value" in t && t.value !== e.value && (e.value = null == t.value ? "" : t.value);
	};
	var MINUTE = 6e4;
	var HOUR = 60 * MINUTE;
	24 * HOUR;
	var pad2 = (n) => String(n).padStart(2, "0");
	function timeLabel(endsAt, now) {
		const ms = endsAt - now;
		if (ms <= 0) return {
			text: "Closed",
			soon: true
		};
		const s = Math.floor(ms / 1e3);
		const m = Math.floor(s / 60);
		const h = Math.floor(m / 60);
		const soon = ms <= HOUR;
		if (h >= 24) return {
			text: `${Math.floor(h / 24)}d ${h % 24}h`,
			soon
		};
		if (h >= 1) return {
			text: `${h}h ${pad2(m % 60)}m`,
			soon
		};
		return {
			text: `${m}m ${pad2(s % 60)}s`,
			soon
		};
	}
	function ago(ts, now) {
		const m = Math.round((now - ts) / MINUTE);
		if (m < 1) return "just now";
		if (m < 60) return `${m} min ago`;
		const h = Math.floor(m / 60);
		return h < 24 ? `${h} h ${m % 60} min ago` : new Date(ts).toLocaleString();
	}
	function countdown(ms) {
		const s = Math.max(0, Math.ceil(ms / 1e3));
		return s >= 60 ? `${Math.floor(s / 60)}:${pad2(s % 60)}` : `${s}s`;
	}
	var shortTime = (ts) => new Date(ts).toLocaleString([], {
		weekday: "short",
		hour: "numeric",
		minute: "2-digit"
	});
	var fmtCount = (n) => n.toLocaleString("en-US");
	var plural = (n, noun) => `${fmtCount(n)} ${noun}${n === 1 ? "" : "s"}`;
	function parseNum(s) {
		const n = parseFloat(s.replace(/[$,\s]/g, ""));
		return Number.isFinite(n) ? n : null;
	}
	function emitter() {
		const listeners = new Set();
		return {
			subscribe(fn) {
				listeners.add(fn);
				return () => void listeners.delete(fn);
			},
			emit: () => listeners.forEach((fn) => fn())
		};
	}
	function observableSet() {
		const items = new Set();
		const { subscribe, emit } = emitter();
		return {
			has: (v) => items.has(v),
			add(v) {
				items.add(v);
				emit();
			},
			delete(v) {
				items.delete(v);
				emit();
			},
			useHas: (v) => C(subscribe, () => items.has(v))
		};
	}
	var clocks = new Map();
	function startClock(every) {
		const listeners = new Set();
		const clock = {
			listeners,
			timer: window.setInterval(() => listeners.forEach((f) => f(Date.now())), every)
		};
		clocks.set(every, clock);
		return clock;
	}
	function useNow(every = 1e3) {
		const [now, setNow] = d(Date.now);
		h(() => {
			const clock = clocks.get(every) ?? startClock(every);
			clock.listeners.add(setNow);
			return () => {
				clock.listeners.delete(setNow);
				if (!clock.listeners.size) {
					clearInterval(clock.timer);
					clocks.delete(every);
				}
			};
		}, [every]);
		return now;
	}
	function useDialog(ref, onKey, capture = false) {
		const latest = A$1(onKey);
		latest.current = onKey;
		h(() => {
			const listener = (e) => latest.current(e);
			const prevFocus = document.activeElement;
			document.addEventListener("keydown", listener, capture);
			ref.current?.focus();
			return () => {
				document.removeEventListener("keydown", listener, capture);
				prevFocus?.focus?.();
			};
		}, []);
	}
	function openHandler(open) {
		return (e) => {
			if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
			e.preventDefault();
			open();
		};
	}
	var SESSION_URL = "/api/auth/session";
	var FOCUS_MIN_GAP = MINUTE;
	var EXPIRY_MARGIN = 2 * MINUTE;
	function authToken() {
		const cookie = document.cookie.split("; ").find((c) => c.startsWith("token="));
		return cookie ? decodeURIComponent(cookie.slice(6)) || null : null;
	}
	var signedOut = false;
	var rejectedToken = null;
	function isAuthenticated() {
		const t = authToken();
		return !signedOut && t !== null && t !== rejectedToken;
	}
	var { subscribe: subscribe$2, emit: emit$2 } = emitter();
	var lastState = isAuthenticated();
	function notify() {
		const now = isAuthenticated();
		if (now !== lastState) {
			lastState = now;
			emit$2();
		}
	}
	var onAuthChange = subscribe$2;
	var useAuthed = () => C(subscribe$2, isAuthenticated);
	function tokenExpiry(token) {
		try {
			const exp = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).exp;
			return typeof exp === "number" ? exp * 1e3 : null;
		} catch {
			return null;
		}
	}
	var inflight = null;
	var lastCheck = 0;
	var timer = 0;
	function refreshSession() {
		return inflight ??= checkSession().finally(() => {
			inflight = null;
			lastCheck = Date.now();
			notify();
			scheduleRefresh();
		});
	}
	async function checkSession() {
		try {
			const res = await fetch(SESSION_URL, {
				credentials: "same-origin",
				cache: "no-store",
				headers: { Accept: "application/json" }
			});
			if (!res.ok) return isAuthenticated();
			const s = await res.json().catch(() => null);
			signedOut = !s || typeof s !== "object" || !Object.keys(s).length || !!s.error;
		} catch {}
		return isAuthenticated();
	}
	function scheduleRefresh() {
		clearTimeout(timer);
		const exp = tokenExpiry(authToken());
		if (exp != null && !signedOut) timer = window.setTimeout(() => void refreshSession(), Math.max(3e4, exp - EXPIRY_MARGIN - Date.now()));
	}
	var ready = Promise.resolve();
	function startAuth() {
		ready = refreshSession();
		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "visible" && Date.now() - lastCheck > FOCUS_MIN_GAP) refreshSession();
		});
		window.cookieStore?.addEventListener("change", (e) => {
			if ([...e.changed, ...e.deleted].some((c) => c.name === "token") && Date.now() - lastCheck > 5e3) refreshSession();
		});
	}
	async function authedFetch(url, init = {}, anonFallback = false) {
		await ready.catch(() => {});
		const send = (withToken) => {
			const token = withToken ? authToken() : null;
			const headers = token ? {
				...init.headers,
				Authorization: `Bearer ${token}`
			} : init.headers;
			return fetch(url, {
				...init,
				credentials: "same-origin",
				headers
			});
		};
		const had = isAuthenticated();
		let res = await send(had);
		if (res.status !== 401 || !had) return res;
		const used = authToken();
		if (await refreshSession()) res = await send(true);
		if (res.status === 401) {
			if (authToken() === used) rejectedToken = used;
			notify();
			if (anonFallback) res = await send(false);
		}
		return res;
	}
	var BASE = "/backend";
	var CDN = "https://cdn.triangleliquidators.com";
	var LOGGED_OUT = "You’re logged out. Log in on the site, then try again.";
	var ApiError = class extends Error {
		status;
		constructor(message, status) {
			super(message);
			this.status = status;
		}
	};
	async function get(path, params = {}, signal) {
		const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
		const res = await authedFetch(`${BASE}${path}${qs ? `?${qs}` : ""}`, {
			headers: { Accept: "application/json" },
			signal
		}, true);
		if (!res.ok) throw new ApiError(`${res.status} ${res.statusText || "error"} for ${path}`, res.status);
		return res.json();
	}
	function send(path, method, body, headers = {}) {
		const json = body === void 0 ? {} : { "Content-Type": "application/json" };
		return authedFetch(`${BASE}${path}`, {
			method,
			headers: {
				Accept: "application/json",
				...json,
				"X-CSRF-Protection": "1",
				...headers
			},
			body: body === void 0 ? void 0 : JSON.stringify(body)
		});
	}
	var num = (v, fallback = 0) => typeof v === "number" && Number.isFinite(v) ? v : fallback;
	var pick = (o, snake, camel) => o?.[snake] ?? o?.[camel];
	function normalizeStanding(s) {
		if (!s || typeof s !== "object") return null;
		return {
			isLeading: !!s.is_leading,
			yourMaxBid: s.your_max_bid ?? null
		};
	}
	function normalizeImages(images) {
		return (images ?? []).toSorted((a, b) => num(a.position) - num(b.position)).map((i) => ({
			thumb: i.image_thumb,
			card: i.image_card,
			large: i.image_large
		}));
	}
	function normalizeLot(r) {
		return {
			id: r.id,
			auctionPeriod: r.auction_period,
			title: String(r.title ?? ""),
			lotNumber: String(r.lot_number ?? ""),
			category: r.category ? {
				value: r.category.value,
				label: r.category.label
			} : null,
			condition: r.condition ? {
				value: r.condition.value,
				label: r.condition.display_name
			} : null,
			location: r.location ? {
				id: r.location.id,
				name: r.location.name
			} : null,
			isTransferable: !!r.is_transferable,
			transferFee: num(r.transfer_fee),
			currentPrice: num(r.current_price),
			estimatedRetailPrice: r.estimated_retail_price ?? null,
			endsAt: Date.parse(r.ends_at),
			status: r.status,
			version: num(r.version, -1),
			bidCount: num(r.bid_count),
			nextMinIncrement: num(r.next_min_increment),
			yourStanding: normalizeStanding(r.your_standing),
			isWatchlisted: !!r.is_watchlisted,
			hasBid: !!r.has_bid,
			images: normalizeImages(r.images)
		};
	}
	async function fetchLotPage(page, signal) {
		const d = await get("/v1/auctions/lots/", {
			page,
			per_page: 100,
			order_by: "newly-listed"
		}, signal);
		return {
			count: d.count,
			results: d.results.map(normalizeLot)
		};
	}
	async function fetchLotDetail(auctionPeriod, id, signal) {
		const r = await get(`/v1/auctions/lots/${auctionPeriod}/${id}/`, {}, signal);
		return {
			...normalizeLot(r),
			description: String(r.description ?? ""),
			brand: r.brand || null,
			model: r.model || null,
			lotFee: r.lot_fee ?? null,
			bidHistory: (r.bid_history ?? []).map((b) => ({
				bidderLabel: b.bidder_label,
				amount: num(b.amount),
				isYou: !!b.is_you
			}))
		};
	}
	async function fetchPickupLocation() {
		const p = (await get("/v1/auth/me/")).pickup_location;
		return p ? {
			id: num(p.id, null),
			name: p.name || p.label || null
		} : null;
	}
	async function fetchWsToken() {
		return (await get("/v1/auth/ws-token/")).token;
	}
	async function setWatchlisted(auctionPeriod, lotId, on) {
		if (!isAuthenticated()) throw new ApiError("Log in on the site to use your watchlist.", 401);
		const res = await send(`/v1/auctions/control-panel/lots/${auctionPeriod}/${lotId}/watchlist/`, on ? "POST" : "DELETE", on ? {} : void 0);
		if (res.ok) return;
		if (res.status === 401) throw new ApiError(LOGGED_OUT, 401);
		const data = await res.json().catch(() => ({}));
		throw new ApiError(data.code === "lot_already_bid" && data.error ? String(data.error) : "Couldn’t update your watchlist. Please try again.", res.status);
	}
	var BidError = class extends Error {
		status;
		code;
		minNextBid;
		constructor(message, status, code = null, minNextBid = null) {
			super(message);
			this.status = status;
			this.code = code;
			this.minNextBid = minNextBid;
		}
	};
	function bidFailure(status) {
		if (status === 401 || status === 403) return LOGGED_OUT;
		return status === 409 ? "This lot has closed." : `Bid failed (${status}).`;
	}
	async function placeBid(lotId, amount, type) {
		if (!isAuthenticated()) throw new BidError("Log in on the site to bid.", 401);
		let res;
		try {
			res = await send(`/v1/auctions/lots/${lotId}/bids`, "POST", { amount }, {
				"X-Bid-Surface": "other",
				"X-Bid-Type": type
			});
		} catch {
			throw new BidError("Network error – the bid may not have been placed. Check the lot before trying again.", 0);
		}
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			const details = data.details ?? {};
			const message = Array.isArray(details.amount) && details.amount[0] || data.error || bidFailure(res.status);
			throw new BidError(String(message), res.status, data.code ?? null, num(pick(details, "min_next_bid", "minNextBid"), null));
		}
		return {
			isLeading: !!pick(data, "is_leading", "isLeading"),
			isMaxCollision: !!pick(data, "is_max_collision", "isMaxCollision"),
			currentPrice: num(pick(data, "current_price", "currentPrice"), null),
			minNextBid: num(pick(data, "min_next_bid", "minNextBid"), null),
			version: num(data.version, null)
		};
	}
	var EMPTY_META = {
		fetchedAt: null,
		pullStartedAt: null,
		count: 0,
		authed: false
	};
	var dbp = null;
	function open$1() {
		return dbp ??= new Promise((resolve, reject) => {
			const req = indexedDB.open("tlx-catalog", 1);
			req.onupgradeneeded = () => {
				req.result.createObjectStore("lots", { keyPath: "id" });
				req.result.createObjectStore("meta");
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}
	function done(tx) {
		return new Promise((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = tx.onabort = () => reject(tx.error);
		});
	}
	var result = (req) => new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	var getMeta = async (tx) => ({
		...EMPTY_META,
		...await result(tx.objectStore("meta").get("catalog"))
	});
	async function patchMeta(tx, patch) {
		const next = {
			...await getMeta(tx),
			...patch
		};
		tx.objectStore("meta").put(next, "catalog");
		return next;
	}
	async function readMeta() {
		return getMeta((await open$1()).transaction("meta"));
	}
	async function writeMeta(patch) {
		const tx = (await open$1()).transaction("meta", "readwrite");
		const next = await patchMeta(tx, patch);
		await done(tx);
		return next;
	}
	async function readAll() {
		const tx = (await open$1()).transaction(["lots", "meta"]);
		const [lots, meta] = await Promise.all([result(tx.objectStore("lots").getAll()), getMeta(tx)]);
		return {
			lots,
			meta
		};
	}
	async function replaceAll(lots, meta) {
		const tx = (await open$1()).transaction(["lots", "meta"], "readwrite");
		const store = tx.objectStore("lots");
		store.clear();
		lots.forEach((l) => store.put(l));
		await patchMeta(tx, meta);
		await done(tx);
	}
	async function putLots(lots) {
		if (!lots.length) return;
		const tx = (await open$1()).transaction("lots", "readwrite");
		const store = tx.objectStore("lots");
		lots.forEach((l) => store.put(l));
		await done(tx);
	}
	var _GM_addValueChangeListener = (() => typeof GM_addValueChangeListener != "undefined" ? GM_addValueChangeListener : void 0)();
	var _GM_getValue = (() => typeof GM_getValue != "undefined" ? GM_getValue : void 0)();
	var _GM_setValue = (() => typeof GM_setValue != "undefined" ? GM_setValue : void 0)();
	var cache = new Map();
	var changes = new EventTarget();
	function getSetting(key) {
		if (!cache.has(key)) {
			cache.set(key, _GM_getValue(key, DEFAULTS[key]));
			_GM_addValueChangeListener(key, (_name, _old, value, remote) => {
				if (remote) {
					cache.set(key, value ?? DEFAULTS[key]);
					changes.dispatchEvent(new Event(key));
				}
			});
		}
		return cache.get(key);
	}
	function setSetting(key, value) {
		cache.set(key, value);
		_GM_setValue(key, value);
		changes.dispatchEvent(new Event(key));
	}
	function onSetting(key, fn) {
		getSetting(key);
		changes.addEventListener(key, fn);
		return () => changes.removeEventListener(key, fn);
	}
	function useSetting(key) {
		return [C(q$1((fn) => onSetting(key, fn), [key]), () => getSetting(key)), (v) => setSetting(key, v)];
	}
	var DETAIL_TTL = 2 * MINUTE;
	var ACTIVE_WINDOW = 10 * MINUTE;
	var CHECK_EVERY = 15e3;
	var state$1 = {
		loaded: false,
		lots: new Map(),
		meta: EMPTY_META,
		progress: null,
		error: null,
		rev: 0
	};
	var { subscribe: subscribe$1, emit: emit$1 } = emitter();
	function changed() {
		state$1.rev++;
		emit$1();
	}
	function useCatalog() {
		C(subscribe$1, () => state$1.rev);
		return state$1;
	}
	var getLot = (id) => state$1.lots.get(id);
	function syncIntervalMs() {
		const m = Number(getSetting(KEYS.syncMinutes));
		return Math.max(1, Number.isFinite(m) ? m : 5) * MINUTE;
	}
	function nextPullAt(meta = state$1.meta) {
		return meta.pullStartedAt == null ? 0 : meta.pullStartedAt + syncIntervalMs();
	}
	var channel = new BroadcastChannel("tlx-catalog");
	var broadcast = (msg) => channel.postMessage(msg);
	channel.addEventListener("message", async (e) => {
		if (e.data?.type === "synced") await reloadFromDb();
		else if (e.data?.type === "meta") {
			state$1.meta = await readMeta();
			changed();
		}
	});
	async function reloadFromDb() {
		const { lots, meta } = await readAll();
		const map = new Map(lots.map((l) => [l.id, l]));
		for (const [id, mine] of state$1.lots) {
			const theirs = map.get(id);
			if (theirs && mine.version > theirs.version) map.set(id, mine);
		}
		Object.assign(state$1, {
			lots: map,
			meta,
			loaded: true
		});
		changed();
	}
	var pulling = false;
	async function pullCatalog() {
		if (pulling) return "busy";
		pulling = true;
		try {
			return await navigator.locks.request("tlx-catalog-pull", { ifAvailable: true }, (lock) => lock ? runPull() : "busy");
		} finally {
			pulling = false;
		}
	}
	async function runPull() {
		const meta = await readMeta();
		if (Date.now() < nextPullAt(meta)) {
			if (meta.fetchedAt !== state$1.meta.fetchedAt) await reloadFromDb();
			return "not-due";
		}
		state$1.meta = await writeMeta({ pullStartedAt: Date.now() });
		broadcast({ type: "meta" });
		const firstLoad = state$1.lots.size === 0;
		const startedAt = Date.now();
		const pulled = new Map();
		const stamp = (l) => {
			const prev = state$1.lots.get(l.id);
			return {
				...l,
				firstSeenAt: prev ? prev.firstSeenAt ?? 0 : firstLoad ? 0 : startedAt
			};
		};
		state$1.error = null;
		state$1.progress = {
			done: 0,
			total: null
		};
		changed();
		try {
			let pages = 1;
			let count = 0;
			for (let page = 1; page <= pages; page++) {
				const d = await fetchLotPage(page);
				if (page === 1) {
					count = d.count;
					pages = Math.max(1, Math.ceil(d.count / 100));
				}
				for (const l of d.results) {
					pulled.set(l.id, stamp(l));
					if (firstLoad) state$1.lots.set(l.id, pulled.get(l.id));
				}
				state$1.progress = {
					done: pulled.size,
					total: count
				};
				changed();
				if (!d.results.length) break;
			}
			for (const [id, mine] of state$1.lots) {
				const fresh = pulled.get(id);
				if (fresh && mine.version > fresh.version) pulled.set(id, {
					...mine,
					firstSeenAt: fresh.firstSeenAt
				});
			}
			if (pulled.size < count) {
				const now = Date.now();
				for (const [id, l] of state$1.lots) if (!pulled.has(id) && l.endsAt > now) pulled.set(id, l);
			}
			await replaceAll([...pulled.values()], {
				fetchedAt: Date.now(),
				count,
				authed: isAuthenticated()
			});
			state$1.lots = pulled;
			state$1.meta = await readMeta();
			broadcast({ type: "synced" });
			return "done";
		} catch (err) {
			state$1.error = `Catalog refresh failed: ${err.message || err}`;
			return "error";
		} finally {
			state$1.progress = null;
			changed();
		}
	}
	var dirty = new Map();
	var flushTimer = 0;
	function persistSoon(lot) {
		dirty.set(lot.id, lot);
		flushTimer ||= window.setTimeout(() => {
			flushTimer = 0;
			const batch = [...dirty.values()];
			dirty.clear();
			putLots(batch).catch(() => {});
		}, 2e3);
	}
	function updateLot(id, patch, opts = {}) {
		const cur = state$1.lots.get(id);
		if (!cur || !opts.force && patch.version != null && patch.version <= cur.version) return;
		const next = {
			...cur,
			...patch
		};
		state$1.lots.set(id, next);
		persistSoon(next);
		changed();
	}
	var details = new Map();
	function loadDetail(lot, signal) {
		const hit = details.get(lot.id);
		if (hit && Date.now() - hit.at < DETAIL_TTL) {
			const cached = hit.data ? Promise.resolve(hit.data) : hit.promise;
			if (cached) return cached;
		}
		const promise = fetchLotDetail(lot.auctionPeriod, lot.id, signal).then((d) => {
			details.set(lot.id, {
				at: Date.now(),
				data: d
			});
			const { description, brand, model, lotFee, bidHistory, ...base } = d;
			const cur = state$1.lots.get(lot.id);
			if (cur && base.version >= cur.version) updateLot(lot.id, base, { force: true });
			return d;
		}, (err) => {
			details.delete(lot.id);
			throw err;
		});
		details.set(lot.id, {
			at: Date.now(),
			promise
		});
		return promise;
	}
	var invalidateDetail = (id) => void details.delete(id);
	function cachedDetail(id) {
		const hit = details.get(id);
		return hit && Date.now() - hit.at < DETAIL_TTL ? hit.data : void 0;
	}
	var lastActivity = Date.now();
	var markActive = () => lastActivity = Date.now();
	function maybeAutoPull() {
		const idle = Date.now() - lastActivity > ACTIVE_WINDOW;
		if (state$1.loaded && !pulling && document.visibilityState === "visible" && !idle && Date.now() >= nextPullAt()) pullCatalog();
	}
	async function startCatalog() {
		for (const ev of [
			"pointerdown",
			"keydown",
			"wheel",
			"touchstart",
			"scroll"
		]) window.addEventListener(ev, markActive, {
			passive: true,
			capture: true
		});
		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "visible") {
				markActive();
				maybeAutoPull();
			}
		});
		onSetting(KEYS.syncMinutes, changed);
		try {
			await reloadFromDb();
		} catch (err) {
			state$1.loaded = true;
			state$1.error = `Couldn’t read the local cache: ${err.message || err}`;
			changed();
		}
		maybeAutoPull();
		window.setInterval(maybeAutoPull, CHECK_EVERY);
	}
	var f = 0;
	Array.isArray;
	function u(e, t, n, o, i, u) {
		t || (t = {});
		var a, c, p = t;
		if ("ref" in p) for (c in p = {}, t) "ref" == c ? a = t[c] : p[c] = t[c];
		var l = {
			type: e,
			props: p,
			key: n,
			ref: a,
			__k: null,
			__: null,
			__b: 0,
			__e: null,
			__c: null,
			constructor: void 0,
			__v: --f,
			__i: -1,
			__u: 0,
			__source: i,
			__self: u
		};
		if ("function" == typeof e && (a = e.defaultProps)) for (c in a) void 0 === p[c] && (p[c] = a[c]);
		return l$1.vnode && l$1.vnode(l), l;
	}
	var PATHS = {
		visibilityOff: "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7M2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2m4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3z",
		visibility: "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5M12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5m0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3",
		cancel: "M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2m5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12z",
		close: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
		filter: "M10 18h4v-2h-4zM3 6v2h18V6zm3 7h12v-2H6z",
		expandMore: "M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z",
		open: "M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3z",
		refresh: "M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z",
		chevronLeft: "M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z",
		chevronRight: "M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z",
		starBorder: "M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28z",
		star: "M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
	};
	function Icon({ name, size = 18 }) {
		return u("svg", {
			viewBox: "0 0 24 24",
			width: size,
			height: size,
			"aria-hidden": "true",
			focusable: "false",
			children: u("path", {
				d: PATHS[name],
				fill: "currentColor"
			})
		});
	}
	function __awaiter(thisArg, _arguments, P, generator) {
		function adopt(value) {
			return value instanceof P ? value : new P(function(resolve) {
				resolve(value);
			});
		}
		return new (P || (P = Promise))(function(resolve, reject) {
			function fulfilled(value) {
				try {
					step(generator.next(value));
				} catch (e) {
					reject(e);
				}
			}
			function rejected(value) {
				try {
					step(generator["throw"](value));
				} catch (e) {
					reject(e);
				}
			}
			function step(result) {
				result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
			}
			step((generator = generator.apply(thisArg, _arguments || [])).next());
		});
	}
	function getDefaultExportFromCjs(x) {
		return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
	}
	var events = { exports: {} };
	var hasRequiredEvents;
	function requireEvents() {
		if (hasRequiredEvents) return events.exports;
		hasRequiredEvents = 1;
		var R = typeof Reflect === "object" ? Reflect : null;
		var ReflectApply = R && typeof R.apply === "function" ? R.apply : function ReflectApply(target, receiver, args) {
			return Function.prototype.apply.call(target, receiver, args);
		};
		var ReflectOwnKeys;
		if (R && typeof R.ownKeys === "function") ReflectOwnKeys = R.ownKeys;
		else if (Object.getOwnPropertySymbols) ReflectOwnKeys = function ReflectOwnKeys(target) {
			return Object.getOwnPropertyNames(target).concat(Object.getOwnPropertySymbols(target));
		};
		else ReflectOwnKeys = function ReflectOwnKeys(target) {
			return Object.getOwnPropertyNames(target);
		};
		function ProcessEmitWarning(warning) {
			if (console && console.warn) console.warn(warning);
		}
		var NumberIsNaN = Number.isNaN || function NumberIsNaN(value) {
			return value !== value;
		};
		function EventEmitter() {
			EventEmitter.init.call(this);
		}
		events.exports = EventEmitter;
		events.exports.once = once;
		EventEmitter.EventEmitter = EventEmitter;
		EventEmitter.prototype._events = void 0;
		EventEmitter.prototype._eventsCount = 0;
		EventEmitter.prototype._maxListeners = void 0;
		var defaultMaxListeners = 10;
		function checkListener(listener) {
			if (typeof listener !== "function") throw new TypeError("The \"listener\" argument must be of type Function. Received type " + typeof listener);
		}
		Object.defineProperty(EventEmitter, "defaultMaxListeners", {
			enumerable: true,
			get: function() {
				return defaultMaxListeners;
			},
			set: function(arg) {
				if (typeof arg !== "number" || arg < 0 || NumberIsNaN(arg)) throw new RangeError("The value of \"defaultMaxListeners\" is out of range. It must be a non-negative number. Received " + arg + ".");
				defaultMaxListeners = arg;
			}
		});
		EventEmitter.init = function() {
			if (this._events === void 0 || this._events === Object.getPrototypeOf(this)._events) {
				this._events = Object.create(null);
				this._eventsCount = 0;
			}
			this._maxListeners = this._maxListeners || void 0;
		};
		EventEmitter.prototype.setMaxListeners = function setMaxListeners(n) {
			if (typeof n !== "number" || n < 0 || NumberIsNaN(n)) throw new RangeError("The value of \"n\" is out of range. It must be a non-negative number. Received " + n + ".");
			this._maxListeners = n;
			return this;
		};
		function _getMaxListeners(that) {
			if (that._maxListeners === void 0) return EventEmitter.defaultMaxListeners;
			return that._maxListeners;
		}
		EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
			return _getMaxListeners(this);
		};
		EventEmitter.prototype.emit = function emit(type) {
			var args = [];
			for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
			var doError = type === "error";
			var events = this._events;
			if (events !== void 0) doError = doError && events.error === void 0;
			else if (!doError) return false;
			if (doError) {
				var er;
				if (args.length > 0) er = args[0];
				if (er instanceof Error) throw er;
				var err = new Error("Unhandled error." + (er ? " (" + er.message + ")" : ""));
				err.context = er;
				throw err;
			}
			var handler = events[type];
			if (handler === void 0) return false;
			if (typeof handler === "function") ReflectApply(handler, this, args);
			else {
				var len = handler.length;
				var listeners = arrayClone(handler, len);
				for (var i = 0; i < len; ++i) ReflectApply(listeners[i], this, args);
			}
			return true;
		};
		function _addListener(target, type, listener, prepend) {
			var m;
			var events;
			var existing;
			checkListener(listener);
			events = target._events;
			if (events === void 0) {
				events = target._events = Object.create(null);
				target._eventsCount = 0;
			} else {
				if (events.newListener !== void 0) {
					target.emit("newListener", type, listener.listener ? listener.listener : listener);
					events = target._events;
				}
				existing = events[type];
			}
			if (existing === void 0) {
				existing = events[type] = listener;
				++target._eventsCount;
			} else {
				if (typeof existing === "function") existing = events[type] = prepend ? [listener, existing] : [existing, listener];
				else if (prepend) existing.unshift(listener);
				else existing.push(listener);
				m = _getMaxListeners(target);
				if (m > 0 && existing.length > m && !existing.warned) {
					existing.warned = true;
					var w = new Error("Possible EventEmitter memory leak detected. " + existing.length + " " + String(type) + " listeners added. Use emitter.setMaxListeners() to increase limit");
					w.name = "MaxListenersExceededWarning";
					w.emitter = target;
					w.type = type;
					w.count = existing.length;
					ProcessEmitWarning(w);
				}
			}
			return target;
		}
		EventEmitter.prototype.addListener = function addListener(type, listener) {
			return _addListener(this, type, listener, false);
		};
		EventEmitter.prototype.on = EventEmitter.prototype.addListener;
		EventEmitter.prototype.prependListener = function prependListener(type, listener) {
			return _addListener(this, type, listener, true);
		};
		function onceWrapper() {
			if (!this.fired) {
				this.target.removeListener(this.type, this.wrapFn);
				this.fired = true;
				if (arguments.length === 0) return this.listener.call(this.target);
				return this.listener.apply(this.target, arguments);
			}
		}
		function _onceWrap(target, type, listener) {
			var state = {
				fired: false,
				wrapFn: void 0,
				target,
				type,
				listener
			};
			var wrapped = onceWrapper.bind(state);
			wrapped.listener = listener;
			state.wrapFn = wrapped;
			return wrapped;
		}
		EventEmitter.prototype.once = function once(type, listener) {
			checkListener(listener);
			this.on(type, _onceWrap(this, type, listener));
			return this;
		};
		EventEmitter.prototype.prependOnceListener = function prependOnceListener(type, listener) {
			checkListener(listener);
			this.prependListener(type, _onceWrap(this, type, listener));
			return this;
		};
		EventEmitter.prototype.removeListener = function removeListener(type, listener) {
			var list, events, position, i, originalListener;
			checkListener(listener);
			events = this._events;
			if (events === void 0) return this;
			list = events[type];
			if (list === void 0) return this;
			if (list === listener || list.listener === listener) {
				if (--this._eventsCount === 0) this._events = Object.create(null);
				else {
					delete events[type];
					if (events.removeListener) this.emit("removeListener", type, list.listener || listener);
				}
			} else if (typeof list !== "function") {
				position = -1;
				for (i = list.length - 1; i >= 0; i--) if (list[i] === listener || list[i].listener === listener) {
					originalListener = list[i].listener;
					position = i;
					break;
				}
				if (position < 0) return this;
				if (position === 0) list.shift();
				else spliceOne(list, position);
				if (list.length === 1) events[type] = list[0];
				if (events.removeListener !== void 0) this.emit("removeListener", type, originalListener || listener);
			}
			return this;
		};
		EventEmitter.prototype.off = EventEmitter.prototype.removeListener;
		EventEmitter.prototype.removeAllListeners = function removeAllListeners(type) {
			var listeners, events = this._events, i;
			if (events === void 0) return this;
			if (events.removeListener === void 0) {
				if (arguments.length === 0) {
					this._events = Object.create(null);
					this._eventsCount = 0;
				} else if (events[type] !== void 0) {
					if (--this._eventsCount === 0) this._events = Object.create(null);
					else delete events[type];
				}
				return this;
			}
			if (arguments.length === 0) {
				var keys = Object.keys(events);
				var key;
				for (i = 0; i < keys.length; ++i) {
					key = keys[i];
					if (key === "removeListener") continue;
					this.removeAllListeners(key);
				}
				this.removeAllListeners("removeListener");
				this._events = Object.create(null);
				this._eventsCount = 0;
				return this;
			}
			listeners = events[type];
			if (typeof listeners === "function") this.removeListener(type, listeners);
			else if (listeners !== void 0) for (i = listeners.length - 1; i >= 0; i--) this.removeListener(type, listeners[i]);
			return this;
		};
		function _listeners(target, type, unwrap) {
			var events = target._events;
			if (events === void 0) return [];
			var evlistener = events[type];
			if (evlistener === void 0) return [];
			if (typeof evlistener === "function") return unwrap ? [evlistener.listener || evlistener] : [evlistener];
			return unwrap ? unwrapListeners(evlistener) : arrayClone(evlistener, evlistener.length);
		}
		EventEmitter.prototype.listeners = function listeners(type) {
			return _listeners(this, type, true);
		};
		EventEmitter.prototype.rawListeners = function rawListeners(type) {
			return _listeners(this, type, false);
		};
		EventEmitter.listenerCount = function(emitter, type) {
			if (typeof emitter.listenerCount === "function") return emitter.listenerCount(type);
			else return listenerCount.call(emitter, type);
		};
		EventEmitter.prototype.listenerCount = listenerCount;
		function listenerCount(type) {
			var events = this._events;
			if (events !== void 0) {
				var evlistener = events[type];
				if (typeof evlistener === "function") return 1;
				else if (evlistener !== void 0) return evlistener.length;
			}
			return 0;
		}
		EventEmitter.prototype.eventNames = function eventNames() {
			return this._eventsCount > 0 ? ReflectOwnKeys(this._events) : [];
		};
		function arrayClone(arr, n) {
			var copy = new Array(n);
			for (var i = 0; i < n; ++i) copy[i] = arr[i];
			return copy;
		}
		function spliceOne(list, index) {
			for (; index + 1 < list.length; index++) list[index] = list[index + 1];
			list.pop();
		}
		function unwrapListeners(arr) {
			var ret = new Array(arr.length);
			for (var i = 0; i < ret.length; ++i) ret[i] = arr[i].listener || arr[i];
			return ret;
		}
		function once(emitter, name) {
			return new Promise(function(resolve, reject) {
				function errorListener(err) {
					emitter.removeListener(name, resolver);
					reject(err);
				}
				function resolver() {
					if (typeof emitter.removeListener === "function") emitter.removeListener("error", errorListener);
					resolve([].slice.call(arguments));
				}
				eventTargetAgnosticAddListener(emitter, name, resolver, { once: true });
				if (name !== "error") addErrorHandlerIfEventEmitter(emitter, errorListener, { once: true });
			});
		}
		function addErrorHandlerIfEventEmitter(emitter, handler, flags) {
			if (typeof emitter.on === "function") eventTargetAgnosticAddListener(emitter, "error", handler, flags);
		}
		function eventTargetAgnosticAddListener(emitter, name, listener, flags) {
			if (typeof emitter.on === "function") {
				if (flags.once) emitter.once(name, listener);
				else emitter.on(name, listener);
			} else if (typeof emitter.addEventListener === "function") emitter.addEventListener(name, function wrapListener(arg) {
				if (flags.once) emitter.removeEventListener(name, wrapListener);
				listener(arg);
			});
			else throw new TypeError("The \"emitter\" argument must be of type EventEmitter. Received type " + typeof emitter);
		}
		return events.exports;
	}
	var EventEmitter = getDefaultExportFromCjs(requireEvents());
	var errorCodes;
	(function(errorCodes) {
		errorCodes[errorCodes["timeout"] = 1] = "timeout";
		errorCodes[errorCodes["transportClosed"] = 2] = "transportClosed";
		errorCodes[errorCodes["clientDisconnected"] = 3] = "clientDisconnected";
		errorCodes[errorCodes["clientClosed"] = 4] = "clientClosed";
		errorCodes[errorCodes["clientConnectToken"] = 5] = "clientConnectToken";
		errorCodes[errorCodes["clientRefreshToken"] = 6] = "clientRefreshToken";
		errorCodes[errorCodes["subscriptionUnsubscribed"] = 7] = "subscriptionUnsubscribed";
		errorCodes[errorCodes["subscriptionSubscribeToken"] = 8] = "subscriptionSubscribeToken";
		errorCodes[errorCodes["subscriptionRefreshToken"] = 9] = "subscriptionRefreshToken";
		errorCodes[errorCodes["transportWriteError"] = 10] = "transportWriteError";
		errorCodes[errorCodes["connectionClosed"] = 11] = "connectionClosed";
		errorCodes[errorCodes["badConfiguration"] = 12] = "badConfiguration";
		errorCodes[errorCodes["subscriptionGetState"] = 13] = "subscriptionGetState";
		errorCodes[errorCodes["sharedPollGetSignature"] = 14] = "sharedPollGetSignature";
	})(errorCodes || (errorCodes = {}));
	var connectingCodes;
	(function(connectingCodes) {
		connectingCodes[connectingCodes["connectCalled"] = 0] = "connectCalled";
		connectingCodes[connectingCodes["transportClosed"] = 1] = "transportClosed";
		connectingCodes[connectingCodes["noPing"] = 2] = "noPing";
		connectingCodes[connectingCodes["subscribeTimeout"] = 3] = "subscribeTimeout";
		connectingCodes[connectingCodes["unsubscribeError"] = 4] = "unsubscribeError";
	})(connectingCodes || (connectingCodes = {}));
	var disconnectedCodes;
	(function(disconnectedCodes) {
		disconnectedCodes[disconnectedCodes["disconnectCalled"] = 0] = "disconnectCalled";
		disconnectedCodes[disconnectedCodes["unauthorized"] = 1] = "unauthorized";
		disconnectedCodes[disconnectedCodes["badProtocol"] = 2] = "badProtocol";
		disconnectedCodes[disconnectedCodes["messageSizeLimit"] = 3] = "messageSizeLimit";
		disconnectedCodes[disconnectedCodes["stateInvalidated"] = 3014] = "stateInvalidated";
	})(disconnectedCodes || (disconnectedCodes = {}));
	var subscribingCodes;
	(function(subscribingCodes) {
		subscribingCodes[subscribingCodes["subscribeCalled"] = 0] = "subscribeCalled";
		subscribingCodes[subscribingCodes["transportClosed"] = 1] = "transportClosed";
	})(subscribingCodes || (subscribingCodes = {}));
	var unsubscribedCodes;
	(function(unsubscribedCodes) {
		unsubscribedCodes[unsubscribedCodes["unsubscribeCalled"] = 0] = "unsubscribeCalled";
		unsubscribedCodes[unsubscribedCodes["unauthorized"] = 1] = "unauthorized";
		unsubscribedCodes[unsubscribedCodes["clientClosed"] = 2] = "clientClosed";
		unsubscribedCodes[unsubscribedCodes["stateInvalidated"] = 2502] = "stateInvalidated";
	})(unsubscribedCodes || (unsubscribedCodes = {}));
	var subscriptionFlags;
	(function(subscriptionFlags) {
		subscriptionFlags[subscriptionFlags["channelCompaction"] = 1] = "channelCompaction";
		subscriptionFlags[subscriptionFlags["rejectUnrecovered"] = 2] = "rejectUnrecovered";
	})(subscriptionFlags || (subscriptionFlags = {}));
	var State;
	(function(State) {
		State["Disconnected"] = "disconnected";
		State["Connecting"] = "connecting";
		State["Connected"] = "connected";
	})(State || (State = {}));
	var SubscriptionState;
	(function(SubscriptionState) {
		SubscriptionState["Unsubscribed"] = "unsubscribed";
		SubscriptionState["Subscribing"] = "subscribing";
		SubscriptionState["Subscribed"] = "subscribed";
	})(SubscriptionState || (SubscriptionState = {}));
	function startsWith(value, prefix) {
		return value.lastIndexOf(prefix, 0) === 0;
	}
	function isFunction(value) {
		if (value === void 0 || value === null) return false;
		return typeof value === "function";
	}
	function log(level, args) {
		if (globalThis.console) {
			const logger = globalThis.console[level];
			if (isFunction(logger)) logger.apply(globalThis.console, args);
		}
	}
	function randomInt(min, max) {
		return Math.floor(Math.random() * (max - min + 1) + min);
	}
	function backoff(step, min, max) {
		if (step > 31) step = 31;
		const interval = randomInt(0, Math.min(max, min * Math.pow(2, step)));
		return Math.min(max, min + interval);
	}
	function errorExists(data) {
		return "error" in data && data.error !== null;
	}
	function ttlMilliseconds(ttl) {
		return Math.min(ttl * 1e3, 2147483647);
	}
	function localStorageItem(key) {
		try {
			if (typeof localStorage === "undefined" || localStorage === null || !isFunction(localStorage.getItem)) return null;
			return localStorage.getItem(key);
		} catch (e) {
			return null;
		}
	}
	var MapPhase;
	(function(MapPhase) {
		MapPhase[MapPhase["Live"] = 0] = "Live";
		MapPhase[MapPhase["Stream"] = 1] = "Stream";
		MapPhase[MapPhase["State"] = 2] = "State";
	})(MapPhase || (MapPhase = {}));
	var BaseSubscription = class extends EventEmitter {
		constructor(centrifuge, channel, options) {
			super();
			this._resubscribeTimeout = null;
			this._refreshTimeout = null;
			this._getState = null;
			this._map = false;
			this._mapPresenceType = 1;
			this._mapPhase = null;
			this._mapStateBuffer = [];
			this._mapStreamBuffer = [];
			this._mapCursor = "";
			this._mapPageSize = 0;
			this._mapUnrecoverableStrategy = "from_scratch";
			this._debounceMs = 0;
			this._debouncePending = new Map();
			this._sharedPoll = false;
			this._sharedPollEpoch = "";
			this._sharedPollTrackedItems = new Map();
			this._sharedPollGetSignature = null;
			this._sharedPollSignatureRefreshTimeout = null;
			this._sharedPollSignatureRefreshAttempts = 0;
			this._sharedPollTrackRetryTimeout = null;
			this._sharedPollTrackRetryAttempts = 0;
			this._sharedPollReplayRetryTimeout = null;
			this._sharedPollReplayRetryAttempts = 0;
			this._sharedPollSignatures = [];
			this._sharedPollSignatureRefreshTargetMs = null;
			this._sharedPollSignatureRefreshInFlight = false;
			this.channel = channel;
			this.state = SubscriptionState.Unsubscribed;
			this._centrifuge = centrifuge;
			this._token = "";
			this._getToken = null;
			this._data = null;
			this._getData = null;
			this._recover = false;
			this._offset = null;
			this._epoch = null;
			this._id = 0;
			this._recoverable = false;
			this._positioned = false;
			this._joinLeave = false;
			this._minResubscribeDelay = 500;
			this._maxResubscribeDelay = 2e4;
			this._resubscribeTimeout = null;
			this._resubscribeAttempts = 0;
			this._promises = {};
			this._promiseId = 0;
			this._inflight = false;
			this._refreshTimeout = null;
			this._delta = "";
			this._delta_negotiated = false;
			this._tagsFilter = null;
			this._prevValueMap = new Map();
			this._unsubPromise = Promise.resolve();
			this._deltaNumPubs = 0;
			this._deltaNumFull = 0;
			this._deltaNumDelta = 0;
			this._deltaBytesReceived = 0;
			this._deltaBytesDecoded = 0;
			this._setOptions(options);
			this.type = this._sharedPoll ? "shared_poll" : this._map ? "map" : "stream";
			if (this._centrifuge._debugEnabled) {
				this.on("state", (ctx) => {
					this._debug("subscription state", channel, ctx.oldState, "->", ctx.newState);
				});
				this.on("error", (ctx) => {
					this._debug("subscription error", channel, ctx);
				});
			} else this.on("error", function() {
				Function.prototype();
			});
		}
		ready(timeout) {
			if (this.state === SubscriptionState.Unsubscribed) return Promise.reject({
				code: errorCodes.subscriptionUnsubscribed,
				message: this.state
			});
			if (this.state === SubscriptionState.Subscribed) return Promise.resolve();
			return new Promise((res, rej) => {
				const ctx = {
					resolve: res,
					reject: rej
				};
				if (timeout) ctx.timeout = setTimeout(function() {
					rej({
						code: errorCodes.timeout,
						message: "timeout"
					});
				}, timeout);
				this._promises[this._nextPromiseId()] = ctx;
			});
		}
		subscribe() {
			if (this._isSubscribed()) return;
			this._resubscribeAttempts = 0;
			this._setSubscribing(subscribingCodes.subscribeCalled, "subscribe called");
		}
		unsubscribe() {
			this._unsubPromise = this._setUnsubscribed(unsubscribedCodes.unsubscribeCalled, "unsubscribe called", true);
		}
		_debouncedPublish(key, data, isMap) {
			const existing = this._debouncePending.get(key);
			if (existing) {
				existing.data = data;
				existing.dirty = true;
				return Promise.resolve({});
			}
			const entry = {
				data,
				dirty: false,
				timer: null
			};
			entry.timer = setTimeout(() => {
				const pending = this._debouncePending.get(key);
				if (!pending || !pending.dirty) {
					this._debouncePending.delete(key);
					return;
				}
				pending.dirty = false;
				const sendData = pending.data;
				(isMap ? this._centrifuge.mapPublish(this.channel, key, sendData) : this._centrifuge.publish(this.channel, sendData)).catch(() => {});
				pending.timer = setTimeout(() => {
					const p = this._debouncePending.get(key);
					if (!p || !p.dirty) {
						this._debouncePending.delete(key);
						return;
					}
					this._debouncePending.delete(key);
					this._debouncedPublish(key, p.data, isMap);
				}, this._debounceMs);
			}, this._debounceMs);
			this._debouncePending.set(key, entry);
			return isMap ? this._centrifuge.mapPublish(this.channel, key, data) : this._centrifuge.publish(this.channel, data);
		}
		_cancelDebounce(key) {
			const existing = this._debouncePending.get(key);
			if (existing) {
				clearTimeout(existing.timer);
				this._debouncePending.delete(key);
			}
		}
		_cancelAllDebounce() {
			for (const [, entry] of this._debouncePending) clearTimeout(entry.timer);
			this._debouncePending.clear();
		}
		presence() {
			return __awaiter(this, void 0, void 0, function* () {
				yield this._methodCall();
				return this._centrifuge.presence(this.channel);
			});
		}
		presenceStats() {
			return __awaiter(this, void 0, void 0, function* () {
				yield this._methodCall();
				return this._centrifuge.presenceStats(this.channel);
			});
		}
		setTagsFilter(tagsFilter) {
			if (tagsFilter && this._delta) throw new Error("cannot use delta and tagsFilter together");
			this._tagsFilter = tagsFilter;
			if (this._map) {
				this._recover = false;
				this._offset = null;
				this._epoch = null;
			}
		}
		setData(data) {
			this._data = data;
		}
		deltaStats() {
			const bytesDecoded = this._deltaBytesDecoded;
			return {
				numPublications: this._deltaNumPubs,
				numFullPayloads: this._deltaNumFull,
				numDeltaPayloads: this._deltaNumDelta,
				bytesReceived: this._deltaBytesReceived,
				bytesDecoded,
				compressionRatio: bytesDecoded > 0 ? 1 - this._deltaBytesReceived / bytesDecoded : 0
			};
		}
		_methodCall() {
			if (this._isSubscribed()) return Promise.resolve();
			if (this._isUnsubscribed()) return Promise.reject({
				code: errorCodes.subscriptionUnsubscribed,
				message: this.state
			});
			return new Promise((resolve, reject) => {
				const timeoutDuration = this._centrifuge._config.timeout;
				const timeout = setTimeout(() => {
					reject({
						code: errorCodes.timeout,
						message: "timeout"
					});
				}, timeoutDuration);
				this._promises[this._nextPromiseId()] = {
					timeout,
					resolve,
					reject
				};
			});
		}
		_nextPromiseId() {
			return ++this._promiseId;
		}
		_needRecover() {
			return this._recover === true;
		}
		_isUnsubscribed() {
			return this.state === SubscriptionState.Unsubscribed;
		}
		_isSubscribing() {
			return this.state === SubscriptionState.Subscribing;
		}
		_isSubscribed() {
			return this.state === SubscriptionState.Subscribed;
		}
		_setState(newState) {
			if (this.state !== newState) {
				const oldState = this.state;
				this.state = newState;
				this.emit("state", {
					newState,
					oldState,
					channel: this.channel
				});
				return true;
			}
			return false;
		}
		_usesToken() {
			return this._token !== "" || this._getToken !== null;
		}
		_clearSubscribingState() {
			this._resubscribeAttempts = 0;
			this._clearResubscribeTimeout();
		}
		_clearSubscribedState() {
			this._clearRefreshTimeout();
			this._cancelAllDebounce();
			this._clearSharedPollSignatureRefresh();
			this._clearSharedPollTrackRetry();
			this._clearSharedPollReplayRetry();
			this._sharedPollSignatureRefreshTargetMs = null;
			this._sharedPollSignatureRefreshInFlight = false;
		}
		_invalidateState() {
			this._token = "";
			this._prevValueMap = new Map();
			if (this._map) {
				this._offset = null;
				this._epoch = null;
				this._recover = false;
				this._mapStateBuffer = [];
				this._mapStreamBuffer = [];
				this._mapCursor = "";
				this._mapPhase = null;
			} else {
				this._offset = 0;
				this._epoch = "_";
			}
		}
		_setSubscribed(result) {
			if (!this._isSubscribing()) return;
			this._clearSubscribingState();
			if (result.id) this._id = result.id;
			if (result.recoverable) {
				this._recover = true;
				this._offset = result.offset || 0;
				this._epoch = result.epoch || "";
			}
			if (result.delta) this._delta_negotiated = true;
			else this._delta_negotiated = false;
			if (result.publish_debounce) this._debounceMs = result.publish_debounce;
			if (this._sharedPoll) {
				const newEpoch = result.epoch || "";
				if (this._sharedPollEpoch !== "" && this._sharedPollEpoch !== newEpoch) for (const key of this._sharedPollTrackedItems.keys()) this._sharedPollTrackedItems.set(key, 0);
				this._sharedPollEpoch = newEpoch;
			}
			this._setState(SubscriptionState.Subscribed);
			const ctx = this._centrifuge._getSubscribeContext(this.channel, result);
			this.emit("subscribed", ctx);
			this._resolvePromises();
			const pubs = result.publications;
			if (pubs && pubs.length > 0) for (const i in pubs) {
				if (!pubs.hasOwnProperty(i)) continue;
				this._handlePublication(pubs[i]);
			}
			if (result.expires === true) this._refreshTimeout = setTimeout(() => this._refresh(), ttlMilliseconds(result.ttl));
		}
		_setSubscribing(code, reason) {
			return __awaiter(this, void 0, void 0, function* () {
				if (this._isSubscribing()) return;
				if (this._isSubscribed()) this._clearSubscribedState();
				this._id = 0;
				if (this._setState(SubscriptionState.Subscribing)) this.emit("subscribing", {
					channel: this.channel,
					code,
					reason
				});
				if (this._centrifuge._transport && this._centrifuge._transport.emulation()) yield this._unsubPromise;
				if (!this._isSubscribing()) return;
				this._subscribe();
			});
		}
		_subscribe() {
			this._debug("subscribing on", this.channel);
			if (!this._isTransportOpen()) {
				this._debug("delay subscribe on", this.channel, "till connected");
				return null;
			}
			if (this._inflight) return null;
			this._inflight = true;
			if (this._map) {
				this._mapSubscribe();
				return null;
			}
			if (this._getState && this._offset === null) {
				this._loadStreamState();
				return null;
			}
			if (this._canSubscribeWithoutGettingToken()) return this._subscribeWithoutToken();
			this._getSubscriptionToken().then((token) => this._handleTokenResponse(token)).catch((e) => this._handleTokenError(e));
			return null;
		}
		_isTransportOpen() {
			return this._centrifuge._transportIsOpen;
		}
		_canSubscribeWithoutGettingToken() {
			return !this._usesToken() || !!this._token;
		}
		_subscribeWithoutToken() {
			if (this._getData) {
				this._getDataAndSubscribe(this._token);
				return null;
			} else return this._sendSubscribe(this._token);
		}
		_loadStreamState() {
			if (!this._isSubscribing()) {
				this._inflight = false;
				return;
			}
			this._getState().then((result) => {
				if (!this._isSubscribing()) {
					this._inflight = false;
					return;
				}
				this._offset = result.offset;
				this._epoch = result.epoch;
				this._recover = true;
				if (this._canSubscribeWithoutGettingToken()) this._subscribeWithoutToken();
				else this._getSubscriptionToken().then((token) => this._handleTokenResponse(token)).catch((e) => this._handleTokenError(e));
			}).catch((e) => {
				if (!this._isSubscribing()) {
					this._inflight = false;
					return;
				}
				this._inflight = false;
				this._subscribeError({
					code: errorCodes.subscriptionGetState,
					message: (e === null || e === void 0 ? void 0 : e.toString()) || "getState failed",
					temporary: true
				});
			});
		}
		_getDataAndSubscribe(token) {
			if (!this._getData) {
				this._inflight = false;
				return;
			}
			this._getData({ channel: this.channel }).then((data) => {
				if (!this._isSubscribing()) {
					this._inflight = false;
					return;
				}
				this._data = data;
				this._sendSubscribe(token);
			}).catch((e) => this._handleGetDataError(e));
		}
		_handleGetDataError(error) {
			if (!this._isSubscribing()) {
				this._inflight = false;
				return;
			}
			if (error instanceof UnauthorizedError) {
				this._inflight = false;
				this._failUnauthorized();
				return;
			}
			this.emit("error", {
				type: "subscribeData",
				channel: this.channel,
				error: {
					code: errorCodes.badConfiguration,
					message: (error === null || error === void 0 ? void 0 : error.toString()) || ""
				}
			});
			this._inflight = false;
			this._scheduleResubscribe();
		}
		_handleTokenResponse(token) {
			if (!this._isSubscribing()) {
				this._inflight = false;
				return;
			}
			if (!token) {
				this._inflight = false;
				this._failUnauthorized();
				return;
			}
			this._token = token;
			if (this._getData) this._getDataAndSubscribe(token);
			else this._sendSubscribe(token);
		}
		_handleTokenError(error) {
			if (!this._isSubscribing()) {
				this._inflight = false;
				return;
			}
			if (error instanceof UnauthorizedError) {
				this._inflight = false;
				this._failUnauthorized();
				return;
			}
			this.emit("error", {
				type: "subscribeToken",
				channel: this.channel,
				error: {
					code: errorCodes.subscriptionSubscribeToken,
					message: (error === null || error === void 0 ? void 0 : error.toString()) || ""
				}
			});
			this._inflight = false;
			this._scheduleResubscribe();
		}
		_sendSubscribe(token) {
			if (!this._isTransportOpen()) {
				this._inflight = false;
				return null;
			}
			const cmd = this._buildSubscribeCommand(token);
			this._centrifuge._call(cmd).then((resolveCtx) => {
				this._inflight = false;
				const result = resolveCtx.reply.subscribe;
				this._handleSubscribeResponse(result);
				if (resolveCtx.next) resolveCtx.next();
			}, (rejectCtx) => {
				this._inflight = false;
				this._handleSubscribeError(rejectCtx.error);
				if (rejectCtx.next) rejectCtx.next();
			});
			return cmd;
		}
		_buildSubscribeCommand(token) {
			const req = { channel: this.channel };
			if (token) req.token = token;
			if (this._data) req.data = this._data;
			if (this._sharedPoll) {
				req.type = 4;
				if (this._delta) req.delta = this._delta;
				return { subscribe: req };
			}
			if (this._positioned) req.positioned = true;
			if (this._recoverable) req.recoverable = true;
			if (this._joinLeave) req.join_leave = true;
			req.flag = subscriptionFlags.channelCompaction;
			if (this._getState) req.flag |= subscriptionFlags.rejectUnrecovered;
			if (this._needRecover()) {
				req.recover = true;
				const offset = this._getOffset();
				if (offset) req.offset = offset;
				const epoch = this._getEpoch();
				if (epoch) req.epoch = epoch;
			}
			if (this._delta) req.delta = this._delta;
			if (this._tagsFilter) req.tf = this._tagsFilter;
			return { subscribe: req };
		}
		_debug(...args) {
			this._centrifuge._debug(...args);
		}
		_handleSubscribeError(error) {
			if (!this._isSubscribing()) return;
			if (error.code === errorCodes.timeout) {
				this._centrifuge._disconnect(connectingCodes.subscribeTimeout, "subscribe timeout", true);
				return;
			}
			if (error.code === 112 && this._getState) {
				this._offset = null;
				this._epoch = null;
				this._recover = false;
				this._prevValueMap = new Map();
				this._scheduleResubscribe();
				return;
			}
			this._subscribeError(error);
		}
		_handleSubscribeResponse(result) {
			if (!this._isSubscribing()) return;
			this._setSubscribed(result);
			if (this._sharedPoll) this._sharedPollReplayTrack();
		}
		_setUnsubscribed(code, reason, sendUnsubscribe) {
			if (this._isUnsubscribed()) return Promise.resolve();
			let promise = Promise.resolve();
			if (this._isSubscribed()) {
				if (sendUnsubscribe) promise = this._centrifuge._unsubscribe(this);
				this._clearSubscribedState();
			} else if (this._isSubscribing()) {
				if (this._inflight && sendUnsubscribe) promise = this._centrifuge._unsubscribe(this);
				this._clearSubscribingState();
			}
			this._inflight = false;
			this._id = 0;
			this._sharedPollEpoch = "";
			this._sharedPollSignatures = [];
			this._sharedPollTrackedItems.clear();
			this._sharedPollSignatureRefreshInFlight = false;
			this._sharedPollSignatureRefreshTargetMs = null;
			this._cancelAllDebounce();
			if (this._setState(SubscriptionState.Unsubscribed)) this.emit("unsubscribed", {
				channel: this.channel,
				code,
				reason
			});
			this._rejectPromises({
				code: errorCodes.subscriptionUnsubscribed,
				message: this.state
			});
			return promise;
		}
		_handlePublication(pub) {
			if (this._delta && this._delta_negotiated) {
				const deltaKey = this._map || this._sharedPoll ? pub.key || "" : "";
				const { newData, newPrevValue, isDelta, wireBytes, fullBytes } = this._centrifuge._codec.applyDeltaIfNeeded(pub, this._prevValueMap.get(deltaKey));
				pub.data = newData;
				this._deltaNumPubs++;
				this._deltaBytesReceived += wireBytes;
				this._deltaBytesDecoded += fullBytes;
				if (isDelta) this._deltaNumDelta++;
				else this._deltaNumFull++;
				if (pub.removed) this._prevValueMap.delete(deltaKey);
				else this._prevValueMap.set(deltaKey, newPrevValue);
			}
			let ctx;
			if (this._sharedPoll) {
				if (pub.key && !this._sharedPollTrackedItems.has(pub.key)) return;
				if (pub.key) {
					if (pub.removed) this._sharedPollTrackedItems.delete(pub.key);
					else if (pub.version) this._sharedPollTrackedItems.set(pub.key, pub.version);
				}
				ctx = this._getSharedPollUpdateContext(pub);
			} else if (this._map) ctx = this._getMapUpdateContext(pub);
			else ctx = this._centrifuge._getPublicationContext(this.channel, pub);
			this.emit("publication", ctx);
			if (this._map || this._sharedPoll) this.emit("update", ctx);
			if (pub.offset) this._offset = pub.offset;
			if (pub.epoch) this._epoch = pub.epoch;
		}
		_seedDeltaTracking(pub) {
			if (!this._delta || !pub.key) return;
			if (typeof pub.data === "string") {
				const rawBytes = pub.data;
				const encoded = new TextEncoder().encode(rawBytes);
				if (!pub.removed) this._prevValueMap.set(pub.key, encoded);
				else this._prevValueMap.delete(pub.key);
				const byteLen = encoded.length;
				this._deltaNumPubs++;
				this._deltaNumFull++;
				this._deltaBytesReceived += byteLen;
				this._deltaBytesDecoded += byteLen;
				pub.data = JSON.parse(rawBytes);
			} else if (pub.data instanceof Uint8Array) {
				if (!pub.removed) this._prevValueMap.set(pub.key, pub.data);
				else this._prevValueMap.delete(pub.key);
				const byteLen = pub.data.length;
				this._deltaNumPubs++;
				this._deltaNumFull++;
				this._deltaBytesReceived += byteLen;
				this._deltaBytesDecoded += byteLen;
			}
		}
		_handleJoin(join) {
			const info = this._centrifuge._getJoinLeaveContext(join.info);
			this.emit("join", {
				channel: this.channel,
				info
			});
		}
		_handleLeave(leave) {
			const info = this._centrifuge._getJoinLeaveContext(leave.info);
			this.emit("leave", {
				channel: this.channel,
				info
			});
		}
		_resolvePromises() {
			for (const id in this._promises) {
				if (!this._promises.hasOwnProperty(id)) continue;
				if (this._promises[id].timeout) clearTimeout(this._promises[id].timeout);
				this._promises[id].resolve();
				delete this._promises[id];
			}
		}
		_rejectPromises(err) {
			for (const id in this._promises) {
				if (!this._promises.hasOwnProperty(id)) continue;
				if (this._promises[id].timeout) clearTimeout(this._promises[id].timeout);
				this._promises[id].reject(err);
				delete this._promises[id];
			}
		}
		_scheduleResubscribe() {
			if (!this._isSubscribing()) {
				this._debug("not in subscribing state, skip resubscribe scheduling", this.channel);
				return;
			}
			const self = this;
			const delay = this._getResubscribeDelay();
			this._resubscribeTimeout = setTimeout(function() {
				if (self._isSubscribing()) self._subscribe();
			}, delay);
			this._debug("resubscribe scheduled after " + delay, this.channel);
		}
		_subscribeError(err) {
			if (!this._isSubscribing()) return;
			if (err.code < 100 || err.code === 109 || err.temporary === true) {
				if (err.code === 109) this._token = "";
				const errContext = {
					channel: this.channel,
					type: "subscribe",
					error: err
				};
				if (this._centrifuge.state === State.Connected) this.emit("error", errContext);
				this._scheduleResubscribe();
			} else this._setUnsubscribed(err.code, err.message, false);
		}
		_getResubscribeDelay() {
			const delay = backoff(this._resubscribeAttempts, this._minResubscribeDelay, this._maxResubscribeDelay);
			this._resubscribeAttempts++;
			return delay;
		}
		_setOptions(options) {
			if (!options) return;
			if (options.since) {
				this._offset = options.since.offset || 0;
				this._epoch = options.since.epoch || "";
				this._recover = true;
			}
			if (options.data) this._data = options.data;
			if (options.getData) this._getData = options.getData;
			if (options.minResubscribeDelay !== void 0) this._minResubscribeDelay = options.minResubscribeDelay;
			if (options.maxResubscribeDelay !== void 0) this._maxResubscribeDelay = options.maxResubscribeDelay;
			if (options.token) this._token = options.token;
			if (options.getToken) this._getToken = options.getToken;
			if (options.positioned === true) this._positioned = true;
			if (options.recoverable === true) this._recoverable = true;
			if (options.joinLeave === true) this._joinLeave = true;
			if (options.delta) {
				if (options.delta !== "fossil") throw new Error("unsupported delta format");
				this._delta = options.delta;
			}
			if (options.tagsFilter) this._tagsFilter = options.tagsFilter;
			if (this._tagsFilter && this._delta) throw new Error("cannot use delta and tagsFilter together");
			if (options.getState) {
				this._getState = options.getState;
				this._recover = true;
			}
			if (options.map === true) this._map = true;
			if (options.mapPageSize !== void 0) this._mapPageSize = options.mapPageSize;
			if (options.mapPresenceType !== void 0) {
				this._mapPresenceType = options.mapPresenceType;
				this._map = true;
			}
			if (options.mapUnrecoverableStrategy) this._mapUnrecoverableStrategy = options.mapUnrecoverableStrategy;
			if (options.sharedPoll === true) this._sharedPoll = true;
			if (options.sharedPollGetSignature) this._sharedPollGetSignature = options.sharedPollGetSignature;
		}
		_getOffset() {
			const offset = this._offset;
			if (offset !== null) return offset;
			return 0;
		}
		_getEpoch() {
			const epoch = this._epoch;
			if (epoch !== null) return epoch;
			return "";
		}
		_clearRefreshTimeout() {
			if (this._refreshTimeout !== null) {
				clearTimeout(this._refreshTimeout);
				this._refreshTimeout = null;
			}
		}
		_clearResubscribeTimeout() {
			if (this._resubscribeTimeout !== null) {
				clearTimeout(this._resubscribeTimeout);
				this._resubscribeTimeout = null;
			}
		}
		_getSubscriptionToken() {
			this._debug("get subscription token for channel", this.channel);
			const ctx = { channel: this.channel };
			const getToken = this._getToken;
			if (getToken === null) {
				this.emit("error", {
					type: "configuration",
					channel: this.channel,
					error: {
						code: errorCodes.badConfiguration,
						message: "provide a function to get channel subscription token"
					}
				});
				return Promise.reject(new UnauthorizedError(""));
			}
			return getToken(ctx);
		}
		_refresh() {
			this._clearRefreshTimeout();
			const self = this;
			this._getSubscriptionToken().then(function(token) {
				if (!self._isSubscribed()) return;
				if (!token) {
					self._failUnauthorized();
					return;
				}
				self._token = token;
				const msg = { "sub_refresh": {
					channel: self.channel,
					token
				} };
				self._centrifuge._call(msg).then((resolveCtx) => {
					const result = resolveCtx.reply.sub_refresh;
					self._refreshResponse(result);
					if (resolveCtx.next) resolveCtx.next();
				}, (rejectCtx) => {
					self._refreshError(rejectCtx.error);
					if (rejectCtx.next) rejectCtx.next();
				});
			}).catch(function(e) {
				if (e instanceof UnauthorizedError) {
					self._failUnauthorized();
					return;
				}
				self.emit("error", {
					type: "refreshToken",
					channel: self.channel,
					error: {
						code: errorCodes.subscriptionRefreshToken,
						message: e !== void 0 ? e.toString() : ""
					}
				});
				self._refreshTimeout = setTimeout(() => self._refresh(), self._getRefreshRetryDelay());
			});
		}
		_refreshResponse(result) {
			if (!this._isSubscribed()) return;
			this._debug("subscription token refreshed, channel", this.channel);
			this._clearRefreshTimeout();
			if (result.expires === true) this._refreshTimeout = setTimeout(() => this._refresh(), ttlMilliseconds(result.ttl));
		}
		_refreshError(err) {
			if (!this._isSubscribed()) return;
			if (err.code < 100 || err.temporary === true) {
				this.emit("error", {
					type: "refresh",
					channel: this.channel,
					error: err
				});
				this._refreshTimeout = setTimeout(() => this._refresh(), this._getRefreshRetryDelay());
			} else this._setUnsubscribed(err.code, err.message, true);
		}
		_getRefreshRetryDelay() {
			return backoff(0, 1e4, 2e4);
		}
		_failUnauthorized() {
			this._setUnsubscribed(unsubscribedCodes.unauthorized, "unauthorized", true);
		}
		_sendTrackRequest(batches, untrackKeys) {
			if (batches.length === 0) return Promise.resolve();
			const maxBytes = 6e4;
			const frames = [];
			let current = [];
			let currentBytes = 100;
			if (untrackKeys && untrackKeys.length > 0) for (const key of untrackKeys) currentBytes += key.length + 4;
			for (const b of batches) {
				let cost = 100;
				for (const it of b.items) cost += it.key.length + 16;
				if (current.length > 0 && currentBytes + cost > maxBytes) {
					frames.push(current);
					current = [];
					currentBytes = 100;
				}
				current.push(b);
				currentBytes += cost;
			}
			if (current.length > 0) frames.push(current);
			const send = (frame, frameUntrackKeys) => new Promise((resolve, reject) => {
				const req = {
					channel: this.channel,
					type: 1,
					track: frame.map((b) => ({
						signature: b.signature,
						items: b.items.map((i) => i.version > 0 ? i : { key: i.key })
					}))
				};
				if (frameUntrackKeys && frameUntrackKeys.length > 0) req.untrack = frameUntrackKeys;
				const msg = { "sub_refresh": req };
				this._centrifuge._call(msg).then((resolveCtx) => {
					this._handleTrackResponse(resolveCtx.reply.sub_refresh);
					if (resolveCtx.next) resolveCtx.next();
					resolve();
				}, (rejectCtx) => {
					if (rejectCtx.next) rejectCtx.next();
					reject(rejectCtx.error);
				});
			});
			return frames.reduce((chain, frame, idx) => chain.then(() => send(frame, idx === 0 ? untrackKeys : void 0)), Promise.resolve());
		}
		_sendUntrackRequest(keys) {
			return new Promise((resolve, reject) => {
				const msg = { "sub_refresh": {
					channel: this.channel,
					type: 2,
					untrack: keys
				} };
				this._centrifuge._call(msg).then((resolveCtx) => {
					if (resolveCtx.next) resolveCtx.next();
					resolve();
				}, (rejectCtx) => {
					if (rejectCtx.next) rejectCtx.next();
					reject(rejectCtx.error);
				});
			});
		}
		_handleTrackResponse(result) {
			this._clearSharedPollTrackRetry();
			if (result && result.items && result.items.length > 0) for (const pub of result.items) this._handlePublication(pub);
			if (result && result.expires === true && result.ttl > 0) {
				const targetMs = Date.now() + result.ttl * 1e3;
				this._maybeScheduleSharedPollSignatureRefresh(targetMs);
			}
		}
		_maybeScheduleSharedPollSignatureRefresh(targetMs) {
			if (targetMs === null) {
				this._sharedPollSignatureRefreshTargetMs = null;
				this._clearSharedPollSignatureRefresh();
				return;
			}
			if (!this._isSubscribed()) return;
			if (this._sharedPollSignatureRefreshTargetMs !== null && targetMs >= this._sharedPollSignatureRefreshTargetMs) return;
			this._sharedPollSignatureRefreshTargetMs = targetMs;
			this._clearSharedPollSignatureRefresh();
			this._sharedPollSignatureRefreshTimeout = setTimeout(() => this._sharedPollRefreshSignature(), Math.max(0, targetMs - Date.now()));
		}
		_clearSharedPollSignatureRefresh() {
			if (this._sharedPollSignatureRefreshTimeout !== null) {
				clearTimeout(this._sharedPollSignatureRefreshTimeout);
				this._sharedPollSignatureRefreshTimeout = null;
			}
			this._sharedPollSignatureRefreshAttempts = 0;
		}
		_clearSharedPollTrackRetry() {
			if (this._sharedPollTrackRetryTimeout !== null) {
				clearTimeout(this._sharedPollTrackRetryTimeout);
				this._sharedPollTrackRetryTimeout = null;
			}
			this._sharedPollTrackRetryAttempts = 0;
		}
		_clearSharedPollReplayRetry() {
			if (this._sharedPollReplayRetryTimeout !== null) {
				clearTimeout(this._sharedPollReplayRetryTimeout);
				this._sharedPollReplayRetryTimeout = null;
			}
			this._sharedPollReplayRetryAttempts = 0;
		}
		_handleTrackError(err) {
			if (!this._isSubscribed()) return;
			this.emit("error", {
				type: "track",
				channel: this.channel,
				error: err
			});
			if (err.code === 109) {
				this._sharedPollRefreshSignature();
				return;
			}
			if (err.code < 100 || err.temporary === true) this._sharedPollTrackRetryTimeout = setTimeout(() => this._sharedPollReplayTrack(), backoff(this._sharedPollTrackRetryAttempts++, 1e3, 15e3));
		}
		_sharedPollRefreshSignature() {
			this._clearSharedPollSignatureRefresh();
			if (!this._isSubscribed()) return;
			if (!this._sharedPollGetSignature) return;
			if (this._sharedPollTrackedItems.size === 0) return;
			if (this._sharedPollSignatureRefreshInFlight) return;
			this._sharedPollSignatureRefreshTargetMs = null;
			this._sharedPollSignatureRefreshInFlight = true;
			const keys = Array.from(this._sharedPollTrackedItems.keys());
			const self = this;
			this._sharedPollGetSignature({ keys }).then((result) => {
				self._sharedPollSignatureRefreshInFlight = false;
				if (!self._isSubscribed()) return;
				self._sharedPollSignatureRefreshAttempts = 0;
				const returnedKeys = new Set(result.keys);
				const revokedKeys = [];
				for (const key of keys) if (!returnedKeys.has(key)) {
					self._sharedPollTrackedItems.delete(key);
					revokedKeys.push(key);
					self.emit("update", {
						channel: self.channel,
						key,
						data: null,
						removed: true
					});
				}
				if (revokedKeys.length > 0) self._sendUntrackRequest(revokedKeys).catch((err) => {
					self.emit("error", {
						type: "untrack",
						channel: self.channel,
						error: err
					});
				});
				const items = [];
				for (const key of result.keys) {
					const version = self._sharedPollTrackedItems.get(key);
					if (version !== void 0) items.push({
						key,
						version
					});
				}
				const consolidatedKeySet = new Set(result.keys);
				const uncovered = self._sharedPollSignatures.filter((entry) => entry.keys.some((k) => self._sharedPollTrackedItems.has(k) && !consolidatedKeySet.has(k)));
				self._sharedPollSignatures = items.length > 0 ? [{
					keys: result.keys,
					signature: result.signature
				}, ...uncovered] : uncovered;
				if (items.length === 0) return;
				self._sendTrackRequest([{
					items,
					signature: result.signature
				}]).catch((err) => {
					self._handleTrackError(err);
				});
			}).catch((e) => {
				self._sharedPollSignatureRefreshInFlight = false;
				self.emit("error", {
					type: "signatureRefresh",
					channel: self.channel,
					error: {
						code: errorCodes.sharedPollGetSignature,
						message: e !== void 0 ? e.toString() : ""
					}
				});
				self._sharedPollSignatureRefreshTimeout = setTimeout(() => self._sharedPollRefreshSignature(), backoff(self._sharedPollSignatureRefreshAttempts++, 5e3, 3e4));
			});
		}
		_sharedPollReplayTrack() {
			if (!this._isSubscribed()) return;
			if (this._sharedPollTrackedItems.size === 0 && this._sharedPollSignatures.length === 0) return;
			const coveredKeys = new Set();
			const replayBatches = [];
			const allUntrackedInReplay = [];
			for (const entry of this._sharedPollSignatures) {
				const items = entry.keys.map((key) => {
					var _a;
					return {
						key,
						version: (_a = this._sharedPollTrackedItems.get(key)) !== null && _a !== void 0 ? _a : 0
					};
				});
				replayBatches.push({
					items,
					signature: entry.signature
				});
				for (const k of entry.keys) if (this._sharedPollTrackedItems.has(k)) coveredKeys.add(k);
				else allUntrackedInReplay.push(k);
			}
			if (replayBatches.length > 0) this._sendTrackRequest(replayBatches, allUntrackedInReplay).catch((err) => {
				this._handleTrackError(err);
			});
			const uncoveredKeys = [];
			for (const key of this._sharedPollTrackedItems.keys()) if (!coveredKeys.has(key)) uncoveredKeys.push(key);
			if (uncoveredKeys.length === 0) return;
			if (!this._sharedPollGetSignature) {
				this.emit("error", {
					type: "track",
					channel: this.channel,
					error: {
						code: errorCodes.sharedPollGetSignature,
						message: "getSignature callback required for tracked keys without an explicit signature"
					}
				});
				return;
			}
			const self = this;
			this._sharedPollGetSignature({ keys: uncoveredKeys }).then((result) => {
				if (!self._isSubscribed()) return;
				self._clearSharedPollReplayRetry();
				const returnedKeys = new Set(result.keys);
				const revokedKeys = [];
				for (const key of uncoveredKeys) if (!returnedKeys.has(key)) {
					self._sharedPollTrackedItems.delete(key);
					revokedKeys.push(key);
					self.emit("update", {
						channel: self.channel,
						key,
						data: null,
						removed: true
					});
				}
				if (revokedKeys.length > 0) self._sendUntrackRequest(revokedKeys).catch((err) => {
					self.emit("error", {
						type: "untrack",
						channel: self.channel,
						error: err
					});
				});
				const items = [];
				for (const key of result.keys) {
					const version = self._sharedPollTrackedItems.get(key);
					if (version !== void 0) items.push({
						key,
						version
					});
				}
				if (items.length === 0) return;
				self._sharedPollSignatures.push({
					keys: result.keys,
					signature: result.signature
				});
				self._sendTrackRequest([{
					items,
					signature: result.signature
				}]).catch((err) => {
					self._handleTrackError(err);
				});
			}).catch((e) => {
				self.emit("error", {
					type: "signatureRefresh",
					channel: self.channel,
					error: {
						code: errorCodes.sharedPollGetSignature,
						message: e !== void 0 ? e.toString() : ""
					}
				});
				self._sharedPollReplayRetryTimeout = setTimeout(() => self._sharedPollReplayTrack(), backoff(self._sharedPollReplayRetryAttempts++, 5e3, 3e4));
			});
		}
		_mapSubscribe() {
			this._debug("starting map subscribe on", this.channel);
			this._mapStateBuffer = [];
			this._mapStreamBuffer = [];
			this._mapCursor = "";
			if (!(this._recover && this._offset !== null && this._epoch !== null)) this._prevValueMap = new Map();
			this._mapPhase = MapPhase.State;
			if (this._recover && this._offset !== null && this._epoch !== null) {
				this._debug("map subscribe: recovering from position, skipping to stream phase");
				this._mapPhase = MapPhase.Stream;
				this._fetchStream();
				return;
			}
			if (this._canSubscribeWithoutGettingToken()) this._fetchSnapshot();
			else this._getSubscriptionToken().then((token) => {
				if (!this._isSubscribing()) {
					this._inflight = false;
					return;
				}
				if (!token) {
					this._inflight = false;
					this._failUnauthorized();
					return;
				}
				this._token = token;
				this._fetchSnapshot();
			}).catch((e) => this._handleTokenError(e));
		}
		_fetchSnapshot(cursor) {
			if (!this._isSubscribing() || !this._isTransportOpen()) {
				this._inflight = false;
				return;
			}
			const cmd = this._buildMapSubscribeCommand(MapPhase.State, cursor);
			this._debug("map subscribe: fetching snapshot page", cursor ? `cursor=${cursor}` : "initial");
			this._centrifuge._call(cmd).then((resolveCtx) => {
				const result = resolveCtx.reply.subscribe;
				this._handleMapStateResponse(result);
				if (resolveCtx.next) resolveCtx.next();
			}, (rejectCtx) => {
				this._handleMapSubscribeError(rejectCtx.error);
				if (rejectCtx.next) rejectCtx.next();
			});
		}
		_handleMapStateResponse(result) {
			if (!this._isSubscribing()) {
				this._inflight = false;
				return;
			}
			if (!result.phase) {
				this._debug("map subscribe: server forced LIVE transition during state pagination");
				this._handleMapLiveResponse(result);
				return;
			}
			if (!this._epoch && result.epoch) {
				this._epoch = result.epoch;
				this._offset = result.offset || 0;
			}
			if (this._epoch && result.epoch && this._epoch !== result.epoch) {
				this._debug("map subscribe: epoch changed during snapshot pagination, restarting");
				this._mapStateBuffer = [];
				this._mapCursor = "";
				this._epoch = null;
				this._offset = null;
				this._prevValueMap = new Map();
				this._fetchSnapshot();
				return;
			}
			if (result.state && result.state.length > 0) for (const pub of result.state) {
				this._seedDeltaTracking(pub);
				this._mapStateBuffer.push(this._getMapUpdateContext(pub));
			}
			if (result.cursor) {
				this._mapCursor = result.cursor;
				this._fetchSnapshot(this._mapCursor);
				return;
			}
			this._transitionFromSnapshot();
		}
		_transitionFromSnapshot() {
			this._debug("map subscribe: snapshot complete, transitioning to stream phase");
			this._mapPhase = MapPhase.Stream;
			this._fetchStream();
		}
		_fetchStream() {
			if (!this._isSubscribing() || !this._isTransportOpen()) {
				this._inflight = false;
				return;
			}
			const cmd = this._buildMapSubscribeCommand(MapPhase.Stream);
			this._debug("map subscribe: fetching stream from offset", this._offset);
			this._centrifuge._call(cmd).then((resolveCtx) => {
				const result = resolveCtx.reply.subscribe;
				this._handleMapStreamResponse(result);
				if (resolveCtx.next) resolveCtx.next();
			}, (rejectCtx) => {
				this._handleMapSubscribeError(rejectCtx.error);
				if (rejectCtx.next) rejectCtx.next();
			});
		}
		_handleMapStreamResponse(result) {
			if (!this._isSubscribing()) {
				this._inflight = false;
				return;
			}
			if (!result.phase) {
				this._debug("map subscribe: server forced LIVE transition during stream");
				this._handleMapLiveResponse(result);
				return;
			}
			if (this._epoch && result.epoch && this._epoch !== result.epoch) {
				this._debug("map subscribe: epoch changed during stream, restarting");
				this._mapStateBuffer = [];
				this._mapStreamBuffer = [];
				this._epoch = null;
				this._offset = null;
				this._prevValueMap = new Map();
				this._mapPhase = MapPhase.State;
				this._fetchSnapshot();
				return;
			}
			if (result.publications && result.publications.length > 0) for (const pub of result.publications) {
				this._seedDeltaTracking(pub);
				this._mapStreamBuffer.push(this._getMapUpdateContext(pub));
			}
			if (result.offset !== void 0) this._offset = result.offset;
			this._fetchStream();
		}
		_handleMapLiveResponse(result) {
			if (!this._isSubscribing()) {
				this._inflight = false;
				return;
			}
			this._inflight = false;
			if (this._epoch && result.epoch && this._epoch !== result.epoch) {
				this._debug("map subscribe: epoch changed during live transition, restarting");
				this._mapStateBuffer = [];
				this._mapStreamBuffer = [];
				this._epoch = null;
				this._offset = null;
				this._prevValueMap = new Map();
				this._inflight = true;
				this._mapPhase = MapPhase.State;
				this._fetchSnapshot();
				return;
			}
			if (result.state && result.state.length > 0) for (const pub of result.state) {
				this._seedDeltaTracking(pub);
				this._mapStateBuffer.push(this._getMapUpdateContext(pub));
			}
			if (result.publications && result.publications.length > 0) for (const pub of result.publications) {
				if (this._delta && result.delta) {
					const deltaKey = pub.key || "";
					const { newData, newPrevValue, isDelta, wireBytes, fullBytes } = this._centrifuge._codec.applyDeltaIfNeeded(pub, this._prevValueMap.get(deltaKey));
					pub.data = newData;
					this._deltaNumPubs++;
					this._deltaBytesReceived += wireBytes;
					this._deltaBytesDecoded += fullBytes;
					if (isDelta) this._deltaNumDelta++;
					else this._deltaNumFull++;
					if (pub.removed) this._prevValueMap.delete(deltaKey);
					else this._prevValueMap.set(deltaKey, newPrevValue);
				} else if (this._delta && pub.key) {
					if (pub.removed) this._prevValueMap.delete(pub.key);
					else this._prevValueMap.set(pub.key, pub.data);
				}
				this._mapStreamBuffer.push(this._getMapUpdateContext(pub));
			}
			this._offset = result.offset || 0;
			this._epoch = result.epoch || "";
			this._clearSubscribingState();
			if (result.id) this._id = result.id;
			this._recover = result.recoverable === true;
			if (result.delta) this._delta_negotiated = true;
			else this._delta_negotiated = false;
			if (result.publish_debounce) this._debounceMs = result.publish_debounce;
			this._setState(SubscriptionState.Subscribed);
			const ctx = this._centrifuge._getSubscribeContext(this.channel, result);
			ctx.state = this._mapStateBuffer;
			this.emit("subscribed", ctx);
			this._resolvePromises();
			if (!ctx.recovered) {
				if (this._mapStreamBuffer.length > 0) {
					const stateMap = new Map();
					for (const entry of this._mapStateBuffer) stateMap.set(entry.key, entry);
					for (const entry of this._mapStreamBuffer) if (entry.removed) stateMap.delete(entry.key);
					else stateMap.set(entry.key, entry);
					this._mapStateBuffer = Array.from(stateMap.values());
					this._mapStreamBuffer = [];
				}
				this.emit("sync", { entries: this._mapStateBuffer });
			}
			for (const pub of this._mapStreamBuffer) {
				this.emit("publication", pub);
				this.emit("update", pub);
			}
			this._mapStateBuffer = [];
			this._mapStreamBuffer = [];
			this._mapPhase = null;
			if (result.expires === true) this._refreshTimeout = setTimeout(() => this._refresh(), ttlMilliseconds(result.ttl));
		}
		_handleMapSubscribeError(error) {
			this._inflight = false;
			if (!this._isSubscribing()) return;
			if (error.code === errorCodes.timeout) {
				this._centrifuge._disconnect(connectingCodes.subscribeTimeout, "subscribe timeout", true);
				return;
			}
			this._mapStateBuffer = [];
			this._mapStreamBuffer = [];
			this._mapPhase = null;
			this._prevValueMap = new Map();
			if (error.code === 112) {
				if (this._mapUnrecoverableStrategy === "from_scratch") {
					this._debug("map subscribe: unrecoverable position, restarting from scratch");
					this._offset = null;
					this._epoch = null;
					this._recover = false;
					this._scheduleResubscribe();
					return;
				}
			}
			this._subscribeError(error);
		}
		_buildMapSubscribeCommand(phase, cursor) {
			const req = {
				channel: this.channel,
				type: this._mapPresenceType || 1,
				phase
			};
			if (this._token) req.token = this._token;
			if (this._tagsFilter) req.tf = this._tagsFilter;
			if (this._delta) req.delta = this._delta;
			req.flag = subscriptionFlags.channelCompaction;
			if (phase === MapPhase.State) {
				if (this._mapPageSize > 0) req.limit = this._mapPageSize;
				if (cursor) req.cursor = cursor;
				if (this._epoch) {
					req.offset = this._offset;
					req.epoch = this._epoch;
				} else if (this._data) req.data = this._data;
			}
			if (phase === MapPhase.Stream) {
				if (this._mapPageSize > 0) req.limit = this._mapPageSize;
				req.offset = this._offset;
				req.epoch = this._epoch;
				if (this._recover) {
					req.recover = true;
					if (this._mapStreamBuffer.length === 0) {
						if (this._data) req.data = this._data;
					}
				}
			}
			return { subscribe: req };
		}
		_getMapUpdateContext(pub) {
			const ctx = {
				channel: this.channel,
				data: pub.data,
				key: pub.key || ""
			};
			if (pub.removed === true) ctx.removed = true;
			if (pub.offset !== void 0) ctx.offset = pub.offset;
			if (pub.info) ctx.info = this._centrifuge._getJoinLeaveContext(pub.info);
			if (pub.tags) ctx.tags = pub.tags;
			return ctx;
		}
		_getSharedPollUpdateContext(pub) {
			const ctx = {
				channel: this.channel,
				key: pub.key || "",
				data: pub.data
			};
			if (pub.removed === true) ctx.removed = true;
			if (pub.version !== void 0) ctx.version = pub.version;
			return ctx;
		}
	};
	var Subscription = class extends BaseSubscription {
		publish(data) {
			return __awaiter(this, void 0, void 0, function* () {
				yield this._methodCall();
				if (this._debounceMs > 0) return this._debouncedPublish("", data, false);
				return this._centrifuge.publish(this.channel, data);
			});
		}
		history(opts) {
			return __awaiter(this, void 0, void 0, function* () {
				yield this._methodCall();
				return this._centrifuge.history(this.channel, opts);
			});
		}
	};
	var MapSubscription = class extends BaseSubscription {
		publish(key, data) {
			return __awaiter(this, void 0, void 0, function* () {
				yield this._methodCall();
				if (this._debounceMs > 0) return this._debouncedPublish(key, data, true);
				return this._centrifuge.mapPublish(this.channel, key, data);
			});
		}
		remove(key) {
			return __awaiter(this, void 0, void 0, function* () {
				yield this._methodCall();
				this._cancelDebounce(key);
				return this._centrifuge.mapRemove(this.channel, key);
			});
		}
	};
	var SharedPollSubscription = class extends BaseSubscription {
		track(keysOrItems, signature) {
			if (keysOrItems.length === 0) return;
			let items;
			const sig = signature;
			if (typeof keysOrItems[0] === "string") items = keysOrItems.map((k) => ({
				key: k,
				version: 0
			}));
			else items = keysOrItems;
			for (const item of items) {
				const existing = this._sharedPollTrackedItems.get(item.key);
				if (existing === void 0 || item.version > existing) this._sharedPollTrackedItems.set(item.key, item.version);
			}
			if (sig !== void 0) {
				this._sharedPollSignatures.push({
					keys: items.map((i) => i.key),
					signature: sig
				});
				if (this._isSubscribed()) this._sendTrackRequest([{
					items,
					signature: sig
				}]).catch((err) => {
					this._handleTrackError(err);
				});
				return;
			}
			if (!this._sharedPollGetSignature) {
				this.emit("error", {
					type: "track",
					channel: this.channel,
					error: {
						code: errorCodes.sharedPollGetSignature,
						message: "getSignature callback required for track(keys)"
					}
				});
				return;
			}
			if (!this._isSubscribed()) return;
			const keys = items.map((i) => i.key);
			this._sharedPollGetSignature({ keys }).then((result) => {
				if (!this._isSubscribed()) return;
				const returnedKeys = new Set(result.keys);
				const revokedKeys = [];
				for (const key of keys) if (!returnedKeys.has(key)) {
					this._sharedPollTrackedItems.delete(key);
					revokedKeys.push(key);
					this.emit("update", {
						channel: this.channel,
						key,
						data: null,
						removed: true
					});
				}
				if (revokedKeys.length > 0) this._sendUntrackRequest(revokedKeys).catch((err) => {
					this.emit("error", {
						type: "untrack",
						channel: this.channel,
						error: err
					});
				});
				const authorizedItems = [];
				for (const key of result.keys) {
					const version = this._sharedPollTrackedItems.get(key);
					if (version !== void 0) authorizedItems.push({
						key,
						version
					});
				}
				if (authorizedItems.length === 0) return;
				this._sharedPollSignatures.push({
					keys: result.keys,
					signature: result.signature
				});
				this._sendTrackRequest([{
					items: authorizedItems,
					signature: result.signature
				}]).catch((err) => {
					this._handleTrackError(err);
				});
			}).catch((e) => {
				this.emit("error", {
					type: "track",
					channel: this.channel,
					error: {
						code: errorCodes.sharedPollGetSignature,
						message: e !== void 0 ? e.toString() : "getSignature failed"
					}
				});
			});
		}
		untrack(keys) {
			for (const key of keys) this._sharedPollTrackedItems.delete(key);
			this._sharedPollSignatures = this._sharedPollSignatures.filter((entry) => entry.keys.some((k) => this._sharedPollTrackedItems.has(k)));
			if (this._isSubscribed()) this._sendUntrackRequest(keys).catch((err) => {
				this.emit("error", {
					type: "untrack",
					channel: this.channel,
					error: err
				});
			});
		}
		trackedKeys() {
			return new Set(this._sharedPollTrackedItems.keys());
		}
	};
	var SockjsTransport = class {
		constructor(endpoint, options) {
			this.endpoint = endpoint;
			this.options = options;
			this._transport = null;
		}
		name() {
			return "sockjs";
		}
		subName() {
			return "sockjs-" + this._transport.transport;
		}
		emulation() {
			return false;
		}
		supported() {
			return this.options.sockjs !== null;
		}
		initialize(_protocol, callbacks) {
			this._transport = new this.options.sockjs(this.endpoint, null, this.options.sockjsOptions);
			this._transport.onopen = () => {
				callbacks.onOpen();
			};
			this._transport.onerror = (e) => {
				callbacks.onError(e);
			};
			this._transport.onclose = (closeEvent) => {
				callbacks.onClose(closeEvent);
			};
			this._transport.onmessage = (event) => {
				callbacks.onMessage(event.data);
			};
		}
		close() {
			this._transport.close();
		}
		send(data) {
			this._transport.send(data);
		}
	};
	var WebsocketTransport = class {
		constructor(endpoint, options) {
			this.endpoint = endpoint;
			this.options = options;
			this._transport = null;
		}
		name() {
			return "websocket";
		}
		subName() {
			return "websocket";
		}
		emulation() {
			return false;
		}
		supported() {
			return this.options.websocket !== void 0 && this.options.websocket !== null;
		}
		initialize(protocol, callbacks) {
			let subProtocol = "";
			if (protocol === "protobuf") subProtocol = "centrifuge-protobuf";
			if (subProtocol !== "") this._transport = new this.options.websocket(this.endpoint, subProtocol);
			else this._transport = new this.options.websocket(this.endpoint);
			if (protocol === "protobuf") this._transport.binaryType = "arraybuffer";
			this._transport.onopen = () => {
				callbacks.onOpen();
			};
			this._transport.onerror = (e) => {
				callbacks.onError(e);
			};
			this._transport.onclose = (closeEvent) => {
				callbacks.onClose(closeEvent);
			};
			this._transport.onmessage = (event) => {
				callbacks.onMessage(event.data);
			};
		}
		close() {
			this._transport.close();
		}
		send(data) {
			this._transport.send(data);
		}
	};
	var HttpStreamTransport = class {
		constructor(endpoint, options) {
			this.endpoint = endpoint;
			this.options = options;
			this._abortController = null;
			this._utf8decoder = new TextDecoder();
			this._protocol = "json";
		}
		name() {
			return "http_stream";
		}
		subName() {
			return "http_stream";
		}
		emulation() {
			return true;
		}
		_handleErrors(response) {
			if (!response.ok) throw new Error(response.status);
			return response;
		}
		_fetchEventTarget(self, endpoint, options) {
			const eventTarget = new EventTarget();
			const fetchFunc = self.options.fetch;
			fetchFunc(endpoint, options).then(self._handleErrors).then((response) => {
				eventTarget.dispatchEvent(new Event("open"));
				let jsonStreamBuf = "";
				let jsonStreamPos = 0;
				let protoStreamBuf = new Uint8Array();
				const reader = response.body.getReader();
				return new self.options.readableStream({ start(controller) {
					function pump() {
						return reader.read().then(({ done, value }) => {
							if (done) {
								eventTarget.dispatchEvent(new Event("close"));
								controller.close();
								return;
							}
							try {
								if (self._protocol === "json") {
									jsonStreamBuf += self._utf8decoder.decode(value, { stream: true });
									while (jsonStreamPos < jsonStreamBuf.length) if (jsonStreamBuf[jsonStreamPos] === "\n") {
										const line = jsonStreamBuf.substring(0, jsonStreamPos);
										eventTarget.dispatchEvent(new MessageEvent("message", { data: line }));
										jsonStreamBuf = jsonStreamBuf.substring(jsonStreamPos + 1);
										jsonStreamPos = 0;
									} else ++jsonStreamPos;
								} else {
									const mergedArray = new Uint8Array(protoStreamBuf.length + value.length);
									mergedArray.set(protoStreamBuf);
									mergedArray.set(value, protoStreamBuf.length);
									protoStreamBuf = mergedArray;
									while (true) {
										const result = self.options.decoder.decodeReply(protoStreamBuf);
										if (result.ok) {
											const data = protoStreamBuf.slice(0, result.pos);
											eventTarget.dispatchEvent(new MessageEvent("message", { data }));
											protoStreamBuf = protoStreamBuf.slice(result.pos);
											continue;
										}
										break;
									}
								}
							} catch (error) {
								eventTarget.dispatchEvent(new Event("error", { detail: error }));
								eventTarget.dispatchEvent(new Event("close"));
								controller.close();
								return;
							}
							pump();
						}).catch(function(e) {
							eventTarget.dispatchEvent(new Event("error", { detail: e }));
							eventTarget.dispatchEvent(new Event("close"));
							controller.close();
						});
					}
					return pump();
				} });
			}).catch((error) => {
				eventTarget.dispatchEvent(new Event("error", { detail: error }));
				eventTarget.dispatchEvent(new Event("close"));
			});
			return eventTarget;
		}
		supported() {
			return this.options.fetch !== null && this.options.readableStream !== null && typeof TextDecoder !== "undefined" && typeof AbortController !== "undefined" && typeof EventTarget !== "undefined" && typeof Event !== "undefined" && typeof MessageEvent !== "undefined" && typeof Error !== "undefined";
		}
		initialize(protocol, callbacks, initialData) {
			this._protocol = protocol;
			this._abortController = new AbortController();
			let headers;
			let body;
			if (protocol === "json") {
				headers = {
					"Accept": "application/json",
					"Content-Type": "application/json"
				};
				body = initialData;
			} else {
				headers = {
					"Accept": "application/octet-stream",
					"Content-Type": "application/octet-stream"
				};
				body = initialData;
			}
			const fetchOptions = {
				method: "POST",
				headers,
				body,
				mode: "cors",
				credentials: "same-origin",
				signal: this._abortController.signal
			};
			const eventTarget = this._fetchEventTarget(this, this.endpoint, fetchOptions);
			eventTarget.addEventListener("open", () => {
				callbacks.onOpen();
			});
			eventTarget.addEventListener("error", (e) => {
				this._abortController.abort();
				callbacks.onError(e);
			});
			eventTarget.addEventListener("close", () => {
				this._abortController.abort();
				callbacks.onClose({
					code: 4,
					reason: "connection closed"
				});
			});
			eventTarget.addEventListener("message", (e) => {
				callbacks.onMessage(e.data);
			});
		}
		close() {
			this._abortController.abort();
		}
		send(data, session, node) {
			let headers;
			let body;
			const req = {
				session,
				node,
				data
			};
			if (this._protocol === "json") {
				headers = { "Content-Type": "application/json" };
				body = JSON.stringify(req);
			} else {
				headers = { "Content-Type": "application/octet-stream" };
				body = this.options.encoder.encodeEmulationRequest(req);
			}
			const fetchFunc = this.options.fetch;
			const fetchOptions = {
				method: "POST",
				headers,
				body,
				mode: "cors",
				credentials: "same-origin"
			};
			fetchFunc(this.options.emulationEndpoint, fetchOptions);
		}
	};
	var SseTransport = class {
		constructor(endpoint, options) {
			this.endpoint = endpoint;
			this.options = options;
			this._protocol = "json";
			this._transport = null;
			this._onClose = null;
		}
		name() {
			return "sse";
		}
		subName() {
			return "sse";
		}
		emulation() {
			return true;
		}
		supported() {
			return this.options.eventsource !== null && this.options.fetch !== null;
		}
		initialize(_protocol, callbacks, initialData) {
			let url;
			if (globalThis && globalThis.document && globalThis.document.baseURI) url = new URL(this.endpoint, globalThis.document.baseURI);
			else url = new URL(this.endpoint);
			url.searchParams.append("cf_connect", initialData);
			const eventSource = new this.options.eventsource(url.toString(), {});
			this._transport = eventSource;
			const self = this;
			eventSource.onopen = function() {
				callbacks.onOpen();
			};
			eventSource.onerror = function(e) {
				eventSource.close();
				callbacks.onError(e);
				callbacks.onClose({
					code: 4,
					reason: "connection closed"
				});
			};
			eventSource.onmessage = function(e) {
				callbacks.onMessage(e.data);
			};
			self._onClose = function() {
				callbacks.onClose({
					code: 4,
					reason: "connection closed"
				});
			};
		}
		close() {
			this._transport.close();
			if (this._onClose !== null) this._onClose();
		}
		send(data, session, node) {
			const req = {
				session,
				node,
				data
			};
			const headers = { "Content-Type": "application/json" };
			const body = JSON.stringify(req);
			const fetchFunc = this.options.fetch;
			const fetchOptions = {
				method: "POST",
				headers,
				body,
				mode: "cors",
				credentials: "same-origin"
			};
			fetchFunc(this.options.emulationEndpoint, fetchOptions);
		}
	};
	var WebtransportTransport = class {
		constructor(endpoint, options) {
			this.endpoint = endpoint;
			this.options = options;
			this._transport = null;
			this._stream = null;
			this._writer = null;
			this._utf8decoder = new TextDecoder();
			this._protocol = "json";
		}
		name() {
			return "webtransport";
		}
		subName() {
			return "webtransport";
		}
		emulation() {
			return false;
		}
		supported() {
			return this.options.webtransport !== void 0 && this.options.webtransport !== null;
		}
		initialize(protocol, callbacks) {
			return __awaiter(this, void 0, void 0, function* () {
				let url;
				if (globalThis && globalThis.document && globalThis.document.baseURI) url = new URL(this.endpoint, globalThis.document.baseURI);
				else url = new URL(this.endpoint);
				if (protocol === "protobuf") url.searchParams.append("cf_protocol", "protobuf");
				this._protocol = protocol;
				const eventTarget = new EventTarget();
				this._transport = new this.options.webtransport(url.toString());
				this._transport.closed.then(() => {
					callbacks.onClose({
						code: 4,
						reason: "connection closed"
					});
				}).catch(() => {
					callbacks.onClose({
						code: 4,
						reason: "connection closed"
					});
				});
				try {
					yield this._transport.ready;
				} catch (_a) {
					this.close();
					return;
				}
				let stream;
				try {
					stream = yield this._transport.createBidirectionalStream();
				} catch (_b) {
					this.close();
					return;
				}
				this._stream = stream;
				this._writer = this._stream.writable.getWriter();
				eventTarget.addEventListener("close", () => {
					callbacks.onClose({
						code: 4,
						reason: "connection closed"
					});
				});
				eventTarget.addEventListener("message", (e) => {
					callbacks.onMessage(e.data);
				});
				this._startReading(eventTarget);
				callbacks.onOpen();
			});
		}
		_startReading(eventTarget) {
			return __awaiter(this, void 0, void 0, function* () {
				const reader = this._stream.readable.getReader();
				let jsonStreamBuf = "";
				let jsonStreamPos = 0;
				let protoStreamBuf = new Uint8Array();
				try {
					while (true) {
						const { done, value } = yield reader.read();
						if (value && value.length > 0) {
							if (this._protocol === "json") {
								jsonStreamBuf += this._utf8decoder.decode(value, { stream: true });
								while (jsonStreamPos < jsonStreamBuf.length) if (jsonStreamBuf[jsonStreamPos] === "\n") {
									const line = jsonStreamBuf.substring(0, jsonStreamPos);
									eventTarget.dispatchEvent(new MessageEvent("message", { data: line }));
									jsonStreamBuf = jsonStreamBuf.substring(jsonStreamPos + 1);
									jsonStreamPos = 0;
								} else ++jsonStreamPos;
							} else {
								const mergedArray = new Uint8Array(protoStreamBuf.length + value.length);
								mergedArray.set(protoStreamBuf);
								mergedArray.set(value, protoStreamBuf.length);
								protoStreamBuf = mergedArray;
								while (true) {
									const result = this.options.decoder.decodeReply(protoStreamBuf);
									if (result.ok) {
										const data = protoStreamBuf.slice(0, result.pos);
										eventTarget.dispatchEvent(new MessageEvent("message", { data }));
										protoStreamBuf = protoStreamBuf.slice(result.pos);
										continue;
									}
									break;
								}
							}
						}
						if (done) break;
					}
				} catch (_a) {
					eventTarget.dispatchEvent(new Event("close"));
				}
			});
		}
		close() {
			return __awaiter(this, void 0, void 0, function* () {
				try {
					if (this._writer) yield this._writer.close();
					this._transport.close();
				} catch (e) {}
			});
		}
		send(data) {
			return __awaiter(this, void 0, void 0, function* () {
				let binary;
				if (this._protocol === "json") binary = new TextEncoder().encode(data + "\n");
				else binary = data;
				try {
					yield this._writer.write(binary);
				} catch (e) {
					this.close();
				}
			});
		}
	};
	var zValue = [
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		0,
		1,
		2,
		3,
		4,
		5,
		6,
		7,
		8,
		9,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		-1,
		10,
		11,
		12,
		13,
		14,
		15,
		16,
		17,
		18,
		19,
		20,
		21,
		22,
		23,
		24,
		25,
		26,
		27,
		28,
		29,
		30,
		31,
		32,
		33,
		34,
		35,
		-1,
		-1,
		-1,
		-1,
		36,
		-1,
		37,
		38,
		39,
		40,
		41,
		42,
		43,
		44,
		45,
		46,
		47,
		48,
		49,
		50,
		51,
		52,
		53,
		54,
		55,
		56,
		57,
		58,
		59,
		60,
		61,
		62,
		-1,
		-1,
		-1,
		63,
		-1
	];
	var Reader = class {
		constructor(array) {
			this.a = array;
			this.pos = 0;
		}
		haveBytes() {
			return this.pos < this.a.length;
		}
		getByte() {
			const b = this.a[this.pos];
			this.pos++;
			if (this.pos > this.a.length) throw new RangeError("out of bounds");
			return b;
		}
		getChar() {
			return String.fromCharCode(this.getByte());
		}
		getInt() {
			let v = 0;
			let c;
			while (this.haveBytes() && (c = zValue[127 & this.getByte()]) >= 0) v = (v << 6) + c;
			this.pos--;
			return v >>> 0;
		}
	};
	var Writer = class {
		constructor() {
			this.a = [];
		}
		toByteArray(sourceType) {
			if (Array.isArray(sourceType)) return this.a;
			return new Uint8Array(this.a);
		}
		putArray(a, start, end) {
			for (let i = start; i < end; i++) this.a.push(a[i]);
		}
	};
	function checksum(arr) {
		let sum0 = 0, sum1 = 0, sum2 = 0, sum3 = 0, z = 0, N = arr.length;
		while (N >= 16) {
			sum0 = sum0 + arr[z + 0] | 0;
			sum1 = sum1 + arr[z + 1] | 0;
			sum2 = sum2 + arr[z + 2] | 0;
			sum3 = sum3 + arr[z + 3] | 0;
			sum0 = sum0 + arr[z + 4] | 0;
			sum1 = sum1 + arr[z + 5] | 0;
			sum2 = sum2 + arr[z + 6] | 0;
			sum3 = sum3 + arr[z + 7] | 0;
			sum0 = sum0 + arr[z + 8] | 0;
			sum1 = sum1 + arr[z + 9] | 0;
			sum2 = sum2 + arr[z + 10] | 0;
			sum3 = sum3 + arr[z + 11] | 0;
			sum0 = sum0 + arr[z + 12] | 0;
			sum1 = sum1 + arr[z + 13] | 0;
			sum2 = sum2 + arr[z + 14] | 0;
			sum3 = sum3 + arr[z + 15] | 0;
			z += 16;
			N -= 16;
		}
		while (N >= 4) {
			sum0 = sum0 + arr[z + 0] | 0;
			sum1 = sum1 + arr[z + 1] | 0;
			sum2 = sum2 + arr[z + 2] | 0;
			sum3 = sum3 + arr[z + 3] | 0;
			z += 4;
			N -= 4;
		}
		sum3 = ((sum3 + (sum2 << 8) | 0) + (sum1 << 16) | 0) + (sum0 << 24) | 0;
		switch (N) {
			case 3: sum3 = sum3 + (arr[z + 2] << 8) | 0;
			case 2: sum3 = sum3 + (arr[z + 1] << 16) | 0;
			case 1: sum3 = sum3 + (arr[z + 0] << 24) | 0;
		}
		return sum3 >>> 0;
	}
	function applyDelta(source, delta) {
		let total = 0;
		const zDelta = new Reader(delta);
		const lenSrc = source.length;
		const lenDelta = delta.length;
		const limit = zDelta.getInt();
		if (zDelta.getChar() !== "\n") throw new Error("size integer not terminated by '\\n'");
		const zOut = new Writer();
		while (zDelta.haveBytes()) {
			const cnt = zDelta.getInt();
			let ofst;
			switch (zDelta.getChar()) {
				case "@":
					ofst = zDelta.getInt();
					if (zDelta.haveBytes() && zDelta.getChar() !== ",") throw new Error("copy command not terminated by ','");
					total += cnt;
					if (total > limit) throw new Error("copy exceeds output file size");
					if (ofst + cnt > lenSrc) throw new Error("copy extends past end of input");
					zOut.putArray(source, ofst, ofst + cnt);
					break;
				case ":":
					total += cnt;
					if (total > limit) throw new Error("insert command gives an output larger than predicted");
					if (cnt > lenDelta) throw new Error("insert count exceeds size of delta");
					zOut.putArray(zDelta.a, zDelta.pos, zDelta.pos + cnt);
					zDelta.pos += cnt;
					break;
				case ";": {
					const out = zOut.toByteArray(source);
					if (cnt !== checksum(out)) throw new Error("bad checksum");
					if (total !== limit) throw new Error("generated size does not match predicted size");
					return out;
				}
				default: throw new Error("unknown delta operator");
			}
		}
		throw new Error("unterminated delta");
	}
	var JsonCodec = class {
		name() {
			return "json";
		}
		encodeCommands(commands) {
			return commands.map((c) => JSON.stringify(c)).join("\n");
		}
		decodeReplies(data) {
			return data.trim().split("\n").map((r) => JSON.parse(r));
		}
		applyDeltaIfNeeded(pub, prevValue) {
			let newData, newPrevValue, wireBytes;
			let isDelta;
			if (pub.delta) {
				isDelta = true;
				const deltaBytes = new TextEncoder().encode(pub.data);
				const valueArray = applyDelta(prevValue, deltaBytes);
				newData = JSON.parse(new TextDecoder().decode(valueArray));
				newPrevValue = valueArray;
				wireBytes = deltaBytes.length;
			} else {
				isDelta = false;
				newData = JSON.parse(pub.data);
				newPrevValue = new TextEncoder().encode(pub.data);
				wireBytes = newPrevValue.length;
			}
			return {
				newData,
				newPrevValue,
				isDelta,
				wireBytes,
				fullBytes: newPrevValue.length
			};
		}
	};
	var defaults = {
		headers: {},
		token: "",
		getToken: null,
		data: null,
		getData: null,
		debug: false,
		name: "js",
		version: "",
		fetch: null,
		readableStream: null,
		websocket: null,
		eventsource: null,
		sockjs: null,
		sockjsOptions: {},
		emulationEndpoint: "/emulation",
		minReconnectDelay: 500,
		maxReconnectDelay: 2e4,
		timeout: 5e3,
		maxServerPingDelay: 1e4,
		networkEventTarget: null
	};
	var UnauthorizedError = class extends Error {
		constructor(message) {
			super(message);
			this.name = this.constructor.name;
		}
	};
	var Centrifuge = class extends EventEmitter {
		constructor(endpoint, options) {
			super();
			this._reconnectTimeout = null;
			this._refreshTimeout = null;
			this._serverPingTimeout = null;
			this.state = State.Disconnected;
			this._transportIsOpen = false;
			this._endpoint = endpoint;
			this._emulation = false;
			this._transports = [];
			this._currentTransportIndex = 0;
			this._triedAllTransports = false;
			this._transportWasOpen = false;
			this._transport = null;
			this._transportId = 0;
			this._deviceWentOffline = false;
			this._transportClosed = true;
			this._codec = new JsonCodec();
			this._reconnecting = false;
			this._reconnectTimeout = null;
			this._reconnectAttempts = 0;
			this._client = null;
			this._session = "";
			this._node = "";
			this._subs = {};
			this._serverSubs = {};
			this._commandId = 0;
			this._commands = [];
			this._batching = false;
			this._refreshRequired = false;
			this._refreshTimeout = null;
			this._callbacks = {};
			this._token = "";
			this._data = null;
			this._dispatchPromise = Promise.resolve();
			this._serverPing = 0;
			this._serverPingTimeout = null;
			this._sendPong = false;
			this._promises = {};
			this._promiseId = 0;
			this._debugEnabled = false;
			this._networkEventsSet = false;
			this._config = Object.assign(Object.assign({}, defaults), options);
			this._configure();
			if (this._debugEnabled) {
				this.on("state", (ctx) => {
					this._debug("client state", ctx.oldState, "->", ctx.newState);
				});
				this.on("error", (ctx) => {
					this._debug("client error", ctx);
				});
			} else this.on("error", function() {
				Function.prototype();
			});
		}
		newSubscription(channel, options) {
			if (this.getSubscription(channel) !== null) throw new Error("Subscription to the channel " + channel + " already exists");
			const sub = new Subscription(this, channel, options);
			this._subs[channel] = sub;
			return sub;
		}
		newMapSubscription(channel, options) {
			if (this.getSubscription(channel) !== null) throw new Error("Subscription to the channel " + channel + " already exists");
			const sub = new MapSubscription(this, channel, {
				token: options === null || options === void 0 ? void 0 : options.token,
				getToken: options === null || options === void 0 ? void 0 : options.getToken,
				data: options === null || options === void 0 ? void 0 : options.data,
				minResubscribeDelay: options === null || options === void 0 ? void 0 : options.minResubscribeDelay,
				maxResubscribeDelay: options === null || options === void 0 ? void 0 : options.maxResubscribeDelay,
				delta: options === null || options === void 0 ? void 0 : options.delta,
				tagsFilter: options === null || options === void 0 ? void 0 : options.tagsFilter,
				map: true,
				mapPageSize: options === null || options === void 0 ? void 0 : options.pageSize,
				mapUnrecoverableStrategy: options === null || options === void 0 ? void 0 : options.unrecoverableStrategy
			});
			this._subs[channel] = sub;
			return sub;
		}
		newMapClientsSubscription(channel, options) {
			if (this.getSubscription(channel) !== null) throw new Error("Subscription to the channel " + channel + " already exists");
			const sub = new MapSubscription(this, channel, {
				token: options === null || options === void 0 ? void 0 : options.token,
				getToken: options === null || options === void 0 ? void 0 : options.getToken,
				data: options === null || options === void 0 ? void 0 : options.data,
				minResubscribeDelay: options === null || options === void 0 ? void 0 : options.minResubscribeDelay,
				maxResubscribeDelay: options === null || options === void 0 ? void 0 : options.maxResubscribeDelay,
				delta: options === null || options === void 0 ? void 0 : options.delta,
				tagsFilter: options === null || options === void 0 ? void 0 : options.tagsFilter,
				map: true,
				mapPresenceType: 2,
				mapPageSize: options === null || options === void 0 ? void 0 : options.pageSize,
				mapUnrecoverableStrategy: options === null || options === void 0 ? void 0 : options.unrecoverableStrategy
			});
			this._subs[channel] = sub;
			return sub;
		}
		newMapUsersSubscription(channel, options) {
			if (this.getSubscription(channel) !== null) throw new Error("Subscription to the channel " + channel + " already exists");
			const sub = new MapSubscription(this, channel, {
				token: options === null || options === void 0 ? void 0 : options.token,
				getToken: options === null || options === void 0 ? void 0 : options.getToken,
				data: options === null || options === void 0 ? void 0 : options.data,
				minResubscribeDelay: options === null || options === void 0 ? void 0 : options.minResubscribeDelay,
				maxResubscribeDelay: options === null || options === void 0 ? void 0 : options.maxResubscribeDelay,
				delta: options === null || options === void 0 ? void 0 : options.delta,
				tagsFilter: options === null || options === void 0 ? void 0 : options.tagsFilter,
				map: true,
				mapPresenceType: 3,
				mapPageSize: options === null || options === void 0 ? void 0 : options.pageSize,
				mapUnrecoverableStrategy: options === null || options === void 0 ? void 0 : options.unrecoverableStrategy
			});
			this._subs[channel] = sub;
			return sub;
		}
		newSharedPollSubscription(channel, options) {
			if (this.getSubscription(channel) !== null) throw new Error("Subscription to the channel " + channel + " already exists");
			const sub = new SharedPollSubscription(this, channel, {
				token: options === null || options === void 0 ? void 0 : options.token,
				getToken: options === null || options === void 0 ? void 0 : options.getToken,
				data: options === null || options === void 0 ? void 0 : options.data,
				minResubscribeDelay: options === null || options === void 0 ? void 0 : options.minResubscribeDelay,
				maxResubscribeDelay: options === null || options === void 0 ? void 0 : options.maxResubscribeDelay,
				delta: options === null || options === void 0 ? void 0 : options.delta,
				sharedPoll: true,
				sharedPollGetSignature: options === null || options === void 0 ? void 0 : options.getSignature
			});
			this._subs[channel] = sub;
			return sub;
		}
		getSubscription(channel) {
			return this._getSub(channel);
		}
		getMapSubscription(channel) {
			return this._getSub(channel);
		}
		getSharedPollSubscription(channel) {
			return this._getSub(channel);
		}
		removeSubscription(sub) {
			if (!sub) return;
			if (sub.state !== SubscriptionState.Unsubscribed) sub.unsubscribe();
			this._removeSubscription(sub);
		}
		removeMapSubscription(sub) {
			this.removeSubscription(sub);
		}
		removeSharedPollSubscription(sub) {
			this.removeSubscription(sub);
		}
		subscriptions() {
			return this._subs;
		}
		mapSubscriptions() {
			const result = {};
			for (const [ch, sub] of Object.entries(this._subs)) if (sub.type === "map") result[ch] = sub;
			return result;
		}
		sharedPollSubscriptions() {
			const result = {};
			for (const [ch, sub] of Object.entries(this._subs)) if (sub.type === "shared_poll") result[ch] = sub;
			return result;
		}
		ready(timeout) {
			return __awaiter(this, void 0, void 0, function* () {
				switch (this.state) {
					case State.Disconnected: throw {
						code: errorCodes.clientDisconnected,
						message: "client disconnected"
					};
					case State.Connected: return;
					default: return new Promise((resolve, reject) => {
						const ctx = {
							resolve,
							reject
						};
						if (timeout) ctx.timeout = setTimeout(() => {
							reject({
								code: errorCodes.timeout,
								message: "timeout"
							});
						}, timeout);
						this._promises[this._nextPromiseId()] = ctx;
					});
				}
			});
		}
		connect() {
			if (this._isConnected()) {
				this._debug("connect called when already connected");
				return;
			}
			if (this._isConnecting()) {
				this._debug("connect called when already connecting");
				return;
			}
			this._debug("connect called");
			this._reconnectAttempts = 0;
			this._startConnecting();
		}
		disconnect() {
			this._disconnect(disconnectedCodes.disconnectCalled, "disconnect called", false);
		}
		setToken(token) {
			this._token = token;
		}
		setData(data) {
			this._data = data;
		}
		setHeaders(headers) {
			this._config.headers = headers;
		}
		send(data) {
			return __awaiter(this, void 0, void 0, function* () {
				const cmd = { send: { data } };
				yield this._methodCall();
				if (!this._transportSendCommands([cmd])) throw this._createErrorObject(errorCodes.transportWriteError, "transport write error");
			});
		}
		rpc(method, data) {
			return __awaiter(this, void 0, void 0, function* () {
				const cmd = { rpc: {
					method,
					data
				} };
				yield this._methodCall();
				return { data: (yield this._callPromise(cmd, (reply) => reply.rpc)).data };
			});
		}
		publish(channel, data) {
			return __awaiter(this, void 0, void 0, function* () {
				const cmd = { publish: {
					channel,
					data
				} };
				yield this._methodCall();
				yield this._callPromise(cmd, () => ({}));
				return {};
			});
		}
		mapPublish(channel, key, data) {
			return __awaiter(this, void 0, void 0, function* () {
				const cmd = { publish: {
					channel,
					type: 1,
					key,
					data
				} };
				yield this._methodCall();
				yield this._callPromise(cmd, () => ({}));
				return {};
			});
		}
		mapRemove(channel, key) {
			return __awaiter(this, void 0, void 0, function* () {
				const cmd = { publish: {
					channel,
					type: 1,
					key,
					removed: true
				} };
				yield this._methodCall();
				yield this._callPromise(cmd, () => ({}));
				return {};
			});
		}
		history(channel, options) {
			return __awaiter(this, void 0, void 0, function* () {
				const cmd = { history: this._getHistoryRequest(channel, options) };
				yield this._methodCall();
				const result = yield this._callPromise(cmd, (reply) => reply.history);
				const publications = [];
				if (result.publications) for (let i = 0; i < result.publications.length; i++) publications.push(this._getPublicationContext(channel, result.publications[i]));
				return {
					publications,
					epoch: result.epoch || "",
					offset: result.offset || 0
				};
			});
		}
		presence(channel) {
			return __awaiter(this, void 0, void 0, function* () {
				const cmd = { presence: { channel } };
				yield this._methodCall();
				const clients = (yield this._callPromise(cmd, (reply) => reply.presence)).presence;
				for (const clientId in clients) if (Object.prototype.hasOwnProperty.call(clients, clientId)) {
					const rawClient = clients[clientId];
					const connInfo = rawClient["conn_info"];
					const chanInfo = rawClient["chan_info"];
					if (connInfo) rawClient.connInfo = connInfo;
					if (chanInfo) rawClient.chanInfo = chanInfo;
				}
				return { clients };
			});
		}
		presenceStats(channel) {
			return __awaiter(this, void 0, void 0, function* () {
				const cmd = { "presence_stats": { channel } };
				yield this._methodCall();
				const result = yield this._callPromise(cmd, (reply) => {
					return reply.presence_stats;
				});
				return {
					numUsers: result.num_users,
					numClients: result.num_clients
				};
			});
		}
		startBatching() {
			this._batching = true;
		}
		stopBatching() {
			const self = this;
			Promise.resolve().then(function() {
				Promise.resolve().then(function() {
					self._batching = false;
					self._flush();
				});
			});
		}
		_debug(...args) {
			if (!this._debugEnabled) return;
			log("debug", args);
		}
		_codecName() {
			return this._codec.name();
		}
		_formatOverride() {}
		_configure() {
			if (!("Promise" in globalThis)) throw new Error("Promise polyfill required");
			if (!this._endpoint) throw new Error("endpoint configuration required");
			if (this._config.token !== null) this._token = this._config.token;
			if (this._config.data !== null) this._data = this._config.data;
			this._codec = new JsonCodec();
			this._formatOverride();
			if (this._config.debug === true || localStorageItem("centrifuge.debug")) this._debugEnabled = true;
			this._debug("config", this._config);
			if (typeof this._endpoint === "string");
			else if (Array.isArray(this._endpoint)) {
				this._transports = this._endpoint;
				this._emulation = true;
				for (const i in this._transports) if (this._transports.hasOwnProperty(i)) {
					const transportConfig = this._transports[i];
					if (!transportConfig.endpoint || !transportConfig.transport) throw new Error("malformed transport configuration");
					const transportName = transportConfig.transport;
					if ([
						"websocket",
						"http_stream",
						"sse",
						"sockjs",
						"webtransport"
					].indexOf(transportName) < 0) throw new Error("unsupported transport name: " + transportName);
				}
			} else throw new Error("unsupported url configuration type: only string or array of objects are supported");
		}
		_setState(newState) {
			if (this.state !== newState) {
				this._reconnecting = false;
				const oldState = this.state;
				this.state = newState;
				this.emit("state", {
					newState,
					oldState
				});
				return true;
			}
			return false;
		}
		_isDisconnected() {
			return this.state === State.Disconnected;
		}
		_isConnecting() {
			return this.state === State.Connecting;
		}
		_isConnected() {
			return this.state === State.Connected;
		}
		_nextCommandId() {
			return ++this._commandId;
		}
		_setNetworkEvents() {
			if (this._networkEventsSet) return;
			let eventTarget = null;
			if (this._config.networkEventTarget !== null) eventTarget = this._config.networkEventTarget;
			else if (typeof globalThis.addEventListener !== "undefined") eventTarget = globalThis;
			if (eventTarget) {
				eventTarget.addEventListener("offline", () => {
					this._debug("offline event triggered");
					if (this.state === State.Connected || this.state === State.Connecting) {
						this._disconnect(connectingCodes.transportClosed, "transport closed", true);
						this._deviceWentOffline = true;
					}
				});
				eventTarget.addEventListener("online", () => {
					this._debug("online event triggered");
					if (this.state !== State.Connecting) return;
					if (this._deviceWentOffline && !this._transportClosed) {
						this._deviceWentOffline = false;
						this._transportClosed = true;
					}
					this._clearReconnectTimeout();
					this._startReconnecting();
				});
				this._networkEventsSet = true;
			}
		}
		_getReconnectDelay() {
			const delay = backoff(this._reconnectAttempts, this._config.minReconnectDelay, this._config.maxReconnectDelay);
			this._reconnectAttempts += 1;
			return delay;
		}
		_clearOutgoingRequests() {
			for (const id in this._callbacks) if (this._callbacks.hasOwnProperty(id)) {
				const callbacks = this._callbacks[id];
				clearTimeout(callbacks.timeout);
				const errback = callbacks.errback;
				if (!errback) continue;
				errback({ error: this._createErrorObject(errorCodes.connectionClosed, "connection closed") });
			}
			this._callbacks = {};
		}
		_clearConnectedState() {
			this._client = null;
			this._clearServerPingTimeout();
			this._clearRefreshTimeout();
			for (const channel in this._subs) {
				if (!this._subs.hasOwnProperty(channel)) continue;
				const sub = this._subs[channel];
				if (sub.state === SubscriptionState.Subscribed) sub._setSubscribing(subscribingCodes.transportClosed, "transport closed");
			}
			for (const channel in this._serverSubs) if (this._serverSubs.hasOwnProperty(channel)) this.emit("subscribing", { channel });
		}
		_handleWriteError(commands) {
			for (const command of commands) {
				const id = command.id;
				if (!(id in this._callbacks)) continue;
				const callbacks = this._callbacks[id];
				clearTimeout(this._callbacks[id].timeout);
				delete this._callbacks[id];
				const errback = callbacks.errback;
				errback({ error: this._createErrorObject(errorCodes.transportWriteError, "transport write error") });
			}
		}
		_transportSendCommands(commands) {
			if (!commands.length) return true;
			if (!this._transport) return false;
			try {
				this._transport.send(this._codec.encodeCommands(commands), this._session, this._node);
			} catch (e) {
				this._debug("error writing commands", e);
				this._handleWriteError(commands);
				return false;
			}
			return true;
		}
		_advanceTransportIndex() {
			this._currentTransportIndex++;
			if (this._currentTransportIndex >= this._transports.length) {
				this._triedAllTransports = true;
				this._currentTransportIndex = 0;
			}
		}
		_initializeTransport() {
			let websocket;
			if (this._config.websocket !== null) websocket = this._config.websocket;
			else if (!(typeof globalThis.WebSocket !== "function" && typeof globalThis.WebSocket !== "object")) websocket = globalThis.WebSocket;
			let sockjs = null;
			if (this._config.sockjs !== null) sockjs = this._config.sockjs;
			else if (typeof globalThis.SockJS !== "undefined") sockjs = globalThis.SockJS;
			let eventsource = null;
			if (this._config.eventsource !== null) eventsource = this._config.eventsource;
			else if (typeof globalThis.EventSource !== "undefined") eventsource = globalThis.EventSource;
			let fetchFunc = null;
			if (this._config.fetch !== null) fetchFunc = this._config.fetch;
			else if (typeof globalThis.fetch !== "undefined") fetchFunc = globalThis.fetch;
			let readableStream = null;
			if (this._config.readableStream !== null) readableStream = this._config.readableStream;
			else if (typeof globalThis.ReadableStream !== "undefined") readableStream = globalThis.ReadableStream;
			if (!this._emulation) {
				if (startsWith(this._endpoint, "http")) throw new Error("Provide explicit transport endpoints configuration in case of using HTTP (i.e. using array of TransportEndpoint instead of a single string), or use ws(s):// scheme in an endpoint if you aimed using WebSocket transport");
				else {
					this._debug("client will use websocket");
					this._transport = new WebsocketTransport(this._endpoint, { websocket });
					if (!this._transport.supported()) throw new Error("WebSocket constructor not found, make sure it is available globally or passed as a dependency in Centrifuge options");
				}
			} else {
				if (this._currentTransportIndex >= this._transports.length) {
					this._triedAllTransports = true;
					this._currentTransportIndex = 0;
				}
				let count = 0;
				while (true) {
					if (count >= this._transports.length) throw new Error("no supported transport found");
					const transportConfig = this._transports[this._currentTransportIndex];
					const transportName = transportConfig.transport;
					const transportEndpoint = transportConfig.endpoint;
					if (transportName === "websocket") {
						this._debug("trying websocket transport");
						this._transport = new WebsocketTransport(transportEndpoint, { websocket });
						if (!this._transport.supported()) {
							this._debug("websocket transport not available");
							this._advanceTransportIndex();
							count++;
							continue;
						}
					} else if (transportName === "webtransport") {
						this._debug("trying webtransport transport");
						this._transport = new WebtransportTransport(transportEndpoint, {
							webtransport: globalThis.WebTransport,
							decoder: this._codec,
							encoder: this._codec
						});
						if (!this._transport.supported()) {
							this._debug("webtransport transport not available");
							this._advanceTransportIndex();
							count++;
							continue;
						}
					} else if (transportName === "http_stream") {
						this._debug("trying http_stream transport");
						this._transport = new HttpStreamTransport(transportEndpoint, {
							fetch: fetchFunc,
							readableStream,
							emulationEndpoint: this._config.emulationEndpoint,
							decoder: this._codec,
							encoder: this._codec
						});
						if (!this._transport.supported()) {
							this._debug("http_stream transport not available");
							this._advanceTransportIndex();
							count++;
							continue;
						}
					} else if (transportName === "sse") {
						this._debug("trying sse transport");
						this._transport = new SseTransport(transportEndpoint, {
							eventsource,
							fetch: fetchFunc,
							emulationEndpoint: this._config.emulationEndpoint
						});
						if (!this._transport.supported()) {
							this._debug("sse transport not available");
							this._advanceTransportIndex();
							count++;
							continue;
						}
					} else if (transportName === "sockjs") {
						this._debug("trying sockjs");
						this._transport = new SockjsTransport(transportEndpoint, {
							sockjs,
							sockjsOptions: this._config.sockjsOptions
						});
						if (!this._transport.supported()) {
							this._debug("sockjs transport not available");
							this._advanceTransportIndex();
							count++;
							continue;
						}
					} else throw new Error("unknown transport " + transportName);
					break;
				}
			}
			const self = this;
			const transport = this._transport;
			const transportId = this._nextTransportId();
			self._debug("id of transport", transportId);
			let wasOpen = false;
			const initialCommands = [];
			if (this._transport.emulation()) {
				const connectCommand = self._sendConnect(true);
				initialCommands.push(connectCommand);
			}
			this._setNetworkEvents();
			const initialData = this._codec.encodeCommands(initialCommands);
			this._transportClosed = false;
			let connectTimeout;
			connectTimeout = setTimeout(function() {
				transport.close();
			}, this._config.timeout);
			this._transport.initialize(this._codecName(), {
				onOpen: function() {
					if (connectTimeout) {
						clearTimeout(connectTimeout);
						connectTimeout = null;
					}
					if (self._transportId != transportId) {
						self._debug("open callback from non-actual transport");
						transport.close();
						return;
					}
					wasOpen = true;
					self._debug(transport.subName(), "transport open");
					if (transport.emulation()) return;
					self._transportIsOpen = true;
					self._transportWasOpen = true;
					self.startBatching();
					self._sendConnect(false);
					self._sendSubscribeCommands();
					self.stopBatching();
					self.emit("__centrifuge_debug:connect_frame_sent", {});
				},
				onError: function(e) {
					if (self._transportId != transportId) {
						self._debug("error callback from non-actual transport");
						return;
					}
					self._debug("transport level error", e);
				},
				onClose: function(closeEvent) {
					if (connectTimeout) {
						clearTimeout(connectTimeout);
						connectTimeout = null;
					}
					if (self._transportId != transportId) {
						self._debug("close callback from non-actual transport");
						return;
					}
					self._debug(transport.subName(), "transport closed");
					self._transportClosed = true;
					self._transportIsOpen = false;
					let reason = "connection closed";
					let needReconnect = true;
					let code = 0;
					if (closeEvent && "code" in closeEvent && closeEvent.code) code = closeEvent.code;
					if (closeEvent && closeEvent.reason) try {
						const advice = JSON.parse(closeEvent.reason);
						reason = advice.reason;
						needReconnect = advice.reconnect;
					} catch (e) {
						reason = closeEvent.reason;
						if (code >= 3500 && code < 4e3 || code >= 4500 && code < 5e3) needReconnect = false;
					}
					if (code < 3e3) {
						if (code === 1009) {
							code = disconnectedCodes.messageSizeLimit;
							reason = "message size limit exceeded";
							needReconnect = false;
						} else {
							code = connectingCodes.transportClosed;
							reason = "transport closed";
						}
						if (self._emulation && !self._transportWasOpen) self._advanceTransportIndex();
					} else self._transportWasOpen = true;
					if (self._isConnecting() && !wasOpen) self.emit("error", {
						type: "transport",
						error: {
							code: errorCodes.transportClosed,
							message: "transport closed"
						},
						transport: transport.name()
					});
					self._reconnecting = false;
					self._disconnect(code, reason, needReconnect);
				},
				onMessage: function(data) {
					self._dataReceived(data);
				}
			}, initialData);
			self.emit("__centrifuge_debug:transport_initialized", {});
		}
		_sendConnect(skipSending) {
			const connectCommand = this._constructConnectCommand();
			const self = this;
			this._call(connectCommand, skipSending).then((resolveCtx) => {
				const result = resolveCtx.reply.connect;
				self._connectResponse(result);
				if (resolveCtx.next) resolveCtx.next();
			}, (rejectCtx) => {
				self._connectError(rejectCtx.error);
				if (rejectCtx.next) rejectCtx.next();
			});
			return connectCommand;
		}
		_startReconnecting() {
			this._debug("start reconnecting");
			if (!this._isConnecting()) {
				this._debug("stop reconnecting: client not in connecting state");
				return;
			}
			if (this._reconnecting) {
				this._debug("reconnect already in progress, return from reconnect routine");
				return;
			}
			if (this._transportClosed === false) {
				this._debug("waiting for transport close");
				return;
			}
			this._reconnecting = true;
			const emptyToken = this._token === "";
			if (!(this._refreshRequired || emptyToken && this._config.getToken !== null)) {
				if (this._config.getData) this._config.getData().then((data) => {
					if (!this._isConnecting()) return;
					this._data = data;
					this._initializeTransport();
				}).catch((e) => this._handleGetDataError(e));
				else this._initializeTransport();
				return;
			}
			const self = this;
			this._getToken().then(function(token) {
				if (!self._isConnecting()) return;
				if (token == null || token == void 0) {
					self._failUnauthorized();
					return;
				}
				self._token = token;
				self._debug("connection token refreshed");
				if (self._config.getData) self._config.getData().then(function(data) {
					if (!self._isConnecting()) return;
					self._data = data;
					self._initializeTransport();
				}).catch((e) => self._handleGetDataError(e));
				else self._initializeTransport();
			}).catch(function(e) {
				if (!self._isConnecting()) return;
				if (e instanceof UnauthorizedError) {
					self._failUnauthorized();
					return;
				}
				self.emit("error", {
					"type": "connectToken",
					"error": {
						code: errorCodes.clientConnectToken,
						message: e !== void 0 ? e.toString() : ""
					}
				});
				const delay = self._getReconnectDelay();
				self._debug("error on getting connection token, reconnect after " + delay + " milliseconds", e);
				self._reconnecting = false;
				self._reconnectTimeout = setTimeout(() => {
					self._startReconnecting();
				}, delay);
			});
		}
		_handleGetDataError(e) {
			if (e instanceof UnauthorizedError) {
				this._failUnauthorized();
				return;
			}
			this.emit("error", {
				type: "connectData",
				error: {
					code: errorCodes.badConfiguration,
					message: (e === null || e === void 0 ? void 0 : e.toString()) || ""
				}
			});
			const delay = this._getReconnectDelay();
			this._debug("error on getting connect data, reconnect after " + delay + " milliseconds", e);
			this._reconnecting = false;
			this._reconnectTimeout = setTimeout(() => {
				this._startReconnecting();
			}, delay);
		}
		_connectError(err) {
			if (this.state !== State.Connecting) return;
			if (err.code === 109) this._refreshRequired = true;
			if (err.code < 100 || err.temporary === true || err.code === 109) {
				this.emit("error", {
					"type": "connect",
					"error": err
				});
				this._debug("closing transport due to connect error");
				this._disconnect(err.code, err.message, true);
			} else this._disconnect(err.code, err.message, false);
		}
		_scheduleReconnect() {
			if (!this._isConnecting()) return;
			let isInitialHandshake = false;
			if (this._emulation && !this._transportWasOpen && !this._triedAllTransports) isInitialHandshake = true;
			let delay = this._getReconnectDelay();
			if (isInitialHandshake) delay = 0;
			this._debug("reconnect after " + delay + " milliseconds");
			this._clearReconnectTimeout();
			this._reconnectTimeout = setTimeout(() => {
				this._startReconnecting();
			}, delay);
		}
		_constructConnectCommand() {
			const req = {};
			if (this._token) req.token = this._token;
			if (this._data) req.data = this._data;
			if (this._config.name) req.name = this._config.name;
			if (this._config.version) req.version = this._config.version;
			if (Object.keys(this._config.headers).length > 0) req.headers = this._config.headers;
			const subs = {};
			let hasSubs = false;
			for (const channel in this._serverSubs) if (this._serverSubs.hasOwnProperty(channel) && this._serverSubs[channel].recoverable) {
				hasSubs = true;
				const sub = { "recover": true };
				if (this._serverSubs[channel].offset) sub["offset"] = this._serverSubs[channel].offset;
				if (this._serverSubs[channel].epoch) sub["epoch"] = this._serverSubs[channel].epoch;
				subs[channel] = sub;
			}
			if (hasSubs) req.subs = subs;
			return { connect: req };
		}
		_getHistoryRequest(channel, options) {
			const req = { channel };
			if (options !== void 0) {
				if (options.since) {
					req.since = { offset: options.since.offset };
					if (options.since.epoch) req.since.epoch = options.since.epoch;
				}
				if (options.limit !== void 0) req.limit = options.limit;
				if (options.reverse === true) req.reverse = true;
			}
			return req;
		}
		_methodCall() {
			if (this._isConnected()) return Promise.resolve();
			return new Promise((res, rej) => {
				const timeout = setTimeout(function() {
					rej({
						code: errorCodes.timeout,
						message: "timeout"
					});
				}, this._config.timeout);
				this._promises[this._nextPromiseId()] = {
					timeout,
					resolve: res,
					reject: rej
				};
			});
		}
		_callPromise(cmd, resultCB) {
			return new Promise((resolve, reject) => {
				this._call(cmd, false).then((resolveCtx) => {
					var _a;
					resolve(resultCB(resolveCtx.reply));
					(_a = resolveCtx.next) === null || _a === void 0 || _a.call(resolveCtx);
				}, (rejectCtx) => {
					var _a;
					reject(rejectCtx.error);
					(_a = rejectCtx.next) === null || _a === void 0 || _a.call(rejectCtx);
				});
			});
		}
		_dataReceived(data) {
			if (this._serverPing > 0) this._waitServerPing();
			const replies = this._codec.decodeReplies(data);
			this._dispatchPromise = this._dispatchPromise.then(() => {
				let finishDispatch;
				this._dispatchPromise = new Promise((resolve) => {
					finishDispatch = resolve;
				});
				this._dispatchSynchronized(replies, finishDispatch);
			});
		}
		_dispatchSynchronized(replies, finishDispatch) {
			let p = Promise.resolve();
			for (const i in replies) if (replies.hasOwnProperty(i)) p = p.then(() => {
				return this._dispatchReply(replies[i]);
			});
			p.then(() => {
				finishDispatch();
			});
		}
		_dispatchReply(reply) {
			let next;
			const p = new Promise((resolve) => {
				next = resolve;
			});
			if (reply === void 0 || reply === null) {
				this._debug("dispatch: got undefined or null reply");
				next();
				return p;
			}
			const id = reply.id;
			if (id && id > 0) this._handleReply(reply, next);
			else if (!reply.push) this._handleServerPing(next);
			else this._handlePush(reply.push, next);
			return p;
		}
		_call(cmd, skipSending) {
			return new Promise((resolve, reject) => {
				cmd.id = this._nextCommandId();
				this._registerCall(cmd.id, resolve, reject);
				if (!skipSending) this._addCommand(cmd);
			});
		}
		_startConnecting() {
			this._debug("start connecting");
			if (this._setState(State.Connecting)) this.emit("connecting", {
				code: connectingCodes.connectCalled,
				reason: "connect called"
			});
			this._client = null;
			this._startReconnecting();
		}
		_disconnect(code, reason, reconnect) {
			if (code === disconnectedCodes.stateInvalidated) {
				this._token = "";
				this._refreshRequired = true;
				for (const channel in this._subs) if (this._subs.hasOwnProperty(channel)) this._subs[channel]._invalidateState();
				for (const channel in this._serverSubs) if (this._serverSubs.hasOwnProperty(channel)) {
					this._serverSubs[channel].offset = 0;
					this._serverSubs[channel].epoch = "_";
				}
			}
			if (this._isDisconnected()) return;
			this._transportIsOpen = false;
			const previousState = this.state;
			this._reconnecting = false;
			const ctx = {
				code,
				reason
			};
			let needEvent;
			if (reconnect) needEvent = this._setState(State.Connecting);
			else {
				needEvent = this._setState(State.Disconnected);
				this._rejectPromises({
					code: errorCodes.clientDisconnected,
					message: "disconnected"
				});
			}
			this._clearOutgoingRequests();
			if (previousState === State.Connecting) this._clearReconnectTimeout();
			if (previousState === State.Connected) this._clearConnectedState();
			if (needEvent) {
				if (this._isConnecting()) this.emit("connecting", ctx);
				else this.emit("disconnected", ctx);
			}
			if (this._transport) {
				this._debug("closing existing transport");
				const transport = this._transport;
				this._transport = null;
				transport.close();
				this._transportClosed = true;
				this._nextTransportId();
			} else this._debug("no transport to close");
			this._scheduleReconnect();
		}
		_failUnauthorized() {
			this._disconnect(disconnectedCodes.unauthorized, "unauthorized", false);
		}
		_getToken() {
			this._debug("get connection token");
			if (!this._config.getToken) {
				this.emit("error", {
					type: "configuration",
					error: {
						code: errorCodes.badConfiguration,
						message: "token expired but no getToken function set in the configuration"
					}
				});
				return Promise.reject(new UnauthorizedError(""));
			}
			return this._config.getToken({});
		}
		_refresh() {
			const clientId = this._client;
			const self = this;
			this._getToken().then(function(token) {
				if (clientId !== self._client) return;
				if (!token) {
					self._failUnauthorized();
					return;
				}
				self._token = token;
				self._debug("connection token refreshed");
				if (!self._isConnected()) return;
				const cmd = { refresh: { token: self._token } };
				self._call(cmd, false).then((resolveCtx) => {
					const result = resolveCtx.reply.refresh;
					self._refreshResponse(result);
					if (resolveCtx.next) resolveCtx.next();
				}, (rejectCtx) => {
					self._refreshError(rejectCtx.error);
					if (rejectCtx.next) rejectCtx.next();
				});
			}).catch(function(e) {
				if (!self._isConnected()) return;
				if (e instanceof UnauthorizedError) {
					self._failUnauthorized();
					return;
				}
				self.emit("error", {
					type: "refreshToken",
					error: {
						code: errorCodes.clientRefreshToken,
						message: e !== void 0 ? e.toString() : ""
					}
				});
				self._refreshTimeout = setTimeout(() => self._refresh(), self._getRefreshRetryDelay());
			});
		}
		_refreshError(err) {
			if (err.code < 100 || err.temporary === true) {
				this.emit("error", {
					type: "refresh",
					error: err
				});
				this._refreshTimeout = setTimeout(() => this._refresh(), this._getRefreshRetryDelay());
			} else this._disconnect(err.code, err.message, false);
		}
		_getRefreshRetryDelay() {
			return backoff(0, 5e3, 1e4);
		}
		_refreshResponse(result) {
			if (this._refreshTimeout) {
				clearTimeout(this._refreshTimeout);
				this._refreshTimeout = null;
			}
			if (result.expires) {
				this._client = result.client;
				this._refreshTimeout = setTimeout(() => this._refresh(), ttlMilliseconds(result.ttl));
			}
		}
		_removeSubscription(sub) {
			if (sub === null) return;
			delete this._subs[sub.channel];
		}
		_unsubscribe(sub) {
			if (!this._transportIsOpen) return Promise.resolve();
			const cmd = { unsubscribe: { channel: sub.channel } };
			const self = this;
			return new Promise((resolve, _) => {
				this._call(cmd, false).then((resolveCtx) => {
					resolve();
					if (resolveCtx.next) resolveCtx.next();
				}, (rejectCtx) => {
					resolve();
					if (rejectCtx.next) rejectCtx.next();
					self._disconnect(connectingCodes.unsubscribeError, "unsubscribe error", true);
				});
			});
		}
		_getSub(channel, id) {
			if (id && id > 0) {
				for (const ch in this._subs) if (this._subs.hasOwnProperty(ch)) {
					const sub = this._subs[ch];
					if (sub._id === id) return sub;
				}
				return null;
			}
			const sub = this._subs[channel];
			if (!sub) return null;
			return sub;
		}
		_isServerSub(channel) {
			return this._serverSubs[channel] !== void 0;
		}
		_sendSubscribeCommands() {
			const commands = [];
			for (const channel in this._subs) {
				if (!this._subs.hasOwnProperty(channel)) continue;
				const sub = this._subs[channel];
				if (sub._inflight === true) continue;
				if (sub.state === SubscriptionState.Subscribing) {
					const cmd = sub._subscribe();
					if (cmd) commands.push(cmd);
				}
			}
			return commands;
		}
		_connectResponse(result) {
			this._transportIsOpen = true;
			this._transportWasOpen = true;
			this._reconnectAttempts = 0;
			this._refreshRequired = false;
			if (this._isConnected()) return;
			this._client = result.client;
			this._setState(State.Connected);
			if (this._refreshTimeout) clearTimeout(this._refreshTimeout);
			if (result.expires) this._refreshTimeout = setTimeout(() => this._refresh(), ttlMilliseconds(result.ttl));
			this._session = result.session;
			this._node = result.node;
			this.startBatching();
			this._sendSubscribeCommands();
			this.stopBatching();
			const ctx = {
				client: result.client,
				transport: this._transport.subName()
			};
			if (result.data) ctx.data = result.data;
			this.emit("connected", ctx);
			this._resolvePromises();
			this._processServerSubs(result.subs || {});
			if (result.ping && result.ping > 0) {
				this._serverPing = result.ping * 1e3;
				this._sendPong = result.pong === true;
				this._waitServerPing();
			} else this._serverPing = 0;
		}
		_processServerSubs(subs) {
			for (const channel in subs) {
				if (!subs.hasOwnProperty(channel)) continue;
				const sub = subs[channel];
				this._serverSubs[channel] = {
					"offset": sub.offset,
					"epoch": sub.epoch,
					"recoverable": sub.recoverable || false
				};
				const subCtx = this._getSubscribeContext(channel, sub);
				this.emit("subscribed", subCtx);
			}
			for (const channel in subs) {
				if (!subs.hasOwnProperty(channel)) continue;
				const sub = subs[channel];
				if (sub.recovered) {
					const pubs = sub.publications;
					if (pubs && pubs.length > 0) {
						for (const i in pubs) if (pubs.hasOwnProperty(i)) this._handlePublication(channel, pubs[i]);
					}
				}
			}
			for (const channel in this._serverSubs) {
				if (!this._serverSubs.hasOwnProperty(channel)) continue;
				if (!subs[channel]) {
					this.emit("unsubscribed", { channel });
					delete this._serverSubs[channel];
				}
			}
		}
		_clearRefreshTimeout() {
			if (this._refreshTimeout !== null) {
				clearTimeout(this._refreshTimeout);
				this._refreshTimeout = null;
			}
		}
		_clearReconnectTimeout() {
			if (this._reconnectTimeout !== null) {
				clearTimeout(this._reconnectTimeout);
				this._reconnectTimeout = null;
			}
		}
		_clearServerPingTimeout() {
			if (this._serverPingTimeout !== null) {
				clearTimeout(this._serverPingTimeout);
				this._serverPingTimeout = null;
			}
		}
		_waitServerPing() {
			if (this._config.maxServerPingDelay === 0) return;
			if (!this._isConnected()) return;
			this._clearServerPingTimeout();
			this._serverPingTimeout = setTimeout(() => {
				if (!this._isConnected()) return;
				this._disconnect(connectingCodes.noPing, "no ping", true);
			}, this._serverPing + this._config.maxServerPingDelay);
		}
		_getSubscribeContext(channel, result) {
			const ctx = {
				channel,
				positioned: false,
				recoverable: false,
				wasRecovering: false,
				recovered: false,
				hasRecoveredPublications: false
			};
			if (result.recovered) ctx.recovered = true;
			if (result.positioned) ctx.positioned = true;
			if (result.recoverable) ctx.recoverable = true;
			if (result.was_recovering) ctx.wasRecovering = true;
			let epoch = "";
			if ("epoch" in result) epoch = result.epoch;
			let offset = 0;
			if ("offset" in result) offset = result.offset;
			if (ctx.positioned || ctx.recoverable) ctx.streamPosition = {
				"offset": offset,
				"epoch": epoch
			};
			if (Array.isArray(result.publications) && result.publications.length > 0) ctx.hasRecoveredPublications = true;
			if (result.data) ctx.data = result.data;
			return ctx;
		}
		_handleReply(reply, next) {
			const id = reply.id;
			if (!(id in this._callbacks)) {
				next();
				return;
			}
			const callbacks = this._callbacks[id];
			clearTimeout(this._callbacks[id].timeout);
			delete this._callbacks[id];
			if (!errorExists(reply)) {
				const callback = callbacks.callback;
				if (!callback) return;
				callback({
					reply,
					next
				});
			} else {
				const errback = callbacks.errback;
				if (!errback) {
					next();
					return;
				}
				errback({
					error: {
						code: reply.error.code,
						message: reply.error.message || "",
						temporary: reply.error.temporary || false
					},
					next
				});
			}
		}
		_handleJoin(channel, join, id) {
			const sub = this._getSub(channel, id);
			if (!sub) {
				if (channel && this._isServerSub(channel)) {
					const ctx = {
						channel,
						info: this._getJoinLeaveContext(join.info)
					};
					this.emit("join", ctx);
				}
				return;
			}
			sub._handleJoin(join);
		}
		_handleLeave(channel, leave, id) {
			const sub = this._getSub(channel, id);
			if (!sub) {
				if (channel && this._isServerSub(channel)) {
					const ctx = {
						channel,
						info: this._getJoinLeaveContext(leave.info)
					};
					this.emit("leave", ctx);
				}
				return;
			}
			sub._handleLeave(leave);
		}
		_handleUnsubscribe(channel, unsubscribe) {
			const sub = this._getSub(channel, 0);
			if (!sub && channel) {
				if (this._isServerSub(channel)) {
					delete this._serverSubs[channel];
					this.emit("unsubscribed", { channel });
				}
				return;
			}
			if (unsubscribe.code < 2500) sub._setUnsubscribed(unsubscribe.code, unsubscribe.reason, false);
			else {
				if (unsubscribe.code === unsubscribedCodes.stateInvalidated) sub._invalidateState();
				sub._setSubscribing(unsubscribe.code, unsubscribe.reason);
			}
		}
		_handleSubscribe(channel, sub) {
			this._serverSubs[channel] = {
				"offset": sub.offset,
				"epoch": sub.epoch,
				"recoverable": sub.recoverable || false
			};
			this.emit("subscribed", this._getSubscribeContext(channel, sub));
		}
		_handleDisconnect(disconnect) {
			const code = disconnect.code;
			let reconnect = true;
			if (code >= 3500 && code < 4e3 || code >= 4500 && code < 5e3) reconnect = false;
			this._disconnect(code, disconnect.reason, reconnect);
		}
		_getPublicationContext(channel, pub) {
			const ctx = {
				channel,
				data: pub.data
			};
			if (pub.offset) ctx.offset = pub.offset;
			if (pub.info) ctx.info = this._getJoinLeaveContext(pub.info);
			if (pub.tags) ctx.tags = pub.tags;
			return ctx;
		}
		_getJoinLeaveContext(clientInfo) {
			const info = {
				client: clientInfo.client,
				user: clientInfo.user
			};
			const connInfo = clientInfo["conn_info"];
			if (connInfo) info.connInfo = connInfo;
			const chanInfo = clientInfo["chan_info"];
			if (chanInfo) info.chanInfo = chanInfo;
			return info;
		}
		_handlePublication(channel, pub, id) {
			const sub = this._getSub(channel, id);
			if (!sub) {
				if (channel && this._isServerSub(channel)) {
					const ctx = this._getPublicationContext(channel, pub);
					this.emit("publication", ctx);
					if (pub.offset !== void 0) this._serverSubs[channel].offset = pub.offset;
				}
				return;
			}
			sub._handlePublication(pub);
		}
		_handleMessage(message) {
			this.emit("message", { data: message.data });
		}
		_handleServerPing(next) {
			if (this._sendPong) this._transportSendCommands([{}]);
			next();
		}
		_handlePush(data, next) {
			const channel = data.channel;
			const id = data.id;
			if (data.pub) this._handlePublication(channel, data.pub, id);
			else if (data.message) this._handleMessage(data.message);
			else if (data.join) this._handleJoin(channel, data.join, id);
			else if (data.leave) this._handleLeave(channel, data.leave, id);
			else if (data.unsubscribe) this._handleUnsubscribe(channel, data.unsubscribe);
			else if (data.subscribe) this._handleSubscribe(channel, data.subscribe);
			else if (data.disconnect) this._handleDisconnect(data.disconnect);
			next();
		}
		_flush() {
			const commands = this._commands.slice(0);
			this._commands = [];
			this._transportSendCommands(commands);
		}
		_createErrorObject(code, message, temporary) {
			const errObject = {
				code,
				message
			};
			if (temporary) errObject.temporary = true;
			return errObject;
		}
		_registerCall(id, callback, errback) {
			this._callbacks[id] = {
				callback,
				errback,
				timeout: null
			};
			this._callbacks[id].timeout = setTimeout(() => {
				delete this._callbacks[id];
				if (isFunction(errback)) errback({ error: this._createErrorObject(errorCodes.timeout, "timeout") });
			}, this._config.timeout);
		}
		_addCommand(command) {
			if (this._batching) this._commands.push(command);
			else this._transportSendCommands([command]);
		}
		_nextPromiseId() {
			return ++this._promiseId;
		}
		_nextTransportId() {
			return ++this._transportId;
		}
		_resolvePromises() {
			for (const id in this._promises) {
				if (!this._promises.hasOwnProperty(id)) continue;
				if (this._promises[id].timeout) clearTimeout(this._promises[id].timeout);
				this._promises[id].resolve();
				delete this._promises[id];
			}
		}
		_rejectPromises(err) {
			for (const id in this._promises) {
				if (!this._promises.hasOwnProperty(id)) continue;
				if (this._promises[id].timeout) clearTimeout(this._promises[id].timeout);
				this._promises[id].reject(err);
				delete this._promises[id];
			}
		}
	};
	Centrifuge.SubscriptionState = SubscriptionState;
	Centrifuge.State = State;
	Centrifuge.UnauthorizedError = UnauthorizedError;
	var WS_URL = "wss://ws.triangleliquidators.com/connection/websocket";
	var liveState = "off";
	var state = emitter();
	var subs = new Map();
	function setState(s) {
		liveState = s;
		state.emit();
	}
	var useLiveState = () => C(state.subscribe, () => liveState);
	var connecting = null;
	var connect = () => connecting ??= open();
	var watched = [];
	function drop(c, sub) {
		sub.unsubscribe();
		c.removeSubscription(sub);
	}
	onAuthChange(() => {
		const old = connecting;
		if (!old) return;
		const oldSubs = [...subs.values()];
		subs.clear();
		connecting = null;
		old.then((c) => {
			oldSubs.forEach((sub) => drop(c, sub));
			c.disconnect();
		});
		watchLots(watched).catch(() => {});
	});
	async function open() {
		const token = isAuthenticated() ? await fetchWsToken().catch(() => null) : null;
		const c = new Centrifuge(WS_URL, token ? {
			token,
			getToken: () => fetchWsToken()
		} : {});
		c.on("connecting", () => setState("connecting"));
		c.on("connected", () => setState("connected"));
		c.on("disconnected", () => setState("disconnected"));
		c.on("publication", (ctx) => {
			if (ctx.channel.startsWith("user:")) onUserPublication(ctx.data ?? {});
		});
		c.connect();
		return c;
	}
	function onUserPublication(d) {
		const lotId = Number(d.lot_id);
		const lot = getLot(lotId);
		if (!lot) return;
		const yourMaxBid = lot.yourStanding?.yourMaxBid ?? null;
		const fallback = d.type === "outbid" ? {
			isLeading: false,
			yourMaxBid
		} : d.type === "winning" ? {
			isLeading: true,
			yourMaxBid
		} : null;
		const standing = normalizeStanding(d.relationship) ?? fallback;
		if (standing) updateLot(lotId, {
			yourStanding: standing,
			hasBid: true
		}, { force: true });
	}
	function onLotPublication(data) {
		if (typeof data?.id !== "number") return;
		const patch = {
			currentPrice: data.current_price,
			bidCount: data.bid_count,
			nextMinIncrement: data.next_min_increment,
			endsAt: data.ends_at ? Date.parse(data.ends_at) : void 0,
			status: data.status,
			version: data.version
		};
		updateLot(data.id, Object.fromEntries(Object.entries(patch).filter(([, v]) => v != null)));
	}
	async function watchLots(ids) {
		watched = ids;
		const c = await connect();
		const want = new Set(ids);
		for (const [id, sub] of subs) if (!want.has(id)) {
			drop(c, sub);
			subs.delete(id);
		}
		for (const id of want.difference(subs)) {
			const sub = c.getSubscription(`lot:${id}`) ?? c.newSubscription(`lot:${id}`);
			sub.on("publication", (ctx) => onLotPublication(ctx.data));
			sub.subscribe();
			subs.set(id, sub);
		}
	}
	var FEES = {
		premium: .15,
		lotFee: 1,
		transferFee: 5,
		salesTax: .0725
	};
	function totalCost(bid, transferFee = 0) {
		return (bid * (1 + FEES.premium) + FEES.lotFee + transferFee) * (1 + FEES.salesTax);
	}
	function costBreakdown(bid, transferFee = 0) {
		return `${money(bid)} + ${+(FEES.premium * 100).toFixed(2)}% premium + ${money(FEES.lotFee)} lot fee` + (transferFee ? ` + ${money(transferFee)} transfer` : "") + `, then ${(FEES.salesTax * 100).toFixed(2)}% sales tax`;
	}
	var money = (n) => n.toLocaleString("en-US", {
		style: "currency",
		currency: "USD"
	});
	var dollars = (n) => n.toLocaleString("en-US", {
		style: "currency",
		currency: "USD",
		maximumFractionDigits: 0
	});
	var toasts = [];
	var nextId = 1;
	var { subscribe, emit } = emitter();
	function toast(kind, text, ms = kind === "bad" ? 8e3 : 4e3) {
		const id = nextId++;
		toasts = [...toasts, {
			id,
			kind,
			text
		}].slice(-4);
		emit();
		setTimeout(() => dismiss(id), ms);
	}
	function dismiss(id) {
		toasts = toasts.filter((t) => t.id !== id);
		emit();
	}
	function Toasts() {
		return u("div", {
			class: "toasts",
			role: "status",
			"aria-live": "polite",
			children: C(subscribe, () => toasts).map((t) => u("button", {
				type: "button",
				class: `toast toast-${t.kind}`,
				onClick: () => dismiss(t.id),
				title: "Dismiss",
				children: t.text
			}, t.id))
		});
	}
	var isClosed = (lot, now = Date.now()) => lot.status !== "live" || lot.endsAt <= now;
	var hasBidOn = (lot) => lot.hasBid || !!lot.yourStanding;
	var isLeading = (lot) => !!lot.yourStanding?.isLeading && lot.currentPrice <= (lot.yourStanding.yourMaxBid ?? Infinity);
	var quickBidAmount = (lot) => Math.max(lot.nextMinIncrement, lot.currentPrice);
	function minMaxBid(lot) {
		const min = quickBidAmount(lot);
		const mine = lot.yourStanding?.yourMaxBid;
		return isLeading(lot) && mine != null ? Math.max(mine + 1, min) : min;
	}
	function bidBlocker(row, now = Date.now()) {
		if (row.hidden) return "Bidding is disabled for hidden lots";
		if (row.matched) return `Bidding is disabled for filtered lots (${row.matched})`;
		if (isClosed(row.lot, now)) return "This lot has closed";
		if (!isAuthenticated()) return "Log in on the site to bid";
		return null;
	}
	var pending$1 = observableSet();
	var useBidPending = (lotId) => pending$1.useHas(lotId);
	async function submitBid({ lotId, amount, type }) {
		const lot = getLot(lotId);
		if (!lot || pending$1.has(lotId)) return false;
		if (isLeading(lot) && amount === lot.yourStanding?.yourMaxBid) {
			toast("info", "Your max bid is already set to this amount.");
			return false;
		}
		pending$1.add(lotId);
		try {
			const r = await placeBid(lotId, amount, type);
			const cur = getLot(lotId) ?? lot;
			const patch = {
				hasBid: true,
				yourStanding: {
					isLeading: r.isLeading,
					yourMaxBid: amount
				}
			};
			if (r.version != null && r.version > cur.version) {
				patch.version = r.version;
				patch.currentPrice = r.currentPrice ?? cur.currentPrice;
				patch.nextMinIncrement = r.minNextBid ?? cur.nextMinIncrement;
			}
			updateLot(lotId, patch, { force: true });
			invalidateDetail(lotId);
			const title = short(lot.title);
			if (r.isLeading) toast("good", `Bid placed – you’re winning “${title}”.`);
			else if (r.isMaxCollision) toast("bad", `Another bidder set this max bid first – you’re outbid on “${title}”.`);
			else toast("bad", `Bid placed, but you’re outbid on “${title}” – another bidder’s max is higher.`);
			return true;
		} catch (e) {
			const err = e instanceof BidError ? e : new BidError(e.message || String(e), 0);
			if (err.status === 409) updateLot(lotId, { status: "closed" }, { force: true });
			if (err.status === 422 && err.code === "bid_too_low" && err.minNextBid != null) updateLot(lotId, { nextMinIncrement: err.minNextBid }, { force: true });
			invalidateDetail(lotId);
			toast("bad", err.message);
			return false;
		} finally {
			pending$1.delete(lotId);
		}
	}
	var short = (s) => s.length > 60 ? `${s.slice(0, 57)}…` : s;
	var canWatch = (lot) => isAuthenticated() && !hasBidOn(lot);
	var pending = observableSet();
	var useWatchPending = (lotId) => pending.useHas(lotId);
	async function toggleWatch(lotId) {
		const lot = getLot(lotId);
		if (!lot || pending.has(lotId)) return;
		const on = !lot.isWatchlisted;
		pending.add(lotId);
		updateLot(lotId, { isWatchlisted: on }, { force: true });
		try {
			await setWatchlisted(lot.auctionPeriod, lotId, on);
		} catch (e) {
			updateLot(lotId, { isWatchlisted: !on }, { force: true });
			toast("bad", e.message);
		} finally {
			pending.delete(lotId);
		}
	}
	function TimeLeft({ endsAt }) {
		const { text, soon } = timeLabel(endsAt, useNow(1e3));
		return u("span", {
			class: `time ${soon ? "soon" : ""}`,
			title: new Date(endsAt).toLocaleString(),
			children: text
		});
	}
	function StandingBadge({ lot }) {
		if (lot.yourStanding?.isLeading) return u("span", {
			class: "pill pill-good",
			children: "Winning"
		});
		return hasBidOn(lot) ? u("span", {
			class: "pill pill-bad",
			children: "Outbid"
		}) : null;
	}
	function LocationText({ row }) {
		const name = row.lot.location?.name ?? "Unknown";
		if (row.pickupOnly) return u("span", {
			title: "Not transferable – pick up at this location",
			children: [name, " only"]
		});
		if (row.transferFee) return u("span", {
			title: `Transfer to your pickup location for ${money(row.transferFee)}`,
			children: [name, " · transfer"]
		});
		return u("span", { children: name });
	}
	function WatchStar({ lot }) {
		useAuthed();
		const pending = useWatchPending(lot.id);
		if (!canWatch(lot)) return lot.isWatchlisted ? u("span", {
			class: "pill pill-watch",
			title: "On your watchlist",
			children: u(Icon, {
				name: "star",
				size: 13
			})
		}) : null;
		const label = lot.isWatchlisted ? "Remove from watchlist" : "Add to watchlist";
		return u("button", {
			type: "button",
			class: `pill pill-watch watch-btn ${lot.isWatchlisted ? "on" : ""}`,
			title: label,
			"aria-label": label,
			"aria-pressed": lot.isWatchlisted,
			disabled: pending,
			onClick: () => void toggleWatch(lot.id),
			children: u(Icon, {
				name: lot.isWatchlisted ? "star" : "starBorder",
				size: 13
			})
		});
	}
	function WatchButton({ lot }) {
		useAuthed();
		const pending = useWatchPending(lot.id);
		if (!canWatch(lot)) return null;
		return u("button", {
			type: "button",
			class: "btn btn-text",
			"aria-pressed": lot.isWatchlisted,
			disabled: pending,
			onClick: () => void toggleWatch(lot.id),
			children: [
				u(Icon, { name: lot.isWatchlisted ? "star" : "starBorder" }),
				" ",
				lot.isWatchlisted ? "On watchlist" : "Add to watchlist"
			]
		});
	}
	var LotCard = N(function LotCard({ row, isNew, onOpen, onToggleHide, onBid }) {
		const { lot, matched, hidden } = row;
		const href = lotHref(lot.auctionPeriod, lot.id);
		const dim = !!matched || hidden;
		const img = lot.images[0];
		const open = openHandler(() => onOpen(lot));
		return u("article", {
			class: `card ${dim ? "dim" : ""}`,
			"data-lot": lot.id,
			children: [u("div", {
				class: "card-media",
				children: [
					u("a", {
						href,
						onClick: open,
						tabIndex: -1,
						"aria-hidden": "true",
						children: img ? u("img", {
							src: `${CDN}/${img.card}`,
							alt: "",
							loading: "lazy",
							decoding: "async"
						}) : u("span", {
							class: "noimg",
							children: "No image"
						})
					}),
					u("button", {
						type: "button",
						class: "icon-btn hide-btn",
						title: hidden ? "Unhide this lot" : "Hide this lot",
						"aria-label": hidden ? "Unhide this lot" : "Hide this lot",
						onClick: () => onToggleHide(lot),
						children: u(Icon, { name: hidden ? "visibility" : "visibilityOff" })
					}),
					u("div", {
						class: "media-tr",
						children: [
							isNew && u("span", {
								class: "pill pill-new",
								children: "New"
							}),
							row.others.length > 0 && u(DupeCount, {
								row,
								onOpen
							}),
							u(WatchStar, { lot }),
							u(StandingBadge, { lot })
						]
					}),
					(hidden || matched) && u("span", {
						class: "media-badge",
						children: hidden ? "Hidden" : `Filtered: ${matched}`
					})
				]
			}), u("div", {
				class: "card-body",
				children: [
					u("a", {
						class: "card-title",
						href,
						title: lot.title,
						onClick: open,
						children: lot.title
					}),
					u("div", {
						class: "card-meta",
						children: [u(LocationText, { row }), lot.condition && u("span", { children: lot.condition.label })]
					}),
					u("div", {
						class: "card-price",
						children: [u("span", {
							class: "price",
							children: dollars(lot.currentPrice)
						}), u("span", {
							class: "total",
							title: costBreakdown(lot.currentPrice, row.transferFee),
							children: [
								"≈ ",
								u("b", { children: money(row.total) }),
								" total"
							]
						})]
					}),
					u("div", {
						class: "card-sub",
						children: [lot.estimatedRetailPrice ? u("span", { children: [
							"Retail ",
							dollars(lot.estimatedRetailPrice),
							row.retailPct != null && u("span", {
								class: "muted",
								children: [
									" (",
									Math.round(row.retailPct * 100),
									"%)"
								]
							})
						] }) : u("span", {
							class: "muted",
							children: "No retail estimate"
						}), u("span", { children: plural(lot.bidCount, "bid") })]
					}),
					u("div", {
						class: "card-foot",
						children: [u(TimeLeft, { endsAt: lot.endsAt }), u(CardBidButton, {
							row,
							href,
							onOpen: () => onOpen(lot),
							onBid
						})]
					})
				]
			})]
		});
	});
	function DupeCount({ row, onOpen }) {
		const list = row.others.map((l) => `${dollars(l.currentPrice)} · ends ${shortTime(l.endsAt)}`).join("\n");
		return u("button", {
			type: "button",
			class: "pill pill-dupes",
			title: `${plural(row.others.length, "more identical listing")}:\n${list}`,
			onClick: () => onOpen(row.lot),
			children: [
				"+",
				row.others.length,
				" more"
			]
		});
	}
	function CardBidButton({ row, href, onOpen, onBid }) {
		const { lot } = row;
		const pending = useBidPending(lot.id);
		const authed = useAuthed();
		const blocker = bidBlocker(row);
		if (blocker && !authed && !row.hidden && !row.matched) return u("a", {
			class: "btn btn-small",
			href,
			target: "_blank",
			rel: "noopener",
			title: "Log in on Triangle Liquidators to bid here",
			children: ["Bid ", u(Icon, {
				name: "open",
				size: 14
			})]
		});
		if (blocker || pending) return u("span", {
			class: "btn btn-small",
			"aria-disabled": "true",
			title: blocker ?? void 0,
			children: blocker ? "Bid" : "Bidding…"
		});
		if (isLeading(lot)) return u("button", {
			type: "button",
			class: "btn btn-small btn-outline",
			onClick: onOpen,
			title: "Raise your max bid",
			children: "Raise max"
		});
		const amount = quickBidAmount(lot);
		return u("button", {
			type: "button",
			class: "btn btn-small",
			onClick: () => onBid({
				lotId: lot.id,
				amount,
				type: "next_increment"
			}),
			title: "Bid the next increment (asks to confirm)",
			children: ["Bid ", dollars(amount)]
		});
	}
	function BidConfirm({ req, row, pickup, onClose }) {
		const { lot } = row;
		const [amount, setAmount] = d(req.amount);
		const pending = useBidPending(lot.id);
		useAuthed();
		const now = useNow(1e3);
		const okBtn = A$1(null);
		useDialog(okBtn, (e) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				e.preventDefault();
				onClose();
			}
		}, true);
		const isMax = req.type === "max_bid";
		const blocker = bidBlocker(row, now);
		const min = isMax ? minMaxBid(lot) : quickBidAmount(lot);
		const stale = amount < min;
		const disabled = pending || !!blocker || stale;
		const elsewhere = lot.location?.name;
		const confirm = async () => {
			if (!disabled && await submitBid({
				...req,
				amount
			})) onClose();
		};
		return u("div", {
			class: "backdrop backdrop-top",
			onMouseDown: (e) => e.target === e.currentTarget && !pending && onClose(),
			children: u("div", {
				class: "confirm",
				role: "alertdialog",
				"aria-modal": "true",
				"aria-labelledby": "bid-confirm-title",
				"aria-describedby": "bid-confirm-body",
				children: [
					u("h2", {
						id: "bid-confirm-title",
						children: isMax ? "Confirm max bid" : "Confirm bid"
					}),
					u("div", {
						id: "bid-confirm-body",
						class: "confirm-body",
						children: [
							u("p", {
								class: "confirm-lot",
								children: lot.title
							}),
							u("div", {
								class: "confirm-amount",
								children: [u("span", {
									class: "big",
									children: dollars(amount)
								}), u("span", {
									class: "muted small",
									children: isMax ? "Max bid – the site bids for you, only as much as needed, up to this amount" : "Bid at the next increment"
								})]
							}),
							u("dl", {
								class: "confirm-facts",
								children: [
									u("dt", { children: isMax ? "Total if you win at your max" : "Total if you win at this bid" }),
									u("dd", {
										title: costBreakdown(amount, row.transferFee),
										children: ["≈ ", money(totalCost(amount, row.transferFee))]
									}),
									u("dt", { children: "Current bid" }),
									u("dd", { children: [
										dollars(lot.currentPrice),
										" · ",
										plural(lot.bidCount, "bid")
									] }),
									u("dt", { children: "Ends" }),
									u("dd", { children: u(TimeLeft, { endsAt: lot.endsAt }) }),
									lot.yourStanding?.yourMaxBid != null && u(S, { children: [u("dt", { children: "Your current max" }), u("dd", { children: dollars(lot.yourStanding.yourMaxBid) })] })
								]
							}),
							row.pickupOnly && u("p", {
								class: "confirm-warn",
								children: [
									"Pickup only at ",
									u("b", { children: elsewhere }),
									" – this lot can’t be transferred to ",
									pickup,
									"."
								]
							}),
							!row.pickupOnly && row.transferFee > 0 && u("p", {
								class: "confirm-warn",
								children: [
									"This lot is at ",
									u("b", { children: elsewhere }),
									". It will be transferred to ",
									pickup,
									" for ",
									money(row.transferFee),
									" (included in the total)."
								]
							}),
							blocker && u("p", {
								class: "error",
								children: blocker
							}),
							!blocker && stale && u("p", {
								class: "confirm-warn",
								children: [
									"The price moved: the ",
									isMax ? "smallest max bid" : "next bid",
									" is now ",
									u("b", { children: dollars(min) }),
									".",
									" ",
									u("button", {
										type: "button",
										class: "btn-text",
										onClick: () => setAmount(min),
										children: ["Use ", dollars(min)]
									})
								]
							})
						]
					}),
					u("div", {
						class: "confirm-actions",
						children: [u("button", {
							type: "button",
							class: "btn btn-outline",
							onClick: onClose,
							disabled: pending,
							children: "Cancel"
						}), u("button", {
							type: "button",
							class: "btn",
							ref: okBtn,
							onClick: confirm,
							"aria-disabled": disabled ? "true" : void 0,
							children: pending ? "Placing bid…" : `Place ${dollars(amount)} bid`
						})]
					})
				]
			})
		});
	}
	function LotModal({ row, onClose, onToggleHide, onBid, group, onOpenLot }) {
		const { lot } = row;
		const [detail, setDetail] = d(() => cachedDetail(lot.id) ?? null);
		const [error, setError] = d(null);
		const [imgIdx, setImgIdx] = d(0);
		const dialog = A$1(null);
		h(() => {
			const ac = new AbortController();
			setError(null);
			loadDetail(lot, ac.signal).then(setDetail, (e) => {
				if (!ac.signal.aborted) setError(e.message || String(e));
			});
			return () => ac.abort();
		}, [
			lot.id,
			lot.yourStanding?.yourMaxBid,
			lot.yourStanding?.isLeading
		]);
		const images = (detail ?? lot).images;
		const img = images[Math.min(imgIdx, images.length - 1)];
		const step = (delta) => setImgIdx((i) => (i + delta + images.length) % Math.max(images.length, 1));
		useDialog(dialog, (e) => {
			const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
			if (e.key === "Escape") onClose();
			else if (!typing && e.key === "ArrowLeft") step(-1);
			else if (!typing && e.key === "ArrowRight") step(1);
		});
		h(() => {
			document.body.classList.add("modal-open");
			return () => document.body.classList.remove("modal-open");
		}, []);
		return u("div", {
			class: "backdrop",
			onMouseDown: (e) => e.target === e.currentTarget && onClose(),
			children: u("div", {
				class: "modal",
				role: "dialog",
				"aria-modal": "true",
				"aria-labelledby": "lot-title",
				tabIndex: -1,
				ref: dialog,
				children: [u("button", {
					type: "button",
					class: "icon-btn modal-close",
					"aria-label": "Close",
					onClick: onClose,
					children: u(Icon, {
						name: "close",
						size: 22
					})
				}), u("div", {
					class: "modal-grid",
					children: [u("div", {
						class: "gallery",
						children: [u("div", {
							class: "gallery-main",
							children: [img ? u("img", {
								src: `${CDN}/${img.large}`,
								alt: ""
							}) : u("span", {
								class: "noimg",
								children: "No image"
							}), images.length > 1 && u(S, { children: [u("button", {
								type: "button",
								class: "icon-btn gal-prev",
								"aria-label": "Previous image",
								onClick: () => step(-1),
								children: u(Icon, {
									name: "chevronLeft",
									size: 24
								})
							}), u("button", {
								type: "button",
								class: "icon-btn gal-next",
								"aria-label": "Next image",
								onClick: () => step(1),
								children: u(Icon, {
									name: "chevronRight",
									size: 24
								})
							})] })]
						}), images.length > 1 && u("div", {
							class: "thumbs",
							children: images.map((im, i) => u("button", {
								type: "button",
								class: i === imgIdx ? "on" : "",
								"aria-label": `Image ${i + 1}`,
								onClick: () => setImgIdx(i),
								children: u("img", {
									src: `https://cdn.triangleliquidators.com/${im.thumb}`,
									alt: "",
									loading: "lazy"
								})
							}))
						})]
					}), u("div", {
						class: "modal-info",
						children: [
							u("h2", {
								id: "lot-title",
								children: lot.title
							}),
							u("div", {
								class: "card-meta",
								children: [
									u(LocationText, { row }),
									lot.condition && u("span", { children: lot.condition.label }),
									row.category && u("span", { children: row.category.label }),
									u("span", { children: ["Lot #", lot.lotNumber] })
								]
							}),
							u("div", {
								class: "modal-price",
								children: [
									u("div", { children: [u("div", {
										class: "price big",
										children: dollars(lot.currentPrice)
									}), u("div", {
										class: "muted small",
										children: ["Current bid · ", plural(lot.bidCount, "bid")]
									})] }),
									u("div", { children: [u("div", {
										class: "total big",
										title: costBreakdown(lot.currentPrice, row.transferFee),
										children: ["≈ ", money(row.total)]
									}), u("div", {
										class: "muted small",
										children: "Estimated total"
									})] }),
									u("div", { children: [u("div", {
										class: "big",
										children: u(TimeLeft, { endsAt: lot.endsAt })
									}), u("div", {
										class: "muted small",
										children: shortTime(lot.endsAt)
									})] })
								]
							}),
							u("div", {
								class: "row-gap",
								children: [
									u(StandingBadge, { lot }),
									lot.yourStanding?.yourMaxBid != null && u("span", {
										class: "muted small",
										children: ["Your max bid ", dollars(lot.yourStanding.yourMaxBid)]
									}),
									lot.estimatedRetailPrice != null && u("span", {
										class: "muted small",
										children: [
											"Retail ",
											dollars(lot.estimatedRetailPrice),
											row.retailPct != null && ` (${Math.round(row.retailPct * 100)}%)`
										]
									}),
									u("span", {
										class: "muted small",
										children: ["Next min bid ", dollars(lot.nextMinIncrement)]
									})
								]
							}),
							u(BidPanel, {
								row,
								onBid
							}),
							u("div", {
								class: "row-gap",
								children: [
									u("a", {
										class: "btn btn-text",
										href: lotHref(lot.auctionPeriod, lot.id),
										target: "_blank",
										rel: "noopener",
										children: ["Open on Triangle Liquidators ", u(Icon, {
											name: "open",
											size: 16
										})]
									}),
									u(WatchButton, { lot }),
									u("button", {
										type: "button",
										class: "btn btn-text",
										onClick: onToggleHide,
										children: [
											u(Icon, { name: row.hidden ? "visibility" : "visibilityOff" }),
											" ",
											row.hidden ? "Unhide" : "Hide"
										]
									})
								]
							}),
							group && group.length > 1 && onOpenLot && u(SameListings, {
								group,
								current: lot.id,
								onOpen: onOpenLot
							}),
							error && u("p", {
								class: "error",
								children: ["Couldn’t load lot details: ", error]
							}),
							!detail && !error && u("p", {
								class: "muted",
								children: "Loading details…"
							}),
							detail && u(S, { children: [
								(detail.brand || detail.model) && u("p", {
									class: "small",
									children: [detail.brand && `Brand: ${detail.brand}`, detail.model && `Model: ${detail.model}`].filter(Boolean).join(" · ")
								}),
								detail.description && u("div", {
									class: "description",
									children: detail.description
								}),
								detail.bidHistory.length > 0 && u("div", { children: [u("h3", { children: "Bid history" }), u("ol", {
									class: "bids",
									children: detail.bidHistory.map((b) => u("li", {
										class: b.isYou ? "you" : "",
										children: [u("span", { children: b.isYou ? "You" : b.bidderLabel }), u("span", { children: dollars(b.amount) })]
									}))
								})] })
							] })
						]
					})]
				})]
			})
		});
	}
	function SameListings({ group, current, onOpen }) {
		return u("div", { children: [u("h3", { children: [fmtCount(group.length), " identical listings"] }), u("ol", {
			class: "dupes",
			children: group.map((l) => u("li", { children: u("button", {
				type: "button",
				class: l.id === current ? "on" : "",
				"aria-current": l.id === current ? "true" : void 0,
				onClick: () => onOpen(l),
				children: [
					u("span", {
						class: "price",
						children: dollars(l.currentPrice)
					}),
					u("span", {
						class: "muted small",
						children: [
							plural(l.bidCount, "bid"),
							" · Lot #",
							l.lotNumber
						]
					}),
					u(TimeLeft, { endsAt: l.endsAt })
				]
			}) }))
		})] });
	}
	function BidPanel({ row, onBid }) {
		const { lot } = row;
		const now = useNow(1e3);
		const pending = useBidPending(lot.id);
		const authed = useAuthed();
		const [value, setValue] = d("");
		h(() => setValue(""), [lot.id, lot.yourStanding?.yourMaxBid]);
		const blocker = bidBlocker(row, now);
		if (blocker) return u("div", {
			class: "bid-panel",
			children: !authed ? u("span", {
				class: "muted",
				children: [u("a", {
					href: "/",
					target: "_blank",
					rel: "noopener",
					children: "Log in on Triangle Liquidators"
				}), " to bid here."]
			}) : u("span", {
				class: "btn",
				"aria-disabled": "true",
				children: blocker
			})
		});
		const leading = isLeading(lot);
		const min = minMaxBid(lot);
		const quick = quickBidAmount(lot);
		const n = parseNum(value);
		const error = maxBidError(value, n, min);
		const submit = (e) => {
			e.preventDefault();
			if (n != null && !error && !pending) onBid({
				lotId: lot.id,
				amount: n,
				type: "max_bid"
			});
		};
		return u("form", {
			class: "bid-panel",
			onSubmit: submit,
			noValidate: true,
			children: [u("div", {
				class: "bid-row",
				children: [
					u("label", {
						class: `bid-input ${error ? "has-error" : ""}`,
						children: [u("span", {
							"aria-hidden": "true",
							children: "$"
						}), u("input", {
							type: "text",
							inputMode: "numeric",
							"aria-label": "Max bid amount",
							placeholder: `${min} or more`,
							value,
							onInput: (e) => setValue(e.currentTarget.value)
						})]
					}),
					u("button", {
						type: "submit",
						class: "btn",
						"aria-disabled": n == null || !!error || pending ? "true" : void 0,
						children: leading ? "Raise max bid" : "Set max bid"
					}),
					!leading && u("button", {
						type: "button",
						class: "btn btn-outline",
						disabled: pending,
						onClick: () => onBid({
							lotId: lot.id,
							amount: quick,
							type: "next_increment"
						}),
						title: "Bid the next increment now",
						children: ["Bid ", dollars(quick)]
					})
				]
			}), u("div", {
				class: `small ${error ? "error" : "muted"}`,
				children: pending ? "Placing bid…" : error || (leading ? `You’re winning. Raise your max to ${dollars(min)} or more.` : "A max bid bids for you automatically, only as much as needed to keep you winning.")
			})]
		});
	}
	function maxBidError(text, n, min) {
		if (!text.trim()) return null;
		if (n == null) return "Enter a dollar amount";
		if (!Number.isInteger(n)) return "Whole dollars only";
		return n < min ? `Must be at least ${dollars(min)}` : null;
	}
	function compileFilter(pattern) {
		try {
			return new RegExp(`\\b(?:${pattern})\\b`, "i");
		} catch {
			return null;
		}
	}
	function buildRegexes(words) {
		return words.filter((w) => w.trim()).map((w) => ({
			word: w,
			re: compileFilter(w)
		}));
	}
	function firstMatch(filters, title) {
		return filters.find(({ re }) => re?.test(title))?.word ?? null;
	}
	function splitFilters(text) {
		const out = [];
		let cur = "";
		let depth = 0;
		let inClass = false;
		let escaped = false;
		for (const ch of text) {
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (inClass) inClass = ch !== "]";
			else if (ch === "[") inClass = true;
			else if (ch === "," && depth === 0) {
				out.push(cur);
				cur = "";
				continue;
			} else if (ch === "(" || ch === "{") depth++;
			else if ((ch === ")" || ch === "}") && depth > 0) depth--;
			cur += ch;
		}
		out.push(cur);
		return [...new Set(out.map((s) => s.trim()).filter(Boolean))];
	}
	var collator = new Intl.Collator(void 0, {
		numeric: true,
		sensitivity: "base"
	});
	var SORT_ONE = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[- ]\d+\/\d+|\/\d+)?`;
	var SORT_NUM = String.raw`${SORT_ONE}(?:\s*[-–]\s*${SORT_ONE})?`;
	var SORT_UNIT = [
		String.raw`in(?:ch(?:es)?)?(?!\s*-|\s+\d)\.?`,
		String.raw`ft\.?|feet|foot|yds?\.?|yards?|mm|cm|mil|ga\.?|gauge|awg`,
		String.raw`gal(?:lons?)?\.?|qts?\.?|quarts?|pints?|pt\.?|cups?|fl\.? ?oz\.?|oz\.?|lbs?\.?|pounds?|kg|tons?|ml|l|liters?|litres?|cc`,
		String.raw`(?:cu|sq)\.? ?(?:ft|in|yd)\.?`,
		String.raw`v|volts?|w|watts?|kw|amps?|a|ah|mah|wh|btus?|psi|gpm|cfm|mph|hp|lm|lumens?`,
		String.raw`[mg]bps|[gkm]?hz|rpm|db|deg(?:rees?)?|°|%`,
		String.raw`pcs?\.?|pieces?|pk|packs?|count|ct|pairs?|tiers?|panels?|channels?`
	].join("|");
	var SORT_HYPHEN_UNIT = String.raw`(?:light|bulb|gang|outlet|port|drawer|shelf|shelves|cube|seat|person|burner|speed|blade|tool|bottle|door|zone|way|step|cutter|cycle|stroke|handle|row|tooth|teeth)s?`;
	var SORT_MARK = String.raw`(?:"|''|”|″|'|′)`;
	var SORT_MEASURE = String.raw`${SORT_NUM}\s*(?:${SORT_MARK}|-?\s*(?:${SORT_UNIT}))?`;
	var SORT_LEAD = new RegExp("^(?:" + [
		String.raw`[(\[][^)\]]*[)\]]`,
		String.raw`(?:set|pack|box|case|lot)\s+of\s+\d+`,
		`${SORT_MEASURE}(?:\\s*[x×]\\s*${SORT_MEASURE})+(?=[\\s,.)/]|$)`,
		`${SORT_NUM}\\s*${SORT_MARK}`,
		`${SORT_NUM}-${SORT_HYPHEN_UNIT}(?=[\\s,.)/]|$)`,
		`${SORT_NUM}[\\s-]?(?:${SORT_UNIT})(?=[\\s,.)/x×]|$)`,
		`${SORT_NUM}\\s*[x×](?=\\s*\\d)`
	].join("|") + ")", "iu");
	var SORT_SEP = /^[x×]\s*(?=\d)/i;
	function sortKey(title) {
		let rest = title.trim();
		const moved = [];
		for (let i = 0; i < 12; i++) {
			const m = rest.match(SORT_LEAD) || (moved.length ? rest.match(SORT_SEP) : null);
			if (!m?.[0]) break;
			moved.push(m[0].trim());
			rest = rest.slice(m[0].length).replace(/^[\s,;:/–—-]+/, "");
		}
		return (rest ? moved.length ? `${rest} ${moved.join(" ")}` : rest : title).replace(/^[^\p{L}\p{N}]+/u, "");
	}
	var SORTS = {
		"ending-soonest": {
			label: "Ending soonest",
			compare: () => 0
		},
		"newly-listed": {
			label: "Newly listed",
			compare: (a, b) => b.lot.id - a.lot.id
		},
		"title-asc": {
			label: "Title A–Z",
			compare: (a, b) => collator.compare(titleKey(a.lot.title), titleKey(b.lot.title))
		},
		"title-desc": {
			label: "Title Z–A",
			compare: (a, b) => collator.compare(titleKey(b.lot.title), titleKey(a.lot.title))
		},
		"total-asc": {
			label: "Total cost: low to high",
			compare: (a, b) => a.total - b.total
		},
		"total-desc": {
			label: "Total cost: high to low",
			compare: (a, b) => b.total - a.total
		},
		"retail-pct-asc": {
			label: "Best deal (% of retail)",
			compare: (a, b) => (a.retailPct ?? Infinity) - (b.retailPct ?? Infinity)
		},
		"retail-desc": {
			label: "Retail price: high to low",
			compare: (a, b) => (b.lot.estimatedRetailPrice ?? -1) - (a.lot.estimatedRetailPrice ?? -1)
		},
		"bids-most": {
			label: "Most bids",
			compare: (a, b) => b.lot.bidCount - a.lot.bidCount
		},
		"bids-fewest": {
			label: "Fewest bids",
			compare: (a, b) => a.lot.bidCount - b.lot.bidCount
		}
	};
	function nextHours(h) {
		return (now) => [now, now + h * HOUR];
	}
	function day(offset) {
		return (now) => {
			const d = new Date(now);
			d.setHours(0, 0, 0, 0);
			d.setDate(d.getDate() + offset);
			const start = d.getTime();
			d.setDate(d.getDate() + 1);
			return [Math.max(start, now), d.getTime()];
		};
	}
	var ENDING = {
		"": {
			label: "Any time",
			window: null
		},
		"1h": {
			label: "Within 1 hour",
			window: nextHours(1)
		},
		"3h": {
			label: "Within 3 hours",
			window: nextHours(3)
		},
		today: {
			label: "Today",
			window: day(0)
		},
		tomorrow: {
			label: "Tomorrow",
			window: day(1)
		}
	};
	var MINE = {
		"": {
			label: "All lots",
			test: () => true
		},
		bid: {
			label: "Lots I bid on",
			test: hasBidOn
		},
		leading: {
			label: "I’m winning",
			test: (l) => !!l.yourStanding?.isLeading
		},
		outbid: {
			label: "I’m outbid",
			test: (l) => hasBidOn(l) && !l.yourStanding?.isLeading
		},
		watch: {
			label: "Watchlist",
			test: (l) => l.isWatchlisted
		}
	};
	var DEFAULT_VIEW = {
		sort: "ending-soonest",
		search: "",
		categories: [],
		conditions: [],
		locations: [],
		reachable: false,
		priceMin: null,
		priceMax: null,
		totalMax: null,
		retailMin: null,
		ending: "",
		mine: "",
		newSince: null
	};
	function normalizeView(v) {
		const view = {
			...DEFAULT_VIEW,
			...v && typeof v === "object" ? v : {}
		};
		return {
			...view,
			sort: Object.hasOwn(SORTS, view.sort) ? view.sort : DEFAULT_VIEW.sort,
			ending: Object.hasOwn(ENDING, view.ending) ? view.ending : DEFAULT_VIEW.ending,
			mine: Object.hasOwn(MINE, view.mine) ? view.mine : DEFAULT_VIEW.mine
		};
	}
	var activeFilterCount = (v) => [
		v.search.trim(),
		v.categories.length,
		v.conditions.length,
		v.locations.length,
		v.reachable,
		v.priceMin != null || v.priceMax != null,
		v.totalMax != null,
		v.retailMin != null,
		v.ending,
		v.mine,
		v.newSince != null
	].filter(Boolean).length;
	var sortKeys = new Map();
	function titleKey(title) {
		let key = sortKeys.get(title);
		if (key === void 0) {
			key = sortKey(title);
			sortKeys.set(title, key);
		}
		return key;
	}
	var regexCache = null;
	function compiledFilters(words) {
		if (regexCache?.words !== words) regexCache = {
			words,
			compiled: buildRegexes(words)
		};
		return regexCache.compiled;
	}
	var CUSTOM_PREFIX = "custom:";
	var customCategoryValue = (name) => CUSTOM_PREFIX + name;
	var categoryCache = null;
	function categoryOf(lot, cats) {
		if (categoryCache?.cats !== cats) categoryCache = {
			cats,
			compiled: cats.map((c) => ({
				category: {
					value: customCategoryValue(c.name),
					label: c.name
				},
				re: compileFilter(c.pattern)
			}))
		};
		return categoryCache.compiled.find(({ re }) => re?.test(lot.title))?.category ?? lot.category;
	}
	function makeRow(lot, pickup, ex) {
		const elsewhere = !!lot.location && lot.location.name !== pickup;
		const transferFee = elsewhere && lot.isTransferable ? lot.transferFee : 0;
		return {
			lot,
			category: categoryOf(lot, ex.customCategories),
			transferFee,
			pickupOnly: elsewhere && !lot.isTransferable,
			total: totalCost(lot.currentPrice, transferFee),
			retailPct: lot.estimatedRetailPrice ? lot.currentPrice / lot.estimatedRetailPrice : null,
			matched: ex.filterOn ? firstMatch(compiledFilters(ex.words), lot.title) : null,
			hidden: !!ex.hidden[lot.id],
			others: []
		};
	}
	function computeView(lots, view, pickup, ex, now) {
		const matches = makeMatcher(view, now);
		const matchCounts = new Map(ex.words.map((w) => [w, 0]));
		const compiled = compiledFilters(ex.words);
		const rows = [];
		let open = 0;
		let removed = 0;
		let filteredOut = 0;
		for (const lot of lots) {
			if (lot.endsAt <= now) continue;
			open++;
			for (const { word, re } of compiled) if (re?.test(lot.title)) matchCounts.set(word, matchCounts.get(word) + 1);
			const row = makeRow(lot, pickup, ex);
			if (row.hidden && !ex.showHidden || row.matched && ex.removeFiltered) removed++;
			else if (!matches(row)) filteredOut++;
			else rows.push(row);
		}
		const { cards, groups } = combineDuplicates(rows);
		const compare = SORTS[view.sort].compare;
		cards.sort((a, b) => compare(a, b) || a.lot.endsAt - b.lot.endsAt || a.lot.id - b.lot.id);
		return {
			rows: cards,
			open,
			removed,
			filteredOut,
			matchCounts,
			combined: rows.length - cards.length,
			groups
		};
	}
	var byPrice = (a, b) => a.currentPrice - b.currentPrice || a.endsAt - b.endsAt || a.id - b.id;
	function combineDuplicates(rows) {
		const ownCard = (row) => hasBidOn(row.lot) || row.hidden || !!row.matched;
		const cards = rows.filter(ownCard);
		const groups = new Map();
		const buckets = Map.groupBy(rows.filter((row) => !ownCard(row)), ({ lot }) => `${lot.title.trim().toLowerCase()}\u0000${lot.condition?.value ?? ""}\u0000${lot.location?.name ?? ""}`);
		for (const bucket of buckets.values()) {
			if (bucket.length === 1) {
				cards.push(bucket[0]);
				continue;
			}
			bucket.sort((a, b) => byPrice(a.lot, b.lot));
			const lots = bucket.map((r) => r.lot);
			cards.push({
				...bucket[0],
				others: lots.slice(1)
			});
			lots.forEach((l) => groups.set(l.id, lots));
		}
		return {
			cards,
			groups
		};
	}
	function oneOf(selected) {
		const set = new Set(selected);
		return (value) => !set.size || set.has(value);
	}
	function makeMatcher(v, now) {
		const terms = v.search.toLowerCase().split(/\s+/).filter(Boolean);
		const win = ENDING[v.ending].window?.(now);
		const category = oneOf(v.categories);
		const condition = oneOf(v.conditions);
		const location = oneOf(v.locations);
		const mine = MINE[v.mine].test;
		const searchMatches = (lot) => {
			const hay = `${lot.title} ${lot.lotNumber}`.toLowerCase();
			return terms.every((t) => hay.includes(t));
		};
		return ({ lot, category: cat, total, pickupOnly }) => (v.newSince == null || (lot.firstSeenAt ?? 0) > v.newSince) && (!terms.length || searchMatches(lot)) && category(cat?.value ?? "") && condition(lot.condition?.value ?? -1) && location(lot.location?.name ?? "") && !(v.reachable && pickupOnly) && (v.priceMin == null || lot.currentPrice >= v.priceMin) && (v.priceMax == null || lot.currentPrice <= v.priceMax) && (v.totalMax == null || total <= v.totalMax) && (v.retailMin == null || (lot.estimatedRetailPrice ?? 0) >= v.retailMin) && (!win || lot.endsAt >= win[0] && lot.endsAt < win[1]) && mine(lot);
	}
	function tally(items) {
		const groups = Map.groupBy(items.filter((i) => i != null), (i) => i.value);
		return Array.from(groups.values(), (g) => ({
			value: g[0].value,
			label: g[0].label,
			count: g.length
		}));
	}
	function computeFacets(lots, now, customCategories) {
		const open = Array.from(lots).filter((l) => l.endsAt > now);
		return {
			categories: tally(open.map((l) => categoryOf(l, customCategories))).sort((a, b) => a.label.localeCompare(b.label)),
			conditions: tally(open.map((l) => l.condition)).sort((a, b) => a.value - b.value),
			locations: tally(open.map((l) => l.location && {
				value: l.location.name,
				label: l.location.name
			})).sort((a, b) => b.count - a.count)
		};
	}
	var savedFilters = ({ newSince, ...rest }) => rest;
	function sameFilters(a, b) {
		const strip = ({ sort, ...rest }) => rest;
		return JSON.stringify(strip(savedFilters(a))) === JSON.stringify(strip(savedFilters(normalizeView(b))));
	}
	function suggestName(v, facets) {
		return [
			v.search.trim(),
			...v.categories.map((c) => facets.categories.find((f) => f.value === c)?.label ?? c),
			v.locations.join("/"),
			v.priceMax != null && `≤ $${v.priceMax}`,
			v.totalMax != null && `total ≤ $${v.totalMax}`
		].filter(Boolean).join(" · ") || "Saved search";
	}
	function savedSearchStats(lots, searches, pickup, ex, now) {
		const matchers = searches.map((s) => ({
			s,
			matches: makeMatcher(normalizeView(s.view), now),
			stats: {
				total: 0,
				fresh: 0
			}
		}));
		for (const lot of lots) {
			if (lot.endsAt <= now) continue;
			const row = makeRow(lot, pickup, ex);
			if (row.hidden || row.matched) continue;
			for (const { s, matches, stats } of matchers) if (matches(row)) {
				stats.total++;
				if ((lot.firstSeenAt ?? 0) > s.lastViewedAt) stats.fresh++;
			}
		}
		return new Map(matchers.map(({ s, stats }) => [s.id, stats]));
	}
	function Sidebar(props) {
		return u("div", {
			class: "sidebar-inner",
			children: [
				u(SavedSearchesSection, { ...props.saved }),
				u(FiltersSection, { ...props }),
				u(HideFilterSection, {
					matchCounts: props.matchCounts,
					onOpenHidden: props.onOpenHidden
				}),
				u(SettingsSection, {
					pickup: props.pickup,
					accountPickup: props.accountPickup,
					locations: props.facets.locations.map((l) => l.value)
				})
			]
		});
	}
	function Collapsible({ id, title, children }) {
		const [collapsed, setCollapsed] = useSetting(KEYS.collapsed);
		const open = !collapsed?.[id];
		return u("div", {
			class: "collapsible",
			children: [u("button", {
				type: "button",
				class: "collapse-head",
				"aria-expanded": open,
				onClick: () => setCollapsed({
					...collapsed,
					[id]: open
				}),
				children: [u("span", { children: title }), u(Icon, {
					name: "expandMore",
					size: 20
				})]
			}), open && u("div", {
				class: "collapse-body",
				children
			})]
		});
	}
	function CheckList({ facets, selected, onChange }) {
		const toggle = (v) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
		return u(S, { children: facets.map((f) => u("label", {
			class: "check",
			children: [
				u("input", {
					type: "checkbox",
					checked: selected.includes(f.value),
					onChange: () => toggle(f.value)
				}),
				u("span", { children: f.label }),
				u("span", {
					class: "count",
					children: fmtCount(f.count)
				})
			]
		})) });
	}
	function NumberInput({ label, value, parse, onChange, ...input }) {
		const format = (v) => v == null ? "" : String(v);
		const [text, setText] = d(format(value));
		h(() => setText(format(value)), [value]);
		const commit = () => {
			const v = parse(text);
			setText(format(v));
			if (v !== value) onChange(v);
		};
		return u("label", {
			class: "field",
			children: [u("span", { children: label }), u("input", {
				...input,
				value: text,
				onInput: (e) => setText(e.currentTarget.value),
				onBlur: commit,
				onKeyDown: (e) => e.key === "Enter" && commit()
			})]
		});
	}
	function PriceField(props) {
		return u(NumberInput, {
			...props,
			parse: parseNum,
			type: "text",
			inputMode: "decimal",
			placeholder: "$"
		});
	}
	function FiltersSection({ view, setView, facets, pickup, authed }) {
		const n = activeFilterCount(view);
		return u("section", {
			class: "panel",
			children: [
				u("div", {
					class: "panel-head",
					children: [u("h2", { children: "Filters" }), n > 0 && u("button", {
						type: "button",
						class: "btn-text",
						onClick: () => setView({
							...DEFAULT_VIEW,
							sort: view.sort
						}),
						children: [
							"Clear (",
							n,
							")"
						]
					})]
				}),
				u("label", {
					class: "field",
					children: [u("span", { children: "My lots" }), u("select", {
						value: view.mine,
						onChange: (e) => setView({ mine: e.currentTarget.value }),
						children: Object.entries(MINE).map(([k, { label }]) => u("option", {
							value: k,
							disabled: !!k && !authed,
							children: label
						}))
					})]
				}),
				u("label", {
					class: "field",
					children: [u("span", { children: "Ending" }), u("select", {
						value: view.ending,
						onChange: (e) => setView({ ending: e.currentTarget.value }),
						children: Object.entries(ENDING).map(([k, { label }]) => u("option", {
							value: k,
							children: label
						}))
					})]
				}),
				u(Collapsible, {
					id: "f-location",
					title: "Location",
					children: [u(CheckList, {
						facets: facets.locations,
						selected: view.locations,
						onChange: (locations) => setView({ locations })
					}), u("label", {
						class: "check",
						children: [u("input", {
							type: "checkbox",
							checked: view.reachable,
							onChange: () => setView({ reachable: !view.reachable })
						}), u("span", { children: [
							"Available at ",
							pickup,
							" (incl. transfers)"
						] })]
					})]
				}),
				u(Collapsible, {
					id: "f-category",
					title: "Category",
					children: [u(CheckList, {
						facets: facets.categories,
						selected: view.categories,
						onChange: (categories) => setView({ categories })
					}), u(CustomCategories, {
						view,
						setView,
						facets
					})]
				}),
				u(Collapsible, {
					id: "f-condition",
					title: "Condition",
					children: u(CheckList, {
						facets: facets.conditions,
						selected: view.conditions,
						onChange: (conditions) => setView({ conditions })
					})
				}),
				u(Collapsible, {
					id: "f-price",
					title: "Price",
					children: [u("div", {
						class: "field-row",
						children: [u(PriceField, {
							label: "Bid min",
							value: view.priceMin,
							onChange: (priceMin) => setView({ priceMin })
						}), u(PriceField, {
							label: "Bid max",
							value: view.priceMax,
							onChange: (priceMax) => setView({ priceMax })
						})]
					}), u("div", {
						class: "field-row",
						children: [u(PriceField, {
							label: "Max est. total",
							value: view.totalMax,
							onChange: (totalMax) => setView({ totalMax })
						}), u(PriceField, {
							label: "Min retail",
							value: view.retailMin,
							onChange: (retailMin) => setView({ retailMin })
						})]
					})]
				})
			]
		});
	}
	function useInlineEdit() {
		const [editing, setEditing] = d(null);
		const [text, setText] = d("");
		const [error, setError] = d(null);
		const box = A$1(null);
		const open = A$1(null);
		h(() => {
			if (editing != null) box.current?.select();
		}, [editing]);
		const start = (id, initial) => {
			open.current = id;
			setEditing(id);
			setText(initial);
			setError(null);
		};
		const close = () => {
			open.current = null;
			setEditing(null);
			setError(null);
		};
		const save = (id, onSave) => {
			if (open.current !== id) return;
			const next = text.trim();
			const err = next ? onSave(next) : void 0;
			if (err) setError(err);
			else close();
		};
		const boxProps = (id, onSave) => ({
			ref: box,
			value: text,
			onInput: (e) => {
				setText(e.currentTarget.value.replace(/\n/g, ""));
				setError(null);
			},
			onKeyDown: (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					save(id, onSave);
				} else if (e.key === "Escape") {
					e.preventDefault();
					e.stopPropagation();
					close();
				}
			},
			onBlur: () => save(id, onSave)
		});
		return {
			editing,
			text,
			error,
			start,
			save,
			boxProps
		};
	}
	function PatternText({ pattern }) {
		const parts = pattern.split("|");
		return u("span", {
			class: "pattern",
			children: parts.map((p, i) => u("span", {
				class: "seg",
				children: i < parts.length - 1 ? `${p}|` : p
			}))
		});
	}
	function FilterRow({ label, pattern, count, onRemove, onSave }) {
		const edit = useInlineEdit();
		const editing = edit.editing != null;
		const ok = !!compileFilter(pattern);
		const save = (next) => {
			if (next === pattern) return;
			if (!compileFilter(next)) return "Invalid regex";
			onSave(next);
		};
		return u("li", {
			class: `filter-row ${ok ? "" : "filter-error"}`,
			children: [
				u("button", {
					type: "button",
					class: "filter-remove",
					"aria-label": `Remove ${label ?? pattern}`,
					title: label ? "Remove category" : "Remove filter",
					onClick: onRemove,
					children: u(Icon, {
						name: "cancel",
						size: 16
					})
				}),
				label && u("span", {
					class: "filter-label",
					children: label
				}),
				editing ? u("div", {
					class: "filter-edit",
					children: [u("textarea", {
						class: edit.error ? "has-error" : "",
						"aria-label": "Edit filter regex",
						spellcheck: false,
						rows: Math.min(6, Math.max(1, Math.ceil(edit.text.length / 26))),
						...edit.boxProps("pattern", save)
					}), u("span", {
						class: edit.error ? "error small" : "muted small",
						children: edit.error ?? "Enter to save · Esc to cancel"
					})]
				}) : u("button", {
					type: "button",
					class: "filter-pattern",
					title: ok ? `/\\b(?:${pattern})\\b/i – click to edit` : "Invalid regex – ignored. Click to edit",
					onClick: () => edit.start("pattern", pattern),
					children: u(PatternText, { pattern })
				}),
				ok && !editing && u("span", {
					class: "count",
					children: fmtCount(count)
				})
			]
		});
	}
	function CustomCategories({ view, setView, facets }) {
		const [cats, setCats] = useSetting(KEYS.customCategories);
		const [name, setName] = d("");
		const [pattern, setPattern] = d("");
		const [err, setErr] = d(null);
		const count = (n) => facets.categories.find((f) => f.value === customCategoryValue(n))?.count ?? 0;
		const add = () => {
			const n = name.trim();
			const p = pattern.trim();
			if (!n || !p) setErr("Enter a name and a regex");
			else if (cats.some((c) => c.name.toLowerCase() === n.toLowerCase())) setErr(`“${n}” already exists`);
			else if (!compileFilter(p)) setErr("Invalid regex");
			else {
				setCats([...cats, {
					name: n,
					pattern: p
				}]);
				setName("");
				setPattern("");
			}
		};
		const remove = (n) => {
			setCats(cats.filter((c) => c.name !== n));
			setView({ categories: view.categories.filter((v) => v !== customCategoryValue(n)) });
		};
		const onInput = (set) => (e) => {
			set(e.currentTarget.value);
			setErr(null);
		};
		return u("div", {
			class: "custom-cats",
			children: [
				u("h3", { children: "Custom categories" }),
				u("ul", {
					class: "filter-list",
					children: cats.map((c) => u(FilterRow, {
						label: c.name,
						pattern: c.pattern,
						count: count(c.name),
						onRemove: () => remove(c.name),
						onSave: (next) => setCats(cats.map((x) => x.name === c.name ? {
							...x,
							pattern: next
						} : x))
					}, c.name))
				}),
				u("input", {
					class: "add-filter",
					type: "text",
					placeholder: "Name",
					"aria-label": "Custom category name",
					value: name,
					onInput: onInput(setName),
					onKeyDown: (e) => e.key === "Enter" && add()
				}),
				u("div", {
					class: `add-filter ${err ? "has-error" : ""}`,
					children: [u("input", {
						type: "text",
						placeholder: "Regex, e.g. pressure washers?",
						"aria-label": "Custom category title regex",
						autocomplete: "off",
						spellcheck: false,
						value: pattern,
						onInput: onInput(setPattern),
						onKeyDown: (e) => e.key === "Enter" && add()
					}), u("button", {
						type: "button",
						class: "btn-text",
						onClick: add,
						children: "Add"
					})]
				}),
				err ? u("p", {
					class: "error small",
					children: err
				}) : u("p", {
					class: "muted small",
					children: "Lots whose title matches move here from their own category. Same regex rules as filters."
				})
			]
		});
	}
	function Switch({ label, checked, onChange }) {
		return u("label", {
			class: "switch-row",
			children: [u("span", { children: label }), u("input", {
				type: "checkbox",
				role: "switch",
				checked,
				onChange: (e) => onChange(e.currentTarget.checked)
			})]
		});
	}
	function HideFilterSection({ matchCounts, onOpenHidden }) {
		const [words, setWords] = useSetting(KEYS.words);
		const [filterOn, setFilterOn] = useSetting(KEYS.filterOn);
		const [removeFiltered, setRemoveFiltered] = useSetting(KEYS.removeFiltered);
		const [showHidden, setShowHidden] = useSetting(KEYS.showHidden);
		const [hiddenLots, setHiddenLots] = useSetting(KEYS.hidden);
		const [input, setInput] = d("");
		const [err, setErr] = d(null);
		const add = () => {
			const list = splitFilters(input);
			const bad = list.filter((p) => !compileFilter(p));
			if (bad.length) setErr(`Invalid regex: ${bad.join(", ")}`);
			else if (list.length) {
				setWords([...new Set([...words, ...list])]);
				setInput("");
			}
		};
		const unhide = (id) => {
			const { [id]: _, ...rest } = hiddenLots;
			setHiddenLots(rest);
		};
		const hidden = Object.entries(hiddenLots).sort((a, b) => b[1].ts - a[1].ts);
		return u("section", {
			class: "panel",
			children: [
				u("h2", { children: "Hide & filter" }),
				u("div", {
					class: `add-filter ${err ? "has-error" : ""}`,
					children: [u("input", {
						type: "text",
						placeholder: "Regex, e.g. batter(y|ies)",
						"aria-label": "Add filter regex",
						autocomplete: "off",
						spellcheck: false,
						value: input,
						onInput: (e) => {
							setInput(e.currentTarget.value);
							setErr(null);
						},
						onKeyDown: (e) => e.key === "Enter" && add()
					}), u("button", {
						type: "button",
						class: "btn-text",
						onClick: add,
						children: "Add"
					})]
				}),
				err ? u("p", {
					class: "error small",
					children: err
				}) : u("p", {
					class: "muted small",
					children: "Case-insensitive, whole words: \\b(?:pattern)\\b. Commas add several."
				}),
				u(Collapsible, {
					id: "words",
					title: `Filter patterns (${words.length})`,
					children: u("ul", {
						class: "filter-list",
						children: words.map((w) => u(FilterRow, {
							pattern: w,
							count: matchCounts.get(w) ?? 0,
							onRemove: () => setWords(words.filter((x) => x !== w)),
							onSave: (next) => setWords([...new Set(words.map((x) => x === w ? next : x))])
						}, w))
					})
				}),
				u(Switch, {
					label: "Apply filters",
					checked: filterOn,
					onChange: setFilterOn
				}),
				u(Switch, {
					label: "Remove filtered lots instead of graying out",
					checked: removeFiltered,
					onChange: setRemoveFiltered
				}),
				u(Switch, {
					label: "Show hidden lots",
					checked: showHidden,
					onChange: setShowHidden
				}),
				u(Collapsible, {
					id: "hidden",
					title: `Hidden lots (${hidden.length})`,
					children: [u("ul", {
						class: "hidden-list",
						children: hidden.map(([id, info]) => u("li", { children: [u("a", {
							href: info.href,
							title: info.title,
							onClick: openHandler(() => onOpenHidden(Number(id))),
							children: info.title || `Lot ${id}`
						}), u("button", {
							type: "button",
							class: "icon-btn",
							title: "Unhide",
							"aria-label": `Unhide ${info.title}`,
							onClick: () => unhide(id),
							children: u(Icon, {
								name: "visibility",
								size: 18
							})
						})] }))
					}), hidden.length > 0 && u("button", {
						type: "button",
						class: "btn-text",
						onClick: () => confirm("Unhide all hidden lots?") && setHiddenLots({}),
						children: "Unhide all"
					})]
				})
			]
		});
	}
	function SettingsSection({ pickup, accountPickup, locations }) {
		const [minutes, setMinutes] = useSetting(KEYS.syncMinutes);
		const [override, setOverride] = useSetting(KEYS.pickup);
		return u("section", {
			class: "panel",
			children: u(Collapsible, {
				id: "settings",
				title: u("h2", { children: "Settings" }),
				children: [u(NumberInput, {
					label: `Full catalog refresh at most every (minutes, min 1)`,
					value: minutes,
					parse: (text) => Math.max(1, Math.round(parseNum(text) ?? 5)),
					onChange: setMinutes,
					type: "number",
					min: 1,
					step: 1
				}), u("label", {
					class: "field",
					children: [u("span", { children: "Pickup location (for transfer fees)" }), u("select", {
						value: override ?? "",
						onChange: (e) => setOverride(e.currentTarget.value || null),
						children: [u("option", {
							value: "",
							children: [
								"Account default (",
								accountPickup ?? "Raleigh",
								")"
							]
						}), [...new Set([...locations, pickup])].map((o) => u("option", {
							value: o,
							children: o
						}))]
					})]
				})]
			})
		});
	}
	function SavedSearchesSection({ searches, stats, activeId, canSave, suggestedName, onSave, onOpen, onDelete, onRename }) {
		const edit = useInlineEdit();
		const naming = edit.editing === "new";
		const saveNew = (name) => onSave(name);
		return u("section", {
			class: "panel",
			children: [
				u("div", {
					class: "panel-head",
					children: [u("h2", { children: "Saved searches" }), !naming && u("button", {
						type: "button",
						class: "btn-text",
						disabled: !canSave,
						onClick: () => edit.start("new", suggestedName),
						title: canSave ? "Save the current filters" : "Set some filters first, or this search is already saved",
						children: "Save current"
					})]
				}),
				naming && u("div", {
					class: "add-filter",
					children: [u("input", {
						type: "text",
						"aria-label": "Name for saved search",
						...edit.boxProps("new", saveNew)
					}), u("button", {
						type: "button",
						class: "btn-text",
						onMouseDown: (e) => e.preventDefault(),
						onClick: () => edit.save("new", saveNew),
						children: "Save"
					})]
				}),
				searches.length === 0 && !naming && u("p", {
					class: "muted small",
					children: "Set filters or a search, then save them here. New listings that match show up as a count after each catalog refresh."
				}),
				u("ul", {
					class: "filter-list",
					children: searches.map((s) => {
						const st = stats.get(s.id) ?? {
							total: 0,
							fresh: 0
						};
						return u("li", {
							class: `filter-row saved-row ${s.id === activeId ? "active" : ""}`,
							children: [
								u("button", {
									type: "button",
									class: "filter-remove",
									"aria-label": `Delete ${s.name}`,
									title: "Delete saved search",
									onClick: () => confirm(`Delete saved search “${s.name}”?`) && onDelete(s.id),
									children: u(Icon, {
										name: "cancel",
										size: 16
									})
								}),
								edit.editing === s.id ? u("input", {
									class: "rename",
									type: "text",
									"aria-label": "Rename saved search",
									...edit.boxProps(s.id, (name) => onRename(s.id, name))
								}) : u("button", {
									type: "button",
									class: "saved-name",
									title: "Click to open · double-click to rename",
									onClick: () => onOpen(s, false),
									onDblClick: () => edit.start(s.id, s.name),
									children: s.name
								}),
								st.fresh > 0 && u("button", {
									type: "button",
									class: "pill pill-new",
									title: "Show only the new matches",
									onClick: () => onOpen(s, true),
									children: [fmtCount(st.fresh), " new"]
								}),
								u("span", {
									class: "count",
									title: "Open lots matching, not counting hidden or regex-filtered lots",
									children: fmtCount(st.total)
								})
							]
						});
					})
				})
			]
		});
	}
	var PAGE_SIZE = 60;
	function useAccountPickup(lots, authed) {
		const [acct] = useSetting(KEYS.accountPickup);
		h(() => {
			if (authed && !(acct && Date.now() - acct.at < 864e5)) fetchPickupLocation().then((p) => setSetting(KEYS.accountPickup, {
				id: p?.id ?? null,
				name: p?.name ?? null,
				at: Date.now()
			}), () => {});
		}, [authed]);
		if (acct?.name || acct?.id == null) return acct?.name ?? null;
		return lots.values().find((l) => l.location?.id === acct.id)?.location?.name ?? null;
	}
	function App() {
		const catalog = useCatalog();
		const [storedView, setStoredView] = useSetting(KEYS.view);
		const view = T$1(() => normalizeView(storedView), [storedView]);
		const [words] = useSetting(KEYS.words);
		const [filterOn] = useSetting(KEYS.filterOn);
		const [removeFiltered] = useSetting(KEYS.removeFiltered);
		const [hiddenLots, setHiddenLots] = useSetting(KEYS.hidden);
		const [showHidden] = useSetting(KEYS.showHidden);
		const [pickupOverride] = useSetting(KEYS.pickup);
		const [customCategories] = useSetting(KEYS.customCategories);
		const authed = useAuthed();
		const accountPickup = useAccountPickup(catalog.lots, authed);
		const pickup = pickupOverride || accountPickup || "Raleigh";
		const [page, setPage] = d(1);
		const [openId, setOpenId] = d(null);
		const [bidReq, setBidReq] = d(null);
		const [sidebarOpen, setSidebarOpen] = d(false);
		const [search, setSearch] = d(view.search);
		const gridTop = A$1(null);
		const now30 = useNow(3e4);
		const [savedRaw, setSavedRaw] = useSetting(KEYS.savedSearches);
		const saved = savedRaw;
		const [highlight, setHighlight] = d(null);
		const setView = q$1((patch) => {
			setStoredView({
				...normalizeView(getSetting(KEYS.view)),
				...patch
			});
			setPage(1);
		}, []);
		const pushed = A$1(view.search);
		h(() => {
			if (search === view.search) return;
			const t = setTimeout(() => {
				pushed.current = search;
				setView({ search });
			}, 200);
			return () => clearTimeout(t);
		}, [search]);
		h(() => {
			if (view.search !== pushed.current) {
				pushed.current = view.search;
				setSearch(view.search);
			}
		}, [view.search]);
		const exclusions = T$1(() => ({
			words,
			filterOn,
			removeFiltered,
			hidden: hiddenLots,
			showHidden,
			customCategories
		}), [
			words,
			filterOn,
			removeFiltered,
			hiddenLots,
			showHidden,
			customCategories
		]);
		const result = T$1(() => computeView(catalog.lots.values(), view, pickup, exclusions, now30), [
			catalog.rev,
			view,
			pickup,
			exclusions,
			now30
		]);
		const facets = T$1(() => computeFacets(catalog.lots.values(), now30, customCategories), [
			catalog.lots,
			catalog.meta.fetchedAt,
			catalog.loaded,
			now30,
			customCategories
		]);
		const savedStats = T$1(() => savedSearchStats(catalog.lots.values(), saved, pickup, exclusions, now30), [
			catalog.rev,
			saved,
			pickup,
			exclusions,
			now30
		]);
		const totalNew = savedStats.values().reduce((n, s) => n + s.fresh, 0);
		const activeSaved = saved.find((s) => sameFilters(view, s.view)) ?? null;
		const newSince = view.newSince ?? (highlight && activeSaved?.id === highlight.id ? highlight.since : null);
		const isNew = (lot) => newSince != null && (lot.firstSeenAt ?? 0) > newSince;
		h(() => {
			document.title = totalNew ? `(${totalNew}) TL Catalog` : "TL Catalog";
		}, [totalNew]);
		const updateSaved = (fn) => setSetting(KEYS.savedSearches, fn(getSetting(KEYS.savedSearches)));
		const savedProps = {
			searches: saved,
			stats: savedStats,
			activeId: activeSaved?.id ?? null,
			canSave: activeFilterCount({
				...view,
				newSince: null
			}) > 0 && !activeSaved,
			suggestedName: suggestName(view, facets),
			onSave: (name) => {
				const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
				updateSaved((l) => l.some((x) => sameFilters(view, x.view)) ? l : [...l, {
					id,
					name,
					view: savedFilters(view),
					lastViewedAt: Date.now()
				}]);
			},
			onOpen: (s, newOnly) => {
				setStoredView({
					...normalizeView(s.view),
					newSince: newOnly ? s.lastViewedAt : null
				});
				setSearch(s.view.search);
				setPage(1);
				setHighlight({
					id: s.id,
					since: s.lastViewedAt
				});
				updateSaved((l) => l.map((x) => x.id === s.id ? {
					...x,
					lastViewedAt: Date.now()
				} : x));
				setSidebarOpen(false);
				gridTop.current?.scrollIntoView({ block: "start" });
			},
			onDelete: (id) => updateSaved((l) => l.filter((x) => x.id !== id)),
			onRename: (id, name) => updateSaved((l) => l.map((x) => x.id === id ? {
				...x,
				name
			} : x))
		};
		const pages = Math.max(1, Math.ceil(result.rows.length / PAGE_SIZE));
		const curPage = Math.min(page, pages);
		const pageRows = result.rows.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
		const watchIds = [...pageRows.map((r) => r.lot.id), ...openId ? [openId] : []];
		h(() => {
			if (catalog.loaded) {
				const t = setTimeout(() => void watchLots(watchIds).catch(() => {}), 300);
				return () => clearTimeout(t);
			}
		}, [watchIds.join(","), catalog.loaded]);
		const toggleHide = q$1((lot) => {
			const { [lot.id]: wasHidden, ...rest } = getSetting(KEYS.hidden);
			setHiddenLots(wasHidden ? rest : {
				...rest,
				[lot.id]: {
					title: lot.title,
					href: lotHref(lot.auctionPeriod, lot.id),
					ts: Date.now()
				}
			});
		}, []);
		const openLot = q$1((lot) => setOpenId(lot.id), []);
		const openHidden = q$1((id) => {
			if (getLot(id)) setOpenId(id);
			else window.open(getSetting(KEYS.hidden)[id]?.href ?? "/", "_blank", "noopener");
		}, []);
		const goPage = (p) => {
			setPage(p);
			gridTop.current?.scrollIntoView({ block: "start" });
		};
		const openLotObj = openId != null ? catalog.lots.get(openId) : void 0;
		const bidLot = bidReq ? catalog.lots.get(bidReq.lotId) : void 0;
		const nFilters = activeFilterCount(view);
		const freshMatches = view.newSince == null && activeSaved && newSince != null ? result.rows.filter((r) => isNew(r.lot)).length : 0;
		return u("div", {
			class: "app",
			children: [
				u("header", {
					class: "topbar",
					children: [
						u("a", {
							class: "brand",
							href: "/",
							title: "Back to Triangle Liquidators",
							children: ["TL ", u("span", { children: "Catalog" })]
						}),
						u("input", {
							class: "search",
							type: "search",
							placeholder: `Search ${fmtCount(result.open)} lots`,
							"aria-label": "Search lots",
							value: search,
							onInput: (e) => setSearch(e.currentTarget.value)
						}),
						u("select", {
							class: "sort",
							"aria-label": "Sort",
							value: view.sort,
							onChange: (e) => setView({ sort: e.currentTarget.value }),
							children: Object.entries(SORTS).map(([k, { label }]) => u("option", {
								value: k,
								children: label
							}))
						}),
						u("button", {
							type: "button",
							class: "btn btn-outline filters-toggle",
							onClick: () => setSidebarOpen(!sidebarOpen),
							"aria-expanded": sidebarOpen,
							children: [
								u(Icon, { name: "filter" }),
								" Filters",
								nFilters ? ` (${nFilters})` : "",
								totalNew > 0 && u("span", {
									class: "pill pill-new",
									children: [fmtCount(totalNew), " new"]
								})
							]
						})
					]
				}),
				u("div", {
					class: "layout",
					children: [u("aside", {
						class: `sidebar ${sidebarOpen ? "open" : ""}`,
						children: u(Sidebar, {
							view,
							setView,
							facets,
							matchCounts: result.matchCounts,
							pickup,
							accountPickup,
							authed,
							onOpenHidden: openHidden,
							saved: savedProps
						})
					}), u("main", {
						class: "main",
						children: [
							u(StatusBar, {}),
							!authed && u("p", {
								class: "notice",
								children: [
									"Not logged in: your bids, standings and watchlist aren’t shown. ",
									u("a", {
										href: "/",
										target: "_blank",
										rel: "noopener",
										children: "Log in on the site"
									}),
									" and this page picks it up."
								]
							}),
							u("div", {
								class: "results-line",
								ref: gridTop,
								children: [
									u("span", { children: [
										result.rows.length ? `${fmtCount((curPage - 1) * PAGE_SIZE + 1)}–${fmtCount((curPage - 1) * PAGE_SIZE + pageRows.length)} of ${fmtCount(result.rows.length)}` : catalog.loaded && !catalog.progress ? "No lots match" : "",
										result.removed > 0 && u("span", {
											class: "muted",
											children: [
												" · ",
												fmtCount(result.removed),
												" hidden or removed"
											]
										}),
										result.filteredOut > 0 && u("span", {
											class: "muted",
											children: [
												" · ",
												fmtCount(result.filteredOut),
												" outside filters"
											]
										}),
										result.combined > 0 && u("span", {
											class: "muted",
											children: [
												" · ",
												fmtCount(result.combined),
												" duplicates combined"
											]
										})
									] }),
									view.newSince != null && u("span", {
										class: "new-line",
										children: [
											"Only lots listed since ",
											shortTime(view.newSince),
											u("button", {
												type: "button",
												class: "btn-text",
												onClick: () => setView({ newSince: null }),
												children: "Show all"
											})
										]
									}),
									freshMatches > 0 && u("span", {
										class: "new-line",
										children: [
											fmtCount(freshMatches),
											" new since your last look at “",
											activeSaved.name,
											"”",
											u("button", {
												type: "button",
												class: "btn-text",
												onClick: () => setView({ newSince }),
												children: "Show only new"
											})
										]
									})
								]
							}),
							u("div", {
								class: "grid",
								children: pageRows.map((row) => u(LotCard, {
									row,
									isNew: isNew(row.lot),
									onOpen: openLot,
									onToggleHide: toggleHide,
									onBid: setBidReq
								}, row.lot.id))
							}),
							pages > 1 && u(Pager, {
								page: curPage,
								pages,
								go: goPage
							})
						]
					})]
				}),
				openLotObj && u(LotModal, {
					row: makeRow(openLotObj, pickup, exclusions),
					onClose: () => setOpenId(null),
					onToggleHide: () => toggleHide(openLotObj),
					onBid: setBidReq,
					group: result.groups.get(openLotObj.id),
					onOpenLot: openLot
				}),
				bidReq && bidLot && u(BidConfirm, {
					req: bidReq,
					row: makeRow(bidLot, pickup, exclusions),
					pickup,
					onClose: () => setBidReq(null)
				}, `${bidReq.lotId}:${bidReq.type}:${bidReq.amount}`),
				u(Toasts, {})
			]
		});
	}
	var LIVE_LABELS = {
		connected: "Live",
		connecting: "Connecting",
		off: "Live off",
		disconnected: "Offline"
	};
	function StatusBar() {
		const catalog = useCatalog();
		const live = useLiveState();
		const now = useNow(1e3);
		const { meta, progress, error, loaded } = catalog;
		const wait = nextPullAt() - now;
		const due = wait <= 0;
		let text = "No cached catalog yet";
		if (!loaded) text = "Reading local cache…";
		else if (progress) text = progress.total ? `Refreshing catalog… ${fmtCount(progress.done)} of ${fmtCount(progress.total)}` : "Refreshing catalog…";
		else if (meta.fetchedAt) text = `${fmtCount(catalog.lots.size)} lots · refreshed ${ago(meta.fetchedAt, now)}`;
		const pct = progress?.total ? Math.round(progress.done / progress.total * 100) : 0;
		return u("div", {
			class: "statusbar",
			children: [
				u("span", { children: text }),
				u("span", {
					class: `live live-${live}`,
					title: `Live price updates for lots on screen: ${live}`,
					children: ["● ", LIVE_LABELS[live]]
				}),
				u("button", {
					type: "button",
					class: "btn-text",
					disabled: !loaded || !!progress || !due,
					onClick: () => void pullCatalog(),
					title: due ? "Pull the full catalog now" : "Full refreshes are rate-limited; change the interval in Settings",
					children: [
						u(Icon, {
							name: "refresh",
							size: 16
						}),
						" ",
						progress ? "Refreshing" : due ? "Refresh" : `Refresh in ${countdown(wait)}`
					]
				}),
				progress && u("span", {
					class: "progress",
					role: "progressbar",
					"aria-valuenow": pct,
					"aria-valuemin": 0,
					"aria-valuemax": 100,
					children: u("span", { style: { width: `${pct}%` } })
				}),
				error && u("span", {
					class: "error",
					children: error
				})
			]
		});
	}
	function pagerItems(page, pages) {
		const nums = [...new Set([
			1,
			pages,
			page - 1,
			page,
			page + 1
		])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
		return nums.flatMap((n, i) => i && n - nums[i - 1] > 1 ? ["…", n] : [n]);
	}
	function Pager({ page, pages, go }) {
		return u("nav", {
			class: "pager",
			"aria-label": "Pages",
			children: [
				u("button", {
					type: "button",
					"aria-label": "Previous page",
					disabled: page === 1,
					onClick: () => go(page - 1),
					children: u(Icon, { name: "chevronLeft" })
				}),
				pagerItems(page, pages).map((n) => n === "…" ? u("span", {
					class: "gap",
					children: "…"
				}) : u("button", {
					type: "button",
					"aria-current": n === page ? "page" : void 0,
					onClick: () => go(n),
					children: n
				})),
				u("button", {
					type: "button",
					"aria-label": "Next page",
					disabled: page === pages,
					onClick: () => go(page + 1),
					children: u(Icon, { name: "chevronRight" })
				})
			]
		});
	}
	function takeOver() {
		window.stop();
		const root = document.documentElement ?? document.appendChild(document.createElement("html"));
		root.replaceChildren();
		root.lang = "en";
		const head = document.createElement("head");
		head.innerHTML = `
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <link rel="icon" href="/favicon.ico">
    <title>TL Catalog</title>`;
		const style = document.createElement("style");
		style.textContent = app_default;
		head.appendChild(style);
		const body = document.createElement("body");
		const mount = document.createElement("div");
		body.appendChild(mount);
		root.append(head, body);
		new MutationObserver((records) => {
			for (const node of records.flatMap((r) => [...r.addedNodes])) if (node instanceof HTMLScriptElement || node instanceof HTMLLinkElement && node.rel !== "icon") node.remove();
		}).observe(root, {
			childList: true,
			subtree: true
		});
		startAuth();
		R$1(u(App, {}), mount);
		startCatalog();
	}
	if (location.pathname.replace(/\/+$/, "") === "/tlx") takeOver();
})();
