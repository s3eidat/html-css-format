/* HTML CSS Format — own tokenizers. Output is shown as escaped text in a <pre>; nothing is ever rendered or run. */
(function () {
  "use strict";
  var $ = S3.$, $$ = S3.$$;
  function set(s) { var o = Object.create(null); s.split(" ").forEach(function (w) { o[w] = true; }); return o; }

  var VOID = set("area base br col embed hr img input link meta source track wbr param keygen command basefont frame isindex");
  var RAW = set("script style textarea title pre xmp plaintext listing");
  var INLINE = set("a abbr acronym b bdi bdo big br button cite code data dfn em font i img input kbd label mark meter " +
    "output q ruby rp rt s samp select small span strike strong sub sup time tt u var wbr del ins textarea title");
  // Opening one of these closes an open <p>; <li>, <option>, <tr>, <td> etc. close their own kind.
  var CLOSES_P = set("address article aside blockquote details div dl fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 " +
    "header hgroup hr main menu nav ol p pre section table ul");
  var SELF_SIBLING = { li: set("li"), option: set("option optgroup"), dt: set("dt dd"), dd: set("dt dd"), tr: set("tr"),
    td: set("td th"), th: set("td th"), thead: set("tbody tfoot"), tbody: set("tbody tfoot"), optgroup: set("optgroup") };

  // ================= HTML =================
  // Collapse whitespace between attributes (outside quotes) so tags are stable.
  function normTag(raw) {
    var out = "", q = null, sp = false;
    for (var i = 0; i < raw.length; i++) {
      var c = raw[i];
      if (q) { out += c; if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { if (sp && !/=$/.test(out)) out += " "; sp = false; q = c; out += c; continue; }
      if (/\s/.test(c)) { sp = true; continue; }
      if (sp) {
        if (c !== ">" && c !== "=" && !/=$/.test(out) && !(c === "/" && raw[i + 1] === ">")) out += " ";
        else if (c === "/" && raw[i + 1] === ">") out += " ";
        sp = false;
      }
      out += c;
    }
    return out;
  }
  function tagEnd(s, i) { // index after the closing ">" of a tag that starts at i, respecting quoted values
    var q = null;
    for (var j = i + 1; j < s.length; j++) {
      var c = s[j];
      if (q) { if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { if (/[=\s]/.test(s[j - 1])) q = c; continue; }
      if (c === ">") return j + 1;
    }
    return s.length;
  }
  function htmlTokens(s) {
    var toks = [], i = 0, n = s.length, text = "";
    function flush() { if (text) { toks.push({ t: "text", v: text }); text = ""; } }
    while (i < n) {
      if (s[i] !== "<") { var nx = s.indexOf("<", i); if (nx < 0) nx = n; text += s.slice(i, nx); i = nx; continue; }
      var c1 = s[i + 1] || "", e;
      if (s.startsWith("<!--", i)) { flush(); e = s.indexOf("-->", i + 4); e = e < 0 ? n : e + 3; toks.push({ t: "comment", v: s.slice(i, e) }); i = e; continue; }
      if (s.startsWith("<![CDATA[", i)) { flush(); e = s.indexOf("]]>", i); e = e < 0 ? n : e + 3; toks.push({ t: "cdata", v: s.slice(i, e) }); i = e; continue; }
      if (c1 === "!" || c1 === "?") { flush(); e = s.indexOf(">", i); e = e < 0 ? n : e + 1; toks.push({ t: "decl", v: s.slice(i, e).replace(/\s+/g, " ") }); i = e; continue; }
      if (c1 === "/" && /[A-Za-z]/.test(s[i + 2] || "")) {
        flush(); e = s.indexOf(">", i); e = e < 0 ? n : e + 1;
        var cname = /^<\/([^\s>\/]+)/.exec(s.slice(i, e))[1];
        toks.push({ t: "close", name: cname.toLowerCase(), v: "</" + cname + ">" }); i = e; continue;
      }
      if (/[A-Za-z]/.test(c1)) {
        flush(); e = tagEnd(s, i);
        var raw = s.slice(i, e), name = /^<([^\s>\/]+)/.exec(raw)[1], lname = name.toLowerCase();
        var tag = normTag(raw), self = /\/\s*>$/.test(raw);
        toks.push({ t: "open", name: lname, v: tag, self: self });
        i = e;
        if (RAW[lname] && !self) {
          var m = new RegExp("</" + lname + "[\\s>]", "i").exec(s.slice(i));
          var end = m ? i + m.index : n;
          toks.push({ t: "raw", v: s.slice(i, end) }); i = end;
        }
        continue;
      }
      text += "<"; i++;
    }
    flush();
    return toks;
  }
  function buildTree(s) {
    var root = { t: "root", kids: [] }, stack = [root];
    function top() { return stack[stack.length - 1]; }
    htmlTokens(s).forEach(function (k) {
      if (k.t === "open") {
        var T = top();
        if (T.name === "p" && CLOSES_P[k.name]) stack.pop();
        else if (SELF_SIBLING[T.name] && SELF_SIBLING[T.name][k.name]) stack.pop();
        var node = { t: "el", name: k.name, open: k.v, kids: [], close: null };
        top().kids.push(node);
        if (!k.self && !VOID[k.name]) stack.push(node);
      } else if (k.t === "raw") {
        top().raw = k.v;
      } else if (k.t === "close") {
        for (var d = stack.length - 1; d > 0; d--) if (stack[d].name === k.name) break;
        if (d > 0) { stack[d].close = k.v; stack.length = d; }
        else top().kids.push({ t: "stray", v: k.v });
      } else top().kids.push(k);
    });
    return root;
  }
  function isInline(n) {
    if (n.t === "text" || n.t === "comment") return true;
    if (n.t !== "el" || !INLINE[n.name]) return false;
    return n.kids.every(isInline);
  }
  function wsCollapse(s) { return s.replace(/[ \t\n\r\f]+/g, " "); }
  function inlineStr(n, dropComments) {
    if (n.t === "text") return wsCollapse(n.v);
    if (n.t === "comment") return dropComments && !/^<!--\[if/i.test(n.v) ? "" : n.v;
    return n.open + (n.raw != null ? n.raw : n.kids.map(function (k) { return inlineStr(k, dropComments); }).join("")) + (n.close || "");
  }
  function beautifyHtml(src, unit, dropComments) {
    var lines = [];
    function pad(d) { return unit.repeat(d); }
    function print(kids, d) {
      var run = [];
      function flushRun() {
        if (!run.length) return;
        var s = run.map(function (k) { return inlineStr(k, dropComments); }).join("").replace(/^ +| +$/g, "");
        if (s) lines.push(pad(d) + s);
        run = [];
      }
      kids.forEach(function (k) {
        if (isInline(k)) { run.push(k); return; }
        flushRun();
        if (k.t !== "el") { lines.push(pad(d) + k.v.trim()); return; }
        if (k.raw != null) { lines.push(pad(d) + k.open + k.raw + (k.close || "")); return; }
        if (k.kids.every(isInline)) {
          var inner = k.kids.map(function (x) { return inlineStr(x, dropComments); }).join("").replace(/^ +| +$/g, "");
          if (inner.length + k.open.length <= 100 && inner.indexOf("\n") < 0) { lines.push(pad(d) + k.open + inner + (k.close || "")); return; }
        }
        lines.push(pad(d) + k.open);
        print(k.kids, d + 1);
        if (k.close) lines.push(pad(d) + k.close);
      });
      flushRun();
    }
    print(buildTree(src).kids, 0);
    return lines.join("\n");
  }
  function minifyHtml(src, dropComments) {
    function isBlockish(n) { return n && !isInline(n); }
    function sib(kids, i, dir) { for (var j = i + dir; j >= 0 && j < kids.length; j += dir) if (kids[j].t !== "comment") return kids[j]; return null; }
    function out(kids, parentBlock) {
      var s = "";
      kids.forEach(function (k, i) {
        if (k.t === "text") {
          var v = wsCollapse(k.v), prev = sib(kids, i, -1), next = sib(kids, i, 1);
          if (prev ? isBlockish(prev) : parentBlock) v = v.replace(/^ /, "");
          if (next ? isBlockish(next) : parentBlock) v = v.replace(/ $/, "");
          s += v;
        } else if (k.t === "comment") {
          if (!dropComments || /^<!--\[if/i.test(k.v)) s += k.v;
        } else if (k.t === "el") {
          s += k.open + (k.raw != null ? k.raw : out(k.kids, !INLINE[k.name])) + (k.close || "");
        } else s += k.v.trim();
      });
      return s;
    }
    return out(buildTree(src).kids, true);
  }

  // ================= CSS =================
  // Split CSS into items: comment, open (prelude), decl, close. Strings, url() and escapes are kept intact.
  function cssItems(s) {
    var items = [], buf = "", paren = 0, i = 0, n = s.length;
    function flushDecl() { if (buf.trim()) items.push({ t: "decl", v: buf }); buf = ""; }
    while (i < n) {
      var c = s[i];
      if (c === "/" && s[i + 1] === "*") {
        var e = s.indexOf("*/", i + 2); e = e < 0 ? n : e + 2;
        if (!buf.trim()) { buf = ""; items.push({ t: "comment", v: s.slice(i, e) }); } else buf += s.slice(i, e);
        i = e; continue;
      }
      if (c === '"' || c === "'") {
        var j = i + 1;
        while (j < n && s[j] !== c && s[j] !== "\n") { if (s[j] === "\\") j++; j++; }
        buf += s.slice(i, j + 1); i = j + 1; continue;
      }
      if (c === "\\") { buf += s.slice(i, i + 2); i += 2; continue; }
      if (/^url\(\s*[^\s"')]/i.test(s.slice(i, i + 64)) && !/[\w-]/.test(s[i - 1] || "")) {
        var k = s.indexOf(")", i); k = k < 0 ? n : k + 1;
        buf += s.slice(i, k); i = k; continue;
      }
      if (c === "(") paren++;
      else if (c === ")") paren = Math.max(0, paren - 1);
      else if (paren === 0 && c === "{") { items.push({ t: "open", v: buf }); buf = ""; i++; continue; }
      else if (paren === 0 && c === ";") { flushDecl(); i++; continue; }
      else if (paren === 0 && c === "}") { flushDecl(); items.push({ t: "close" }); i++; continue; }
      buf += c; i++;
    }
    flushDecl();
    return items;
  }
  // Apply fn only to code outside strings, url(...) and comments.
  function outside(text, fn, dropComments) {
    var re = /("(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|url\(\s*[^\s"')][^)]*\)|\/\*[\s\S]*?(?:\*\/|$))/gi, out = "", last = 0, m;
    while ((m = re.exec(text))) {
      out += fn(text.slice(last, m.index));
      out += dropComments && m[0].slice(0, 2) === "/*" && m[0][2] !== "!" ? "" : m[0];
      last = m.index + m[0].length;
    }
    return out + fn(text.slice(last));
  }
  function splitTop(text, ch) { // split at ch outside parens/brackets/strings
    var parts = [], depth = 0, q = null, cur = "";
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { cur += c; if (c === "\\") { cur += text[++i] || ""; } else if (c === q) q = null; continue; }
      if (c === '"' || c === "'") q = c;
      else if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      else if (c === ch && depth === 0) { parts.push(cur); cur = ""; continue; }
      cur += c;
    }
    parts.push(cur);
    return parts;
  }
  function collapse(t, drop) { return outside(t, function (x) { return x.replace(/\s+/g, " "); }, drop).trim(); }
  function declParts(v, drop) {
    var t = collapse(v, drop), idx = -1, depth = 0, q = null;
    for (var i = 0; i < t.length; i++) {
      var c = t[i];
      if (q) { if (c === "\\") i++; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'") q = c;
      else if (c === "(") depth++; else if (c === ")") depth--;
      else if (c === ":" && depth === 0) { idx = i; break; }
    }
    if (idx < 0 || t[0] === "@") return { whole: t };
    return { prop: t.slice(0, idx).trim(), value: t.slice(idx + 1).trim() };
  }
  function beautifyCss(src, unit, drop) {
    var lines = [], d = 0;
    function pad() { return unit.repeat(d); }
    var afterComment = false;
    cssItems(src).forEach(function (it, k, all) {
      if (it.t === "comment") {
        if (drop && it.v[2] !== "!") return;
        if (d === 0 && lines.length && lines[lines.length - 1] !== "" && !afterComment) lines.push("");
        lines.push(pad() + it.v.trim()); afterComment = true; return;
      }
      var wasComment = afterComment; afterComment = false;
      if (it.t === "open") {
        var pre = collapse(it.v, drop);
        if (pre[0] !== "@") pre = splitTop(pre, ",").map(function (x) { return x.trim(); }).join(",\n" + pad());
        else pre = outside(pre, function (x) { return x.replace(/\(\s*([\w-]+)\s*:\s*/g, "($1: "); }, drop);
        if (d === 0 && lines.length && lines[lines.length - 1] !== "" && !wasComment) lines.push("");
        lines.push(pad() + pre + (pre ? " {" : "{"));
        d++; return;
      }
      if (it.t === "decl") {
        var p = declParts(it.v, drop);
        if (p.whole == null && !p.prop) return;
        var val = p.whole != null ? "" : outside(p.value, function (x) { return x.replace(/\s*,\s*/g, ", ").replace(/\s*!\s*important/gi, " !important"); }, drop);
        lines.push(pad() + (p.whole != null ? p.whole : p.prop + ": " + val) + ";");
        return;
      }
      d = Math.max(0, d - 1);
      lines.push(pad() + "}");
      if (d === 0 && all[k + 1]) lines.push("");
    });
    return lines.join("\n").replace(/\n{3,}/g, "\n\n");
  }
  function minifyCss(src, drop) {
    var out = "", items = cssItems(src);
    items.forEach(function (it, k) {
      if (it.t === "comment") { if (!drop || it.v[2] === "!") out += it.v; return; }
      if (it.t === "open") {
        var pre = collapse(it.v, drop);
        pre = outside(pre, pre[0] === "@" ? function (x) { return x.replace(/\s*([,:])\s*/g, "$1").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")"); }
          : function (x) { return x.replace(/\s*([,>~+])\s*/g, "$1"); }, drop);
        out += pre + "{"; return;
      }
      if (it.t === "decl") {
        var p = declParts(it.v, drop);
        var body = p.whole != null ? p.whole : p.prop + ":" + outside(p.value, function (x) { return x.replace(/\s*,\s*/g, ",").replace(/\s*!\s*important/gi, "!important"); }, drop);
        var next = items[k + 1];
        out += body + (next && next.t === "close" ? "" : ";");
        return;
      }
      out += "}";
    });
    return out;
  }

  // ================= highlighting (output is text, only spans are added) =================
  function hlHtml(text) {
    var html = "";
    htmlTokens(text).forEach(function (k) {
      if (k.t === "open") {
        var m = /^<([^\s>\/]+)([\s\S]*?)(\/?>)$/.exec(k.v) || [k.v, k.v, "", ""];
        var attrs = S3.esc(m[2]).replace(/([^\s=]+)(=)(&quot;[\s\S]*?&quot;|&#39;[\s\S]*?&#39;|[^\s]+)?/g, function (all, a, eq, val) {
          return '<span class="hc-a">' + a + "</span>" + eq + (val ? '<span class="hc-v">' + val + "</span>" : "");
        });
        html += '<span class="hc-t">&lt;' + S3.esc(m[1]) + "</span>" + attrs + '<span class="hc-t">' + S3.esc(m[3]) + "</span>";
      } else if (k.t === "close") html += '<span class="hc-t">' + S3.esc(k.v) + "</span>";
      else if (k.t === "comment") html += '<span class="hc-c">' + S3.esc(k.v) + "</span>";
      else if (k.t === "decl" || k.t === "cdata") html += '<span class="hc-d">' + S3.esc(k.v) + "</span>";
      else html += S3.esc(k.v);
    });
    return html;
  }
  function hlCss(text) {
    var re = /("(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?)|(\/\*[\s\S]*?(?:\*\/|$))|([^{};/"']+)(?=\{)|([\w-]+)(\s*:)(?![^{]*\{)|(@[\w-]+)/g;
    var out = "", last = 0, m;
    while ((m = re.exec(text))) {
      out += S3.esc(text.slice(last, m.index));
      if (m[1]) out += '<span class="hc-v">' + S3.esc(m[1]) + "</span>";
      else if (m[2]) out += '<span class="hc-c">' + S3.esc(m[2]) + "</span>";
      else if (m[3]) out += '<span class="hc-t">' + S3.esc(m[3]) + "</span>";
      else if (m[4]) out += '<span class="hc-a">' + S3.esc(m[4]) + "</span>" + S3.esc(m[5]);
      else out += '<span class="hc-d">' + S3.esc(m[6]) + "</span>";
      last = m.index + m[0].length;
    }
    return out + S3.esc(text.slice(last));
  }

  // ================= UI =================
  var input = $("#input"), out = $("#out"), status = $("#status"), stats = $("#stats");
  var state = { lang: S3.store("hcf.lang") || "html", mode: "beautify", text: "" };
  var saved = S3.store("hcf.opts") || {};
  if (saved.indent) $("#indent").value = saved.indent;
  $("#nocom").checked = !!saved.nocom;

  function unitOf() { var v = $("#indent").value; return v === "tab" ? "\t" : " ".repeat(+v); }
  function setLang(v) {
    state.lang = v; S3.store("hcf.lang", v);
    $$("#lang button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.v === v)); });
    $("#ext").textContent = v === "css" ? ".css" : ".html";
  }
  function stat(label, value) { return '<div class="stat"><b>' + S3.esc(value) + "</b><span>" + S3.esc(label) + "</span></div>"; }

  function render(action) {
    var src = input.value;
    S3.store("hcf.opts", { indent: $("#indent").value, nocom: $("#nocom").checked });
    if (action) state.mode = action;
    if (!src.trim()) { out.textContent = ""; state.text = ""; stats.innerHTML = ""; status.className = "chip"; status.textContent = "Waiting for code"; return; }
    var drop = $("#nocom").checked, u = unitOf(), css = state.lang === "css";
    state.text = css ? (state.mode === "minify" ? minifyCss(src, drop) : beautifyCss(src, u, drop))
      : (state.mode === "minify" ? minifyHtml(src, drop) : beautifyHtml(src, u, drop));
    out.innerHTML = css ? hlCss(state.text) : hlHtml(state.text);
    var a = new Blob([src]).size, b = new Blob([state.text]).size, pct = a ? Math.round((1 - b / a) * 1000) / 10 : 0;
    stats.innerHTML = stat("input", S3.fmtBytes(a)) + stat("output", S3.fmtBytes(b)) +
      stat(pct >= 0 ? "smaller" : "larger", Math.abs(pct) + "%") + stat("lines", state.text.split("\n").length.toLocaleString());
    status.className = "chip ok"; status.textContent = (state.mode === "minify" ? "Minified " : "Beautified ") + (css ? "CSS" : "HTML");
    if (action) S3.done();
  }
  function guessLang(t) { var s = t.trim(); if (!s) return; setLang(/^</.test(s) ? "html" : "css"); }

  var SAMPLE_HTML = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Demo   page</title>\n<style>body{margin:0;font:16px/1.5 system-ui}  .card{padding:1rem}</style></head>' +
    '<body><!-- main layout --><header class="top"   id=hero><h1>Hello <em>world</em></h1><nav><ul><li><a href="/">Home</a><li><a href="/about"   title="About us">About</a></ul></nav></header>' +
    '<main><p>Some <b>bold</b> and <code>code</code> text.<br>New line<img src="logo.png" alt="Logo"></p><pre>  keep   this\n    exactly  </pre>' +
    '<form><label>Name <input name="n" required></label><textarea>  untouched\n text </textarea><button type="submit">Send</button></form></main>' +
    '<script>if (a < b && c > d) { console.log("</div> stays"); }</script></body></html>';
  var SAMPLE_CSS = '@charset "utf-8";\n/* theme */\n:root{--accent:#3dd6d0;--gap: 12px}\nbody,html{margin:0;padding:0;font-family:"Inter",system-ui,sans-serif}\n' +
    '.card > h2 + p,.card:hover::after{content:"} ; {";color:rgba(0, 0, 0, .5);background:url(data:image/svg+xml;utf8,<svg/>) no-repeat}\n' +
    '@media (min-width: 640px) and (max-width:1024px){.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:calc(var(--gap) + 4px)}a:not(.btn){color:var(--accent)!important}}';

  $$("#lang button").forEach(function (b) { b.addEventListener("click", function () { setLang(b.dataset.v); render(); }); });
  input.addEventListener("input", S3.debounce(function () { render(); }, 250));
  input.addEventListener("paste", function () { setTimeout(function () { guessLang(input.value); render(); }, 0); });
  $("#indent").addEventListener("change", function () { render(); });
  $("#nocom").addEventListener("change", function () { render(); });
  $("#beautify").addEventListener("click", function () { render("beautify"); });
  $("#minify").addEventListener("click", function () { render("minify"); });
  $("#clear").addEventListener("click", function () { input.value = ""; render(); input.focus(); });
  $("#sample").addEventListener("click", function () { input.value = state.lang === "css" ? SAMPLE_CSS : SAMPLE_HTML; render("beautify"); });
  function load(f) {
    S3.readFile(f, "text").then(function (t) { input.value = t; setLang(/\.css$/i.test(f.name) ? "css" : "html"); render("beautify"); });
  }
  $("#open input").addEventListener("change", function (e) { var f = e.target.files[0]; if (f) load(f); e.target.value = ""; });
  input.addEventListener("dragover", function (e) { e.preventDefault(); });
  input.addEventListener("drop", function (e) { var f = e.dataTransfer.files[0]; if (!f) return; e.preventDefault(); load(f); });
  $("#copy").addEventListener("click", function () { if (state.text) { S3.copy(state.text); S3.done(); } else S3.toast("Nothing to copy yet", "error"); });
  $("#save").addEventListener("click", function () {
    if (!state.text) return;
    var css = state.lang === "css";
    S3.download(state.text, (state.mode === "minify" ? "minified" : "formatted") + (css ? ".css" : ".html"), css ? "text/css" : "text/html");
    S3.done();
  });
  setLang(state.lang);

  window.S3_DEMO = function () { setLang("html"); $("#sample").click(); };

  // ================= self-test =================
  window.S3_SELFTEST = function () {
    var fails = [];
    function eq(name, a, b) { if (a !== b) fails.push(name + ": got " + JSON.stringify(a) + " want " + JSON.stringify(b)); }
    var B = function (s) { return beautifyHtml(s, "  ", false); };
    eq("basic", B("<div><p>Hi <b>there</b></p><img src=x><br><ul><li>a<li>b</ul></div>"),
      "<div>\n  <p>Hi <b>there</b></p>\n  <img src=x><br>\n  <ul>\n    <li>a\n    <li>b\n  </ul>\n</div>");
    eq("attrs", B('<a   href="x  y"\n  class=c   >t</a>'), '<a href="x  y" class=c>t</a>');
    var script = '<script>\n  if (a < b) { x = "</div>"; }\n</script>';
    eq("script intact", B("<body>" + script + "</body>"), "<body>\n  " + script + "\n</body>");
    var pre = "<pre>  a\n   <b>b</b>  </pre>";
    eq("pre intact", B("<div>" + pre + "</div>"), "<div>\n  " + pre + "\n</div>");
    eq("textarea intact", minifyHtml("<form>\n  <textarea>  x\n  y </textarea>\n</form>", true), "<form><textarea>  x\n  y </textarea></form>");
    eq("minify", minifyHtml("<div>\n  <p> Hello   <b>big</b> world </p>\n  <!-- note -->\n</div>", true), "<div><p>Hello <b>big</b> world</p></div>");
    eq("minify keeps inline gap", minifyHtml("<p><b>a</b> <i>b</i></p>", true), "<p><b>a</b> <i>b</i></p>");
    eq("conditional comment kept", minifyHtml("<!--[if IE]><p>x</p><![endif]--><p>y</p>", true), "<!--[if IE]><p>x</p><![endif]--><p>y</p>");
    [SAMPLE_HTML, "<div>a<span>b</span><div>c</div>d</div>", "<p>x<!-- c -->y</p>"].forEach(function (s, k) {
      var once = B(s);
      eq("html idempotent " + k, B(once), once);
      eq("html minify stable " + k, minifyHtml(once, false), minifyHtml(s, false));
    });
    var C = function (s) { return beautifyCss(s, "  ", false); };
    eq("css basic", C("a,b{color:red;margin:0 auto}"), "a,\nb {\n  color: red;\n  margin: 0 auto;\n}");
    eq("css string", minifyCss('a::after { content : "} ; {" ; }', true), 'a::after{content:"} ; {"}');
    eq("css url", minifyCss("a{background:url(data:image/svg+xml;utf8,<svg a='1'/>) no-repeat}", true), "a{background:url(data:image/svg+xml;utf8,<svg a='1'/>) no-repeat}");
    eq("css calc", minifyCss(".x { width : calc(100% - 2px) ; }", true), ".x{width:calc(100% - 2px)}");
    eq("css descendant pseudo kept", minifyCss("a :hover{x:y}", true), "a :hover{x:y}");
    eq("css comments", minifyCss("/* a */ /*! keep */ b{c:d}", true), "/*! keep */b{c:d}");
    [SAMPLE_CSS, "@media screen{a{b:c}}\n.x{y:z}"].forEach(function (s, k) {
      var once = C(s);
      eq("css idempotent " + k, C(once), once);
      eq("css minify stable " + k, minifyCss(once, true), minifyCss(s, true));
    });
    return fails.length ? fails : true;
  };

  render();
})();
