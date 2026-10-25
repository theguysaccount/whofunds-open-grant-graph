// WHOFUNDS client script: search (typeahead + results page), share, corrections,
// alert signup and cookieless analytics events. Works on the server-rendered site
// (Vercel functions) and the static one (GitHub Pages, search over gzipped shards).
(function () {
  "use strict";
  var meta = document.querySelector('meta[name="whofunds"]');
  var md = meta ? meta.dataset : {};
  var BASE = md.base || "";
  var STATIC = md.mode === "static";
  var V = md.v || "1";
  var page = document.body.getAttribute("data-page") || "";
  var host = location.hostname;
  var local = host === "localhost" || host === "127.0.0.1" || /\.local$/.test(host);
  var optOut = navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.globalPrivacyControl === true;

  // ---------------------------------------------------------------- analytics
  // Off unless configured. Vercel Web Analytics (server) or GoatCounter (static) are both
  // cookieless; both are skipped locally and for Do Not Track / Global Privacy Control.
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  if (md.analytics === "vercel" && !local && !optOut) {
    var s = document.createElement("script");
    s.defer = true;
    s.src = "/_vercel/insights/script.js";
    document.head.appendChild(s);
  }
  if (md.analytics === "goatcounter" && (local || optOut)) window.goatcounter = { no_onload: true };
  var trackLog = (window.__whofundsEvents = window.__whofundsEvents || []);
  function track(name, data) {
    trackLog.push({ name: name, data: data || {} });
    if (optOut || local) return;
    try {
      if (md.analytics === "vercel") window.va("event", { name: name, data: data || {} });
      if (md.analytics === "goatcounter" && window.goatcounter && window.goatcounter.count) {
        window.goatcounter.count({ path: "event/" + name, title: (data && data.from) || page, event: true });
      }
    } catch (e) { /* ignore */ }
  }
  window.whofundsTrack = track;

  function ctx() {
    var entity = document.querySelector("[data-entity]");
    return entity ? { kind: entity.getAttribute("data-entity"), ein: entity.getAttribute("data-ein") } : {};
  }

  // Activation (funder_open) and other link events.
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("[data-ev]");
    if (!a) return;
    var c = ctx();
    track(a.getAttribute("data-ev"), { from: c.kind || page, ein: c.ein || "", fe: a.getAttribute("data-fe") || "", kind: a.getAttribute("data-kind") || "page" });
  });

  // Collapsed tables ("Show all 41 funders"). Static pages with a partial list are
  // handled first by entity.js, which loads the full record.
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-expand]");
    if (!b || b.hasAttribute("data-load")) return;
    var t = document.querySelector('[data-collapsible="' + b.getAttribute("data-expand") + '"]');
    if (t) { t.classList.add("expanded"); b.parentNode.removeChild(b); track("expand", { from: ctx().kind || page }); }
  });

  // ---------------------------------------------------------------- helpers
  function money(n) {
    n = Number(n) || 0;
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return "$" + Math.round(n / 1e3) + "K";
    return "$" + n;
  }
  function escHtml(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmtEin(e) { return e && e.length === 9 ? e.slice(0, 2) + "-" + e.slice(2) : e; }
  function hrefFor(r) {
    var dir = r.kind === "org" ? "org" : "foundation";
    if (!STATIC) return BASE + "/" + dir + "/" + r.ein;
    return r.st ? BASE + "/" + dir + "/" + r.ein + "/" : BASE + "/" + dir + "/?ein=" + r.ein;
  }
  function norm(s) {
    return String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’]/g, "")
      .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  }
  function readJson(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.arrayBuffer(); }).then(function (buf) {
      var u8 = new Uint8Array(buf);
      if (u8[0] === 0x1f && u8[1] === 0x8b) {
        return new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"))).text().then(JSON.parse);
      }
      return JSON.parse(new TextDecoder().decode(u8));
    });
  }

  // ---------------------------------------------------------------- search
  // Static: shards of [name, ein, kind, city, state, total, count, static] keyed by the
  // first 3 letters of each distinctive word. Must match build-pages.mjs.
  var STOP = { the: 1, of: 1, and: 1, "for": 1, inc: 1, "in": 1, at: 1, on: 1, to: 1, a: 1, an: 1, co: 1, corp: 1, llc: 1,
    foundation: 1, fund: 1, trust: 1, charitable: 1, family: 1, association: 1, society: 1, church: 1, center: 1, school: 1,
    county: 1, community: 1 };
  var shards = {};
  function shard(url) { if (!shards[url]) shards[url] = readJson(url).catch(function () { return null; }); return shards[url]; }
  function asResult(x) {
    return { name: x[0], ein: x[1], kind: x[2] === "o" ? "org" : "foundation", city: x[3], state: x[4], total: x[5], count: x[6], st: x[7] };
  }
  function searchStatic(q, limit) {
    var raw = String(q || "").trim();
    var digits = raw.replace(/[^0-9]/g, "");
    if (/^[0-9\s-]+$/.test(raw) && digits.length >= 7 && digits.length <= 9) {
      var ein = ("000000000" + digits).slice(-9);
      return shard(BASE + "/s/ein/" + ein.slice(0, 3) + ".json.gz?v=" + V).then(function (obj) {
        return ((obj && obj[ein]) || []).map(asResult);
      });
    }
    var qn = norm(raw);
    var toks = qn.split(" ").filter(function (t) { return t; });
    var keyTok = toks.filter(function (t) { return !STOP[t] && t.length >= 3; }).sort(function (a, b) { return b.length - a.length; })[0] ||
      toks.filter(function (t) { return t.length >= 3; }).sort(function (a, b) { return b.length - a.length; })[0];
    if (!keyTok) return Promise.resolve([]);
    var needles = toks.filter(function (t) { return !STOP[t] || toks.length === 1; }).map(function (t) { return " " + t; });
    var whole = " " + qn + " ";
    return shard(BASE + "/s/" + keyTok.slice(0, 3) + ".json.gz?v=" + V).then(function (list) {
      if (!list) return [];
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var x = list[i], s = " " + norm(x[0]) + " ", ok = true;
        for (var j = 0; j < needles.length; j++) if (s.indexOf(needles[j]) < 0) { ok = false; break; }
        if (!ok) continue;
        var score = Math.log(1 + (x[5] || 0)) / Math.LN10 + Math.log(1 + (x[6] || 0)) / Math.LN2;
        if (s === whole || s === " the" + whole) score += 40;
        else if (s.indexOf(whole.slice(0, -1)) === 0 || s.indexOf(" the" + whole.slice(0, -1)) === 0) score += 20;
        out.push([score, x]);
      }
      out.sort(function (a, b) { return b[0] - a[0]; });
      return out.slice(0, limit).map(function (p) { return asResult(p[1]); });
    });
  }
  function search(q, limit) {
    if (STATIC) return searchStatic(q, limit);
    return fetch(BASE + "/api/search?q=" + encodeURIComponent(q) + "&limit=" + limit).then(function (r) { return r.json(); }).then(function (d) { return d.results || []; });
  }
  function resultMeta(r) {
    return [r.city, r.state].filter(Boolean).join(", ") + " · " + (r.kind === "org"
      ? money(r.total) + " from " + r.count + " foundation" + (r.count === 1 ? "" : "s")
      : money(r.total) + " in grants");
  }

  function bindTypeahead(input) {
    if (input.__ta) return;
    input.__ta = true;
    var box = input.parentNode.querySelector(".ta");
    var timer = null, seq = 0, items = [], sel = -1;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    function close() { box.hidden = true; input.setAttribute("aria-expanded", "false"); sel = -1; }
    function render() {
      if (!items.length) { close(); return; }
      box.innerHTML = items.map(function (r, i) {
        return '<a role="option" id="ta-' + i + '" href="' + hrefFor(r) + '" aria-selected="' + (i === sel) + '"><span class="kind kind-' + r.kind + '">' + (r.kind === "org" ? "Org" : "Foundation") + '</span><span class="t-name">' + escHtml(r.name) + '</span><span class="t-meta">' + escHtml(resultMeta(r)) + "</span></a>";
      }).join("");
      box.hidden = false;
      input.setAttribute("aria-expanded", "true");
    }
    input.addEventListener("input", function () {
      var q = input.value.trim();
      clearTimeout(timer);
      if (q.length < 3) { items = []; close(); return; }
      timer = setTimeout(function () {
        var my = ++seq;
        search(q, 8).then(function (res) {
          if (my !== seq) return;
          items = res; sel = -1; render();
        }).catch(function () { /* the form still submits */ });
      }, 140);
    });
    input.addEventListener("keydown", function (e) {
      if (box.hidden) return;
      if (e.key === "ArrowDown") { sel = Math.min(items.length - 1, sel + 1); render(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { sel = Math.max(-1, sel - 1); render(); e.preventDefault(); }
      else if (e.key === "Escape") { close(); }
      else if (e.key === "Enter" && sel >= 0) {
        e.preventDefault();
        var r = items[sel];
        track("search", { q_len: input.value.trim().length, pick: r.kind });
        location.href = hrefFor(r);
      }
    });
    box.addEventListener("mousedown", function (e) {
      var a = e.target.closest("a");
      if (a) track("search", { q_len: input.value.trim().length, pick: a.getAttribute("href").indexOf("/org/") >= 0 ? "org" : "foundation" });
    });
    document.addEventListener("click", function (e) { if (!input.parentNode.contains(e.target)) close(); });
    input.form.addEventListener("submit", function () { track("search", { q_len: input.value.trim().length, pick: "results" }); });
  }
  function bindAll() {
    Array.prototype.forEach.call(document.querySelectorAll("input[data-typeahead]"), bindTypeahead);
    Array.prototype.forEach.call(document.querySelectorAll("form[data-collect]"), bindForm);
  }

  // Static results page: /search/?q=...
  if (STATIC && page === "search") {
    var q0 = new URLSearchParams(location.search).get("q") || "";
    var inp = document.getElementById("q-page");
    if (inp) inp.value = q0;
    var list = document.getElementById("results"), note = document.getElementById("search-note"), title = document.getElementById("search-title");
    if (q0) {
      title.textContent = "Results for “" + q0 + "”";
      document.title = "Search: " + q0 + " · WHOFUNDS";
      search(q0, 50).then(function (res) {
        if (!res.length) {
          note.textContent = "No organization or foundation matched. Try a distinctive word from the name, or search by EIN. WHOFUNDS lists organizations that at least one private foundation reported paying (and that could be matched to an EIN), plus every foundation that filed a 990-PF.";
          return;
        }
        list.innerHTML = res.map(function (r) {
          return '<li class="res"><a href="' + hrefFor(r) + '"><span class="kind kind-' + r.kind + '">' + (r.kind === "org" ? "Organization" : "Foundation") + "</span> " + escHtml(r.name) + '</a><span class="small muted">' + escHtml(resultMeta(r)) + " · EIN " + fmtEin(r.ein) + "</span></li>";
        }).join("");
      });
    }
  }

  // ---------------------------------------------------------------- share
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-share]");
    if (!b) return;
    e.preventDefault();
    var url = (document.querySelector('link[rel="canonical"]') || {}).href || location.href;
    var text = b.getAttribute("data-share-text") || document.title;
    track("share", { from: ctx().kind || page, ein: ctx().ein || "" });
    if (navigator.share) {
      navigator.share({ title: document.title, text: text, url: url }).catch(function () {});
      return;
    }
    var old = document.querySelector(".share-pop");
    if (old) { old.remove(); return; }
    var pop = document.createElement("div");
    pop.className = "share-pop";
    var enc = encodeURIComponent;
    pop.innerHTML = '<button class="btn" data-copy>Copy link</button>' +
      '<a target="_blank" rel="noopener" href="https://www.linkedin.com/sharing/share-offsite/?url=' + enc(url) + '">Share on LinkedIn</a>' +
      '<a target="_blank" rel="noopener" href="https://x.com/intent/post?text=' + enc(text) + "&url=" + enc(url) + '">Post on X</a>' +
      '<a href="mailto:?subject=' + enc(document.title) + "&body=" + enc(text + " " + url) + '">Email</a>';
    var r = b.getBoundingClientRect();
    pop.style.top = window.scrollY + r.bottom + 6 + "px";
    pop.style.left = Math.max(8, Math.min(window.scrollX + r.left, window.innerWidth - 220)) + "px";
    document.body.appendChild(pop);
    pop.querySelector("[data-copy]").addEventListener("click", function (ev) {
      ev.preventDefault();
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () {
        ev.target.textContent = "Copied";
      }, function () { window.prompt("Copy this link", url); });
    });
    setTimeout(function () {
      document.addEventListener("click", function off(ev) { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener("click", off); } });
    }, 0);
  });

  // ---------------------------------------------------------------- collect forms (server mode)
  function post(payload) {
    return fetch(BASE + "/api/collect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: "Unexpected response" }; }); });
  }
  function bindForm(form) {
    if (form.__bound) return;
    form.__bound = true;
    var hp = document.createElement("input");
    hp.type = "text"; hp.name = "website"; hp.tabIndex = -1; hp.autocomplete = "off"; hp.setAttribute("aria-hidden", "true");
    hp.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px";
    form.appendChild(hp);
    form.addEventListener("submit", function (e) {
      var type = form.getAttribute("data-collect");
      if (e.submitter && e.submitter.value === "cancel") return;
      e.preventDefault();
      var data = {};
      new FormData(form).forEach(function (v, k) { data[k] = v; });
      data.type = type;
      data.page = location.pathname;
      var msg = form.querySelector(".form-msg");
      var btn = form.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;
      post(data).then(function (d) {
        if (msg) { msg.textContent = d.ok ? d.message || "Thanks." : d.error || "Couldn't send."; msg.className = "form-msg small " + (d.ok ? "ok" : "err"); }
        if (d.ok) {
          track(type === "alert" ? "alert_signup" : "correction_submit", { from: ctx().kind || page, ein: ctx().ein || "" });
          if (type === "alert") form.querySelector('input[type="email"]').value = "";
          if (type === "correction") setTimeout(function () { var dlg = form.closest("dialog"); if (dlg) dlg.close(); }, 1400);
        }
      }).catch(function () {
        if (msg) { msg.textContent = "Network error. Please try again."; msg.className = "form-msg small err"; }
      }).then(function () { if (btn) btn.disabled = false; });
    });
  }

  // Correction dialog (server mode; the static site links to prefilled GitHub issues).
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("[data-correct]");
    var dlg = document.getElementById("correct-dlg");
    if (!a || !dlg) return;
    e.preventDefault();
    var f = dlg.querySelector("form");
    f.reset();
    f.querySelector(".form-msg").textContent = "";
    f.org_ein.value = a.getAttribute("data-correct") || "";
    f.fdn_ein.value = a.getAttribute("data-fe") || "";
    f.object_id.value = a.getAttribute("data-oid") || "";
    f.page.value = location.pathname;
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
    track("correction_open", { ein: ctx().ein || "" });
  });

  // Static site: "Wrong?" opens a prefilled public GitHub issue (built here, not in the page).
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("[data-wrong]");
    if (!a) return;
    e.preventDefault();
    var pageEl = document.querySelector("[data-entity]");
    var orgName = pageEl ? pageEl.getAttribute("data-name") : "";
    var orgEin = a.getAttribute("data-wrong"), fe = a.getAttribute("data-fe"), oid = a.getAttribute("data-oid");
    var row = a.closest("tr"), fdnName = row ? (row.querySelector("td a") || {}).textContent || "" : "";
    var title = fe ? "Wrong match: " + fdnName + " → " + orgName + " (EIN " + fmtEin(orgEin) + ")" : "Wrong match on " + orgName + " (EIN " + fmtEin(orgEin) + ")";
    var body = ["Page: " + location.origin + location.pathname + location.search,
      fe ? "Foundation EIN: " + fmtEin(fe) : "", fe && oid ? "Filing: https://projects.propublica.org/nonprofits/organizations/" + fe + "/" + oid + "/full" : "",
      "", "What's wrong (pick one): different organization / wrong chapter or affiliate / names a private individual / other", "",
      "Correct organization or EIN, if you know it:", "", "Evidence or note:", "",
      "Please don't include personal contact details; this issue is public."].join("\n");
    track("correction_open", { ein: orgEin });
    window.open("https://github.com/" + md.repo + "/issues/new?labels=correction&title=" + encodeURIComponent(title) + "&body=" + encodeURIComponent(body), "_blank", "noopener");
  });

  // ---------------------------------------------------------------- corrections page
  var queue = document.getElementById("queue");
  if (queue) {
    fetch(BASE + "/api/corrections").then(function (r) { return r.json(); }).then(function (d) {
      var items = d.items || [];
      if (!items.length) { queue.innerHTML = '<p class="muted" style="padding:12px">No reports yet. The first one could be yours.</p>'; return; }
      queue.innerHTML = '<table class="ledger"><thead><tr><th>Reported</th><th>About</th><th>Issue</th><th>Suggested</th><th>Status</th></tr></thead><tbody>' +
        items.map(function (it) {
          var about = it.type === "fixit_vote" ? "Unmatched payee vs EIN " + it.near_ein : (it.fdn_ein ? '<a href="' + BASE + "/foundation/" + it.fdn_ein + '">' + it.fdn_ein + "</a> → " : "") + (it.org_ein ? '<a href="' + BASE + "/org/" + it.org_ein + '">' + it.org_ein + "</a>" : "");
          var issue = { wrong_org: "Different organization", chapter: "Wrong chapter/affiliate", individual: "Concerns an individual", other: "Other", same: "Same organization", different: "Not the same" }[it.issue] || it.issue;
          return "<tr><td>" + escHtml((it.at || "").slice(0, 10)) + "</td><td>" + about + "</td><td>" + escHtml(issue) + (it.has_note ? ' <span class="muted small">(note, private until reviewed)</span>' : "") + "</td><td>" + (it.suggested_ein ? '<a href="' + BASE + "/org/" + it.suggested_ein + '">' + it.suggested_ein + "</a>" : "—") + "</td><td>" + escHtml(it.status) + "</td></tr>";
        }).join("") + "</tbody></table>";
    }).catch(function () { queue.innerHTML = '<p class="muted" style="padding:12px">The queue could not be loaded.</p>'; });
  }
  var fixit = document.getElementById("fixit");
  if (fixit) {
    readJson(BASE + "/assets/fixit.json?v=" + V).then(function (all) {
      var start = Math.floor(Math.random() * Math.max(1, Math.min(all.length - 12, 120)));
      var pick = all.slice(start, start + 12);
      function issueHref(x, vote) {
        var t = (vote === "same" ? "Same organization: " : "Different organization: ") + x.name + " (" + x.state + ") vs EIN " + fmtEin(x.near_ein);
        var body = "Filed payee: " + x.name + " (" + x.state + "), " + x.rows + " grant lines\nNearest IRS record: " + x.near_name + ", EIN " + fmtEin(x.near_ein) +
          "\nhttps://projects.propublica.org/nonprofits/organizations/" + x.near_ein + "\n\nVote: " + vote + "\n\nEvidence (optional):\n";
        return "https://github.com/" + md.repo + "/issues/new?labels=correction&title=" + encodeURIComponent(t) + "&body=" + encodeURIComponent(body);
      }
      fixit.innerHTML = pick.map(function (x, i) {
        var actions = STATIC
          ? '<div class="actions"><a class="btn" target="_blank" rel="noopener" data-ev="correction_open" href="' + issueHref(x, "same") + '">Same organization</a><a class="btn" target="_blank" rel="noopener" data-ev="correction_open" href="' + issueHref(x, "different") + '">Different</a></div>'
          : '<div class="actions"><button class="btn" data-vote="same">Same organization</button><button class="btn" data-vote="different">Different</button></div><p class="form-msg small" role="status"></p>';
        return '<li data-i="' + i + '"><span class="small muted">Filed as</span><br><strong>' + escHtml(x.name) + "</strong> <span class=\"muted\">" + escHtml(x.state) + "</span>" +
          '<br><span class="small">' + x.rows + " grant line" + (x.rows === 1 ? "" : "s") + ", " + money(x.dollars) + '</span><br><span class="small muted">Nearest IRS record we refused:</span><br>' +
          '<a href="https://projects.propublica.org/nonprofits/organizations/' + x.near_ein + '" target="_blank" rel="noopener">' + escHtml(x.near_name) + "</a> <span class=\"small muted\">EIN " + x.near_ein + " · score " + escHtml(x.near_score) + "</span>" + actions + "</li>";
      }).join("");
      if (!STATIC) {
        fixit.addEventListener("click", function (e) {
          var b = e.target.closest("[data-vote]");
          if (!b) return;
          var li = b.closest("li"), x = pick[Number(li.getAttribute("data-i"))];
          post({ type: "fixit_vote", issue: b.getAttribute("data-vote"), near_ein: x.near_ein, filed_name: x.name, state: x.state, page: location.pathname }).then(function (d) {
            li.querySelector(".form-msg").textContent = d.ok ? "Recorded. Thank you." : d.error || "Couldn't record.";
            if (d.ok) { track("correction_submit", { from: "fixit" }); Array.prototype.forEach.call(li.querySelectorAll("button"), function (x2) { x2.disabled = true; }); }
          });
        });
      }
    }).catch(function () { fixit.innerHTML = '<li class="muted">Could not load the list.</li>'; });
  }

  bindAll();
  document.addEventListener("whofunds:rendered", bindAll);
})();
