/**
 * Browser half of the session shelf.
 *
 * Ships as a plain module-loader factory (the loader hands us react and friends
 * through require). It renders one sidebar rail button and one full central
 * panel; archive and favourite mutations go through the harness' own client
 * services, while the destructive purge is a same-origin call to this plugin's
 * host route.
 */
window.__ModuleLoader__.load({ id: "dsh-session-shelf", factory: (require) => {
  var module = { exports: {} };
  var exports = module.exports;

  var react = require("react");
  var h = react.createElement;
  var useState = react.useState;
  var useEffect = react.useEffect;
  var useMemo = react.useMemo;
  var useCallback = react.useCallback;
  var useRef = react.useRef;

  var API = "/api/session-shelf";
  var PANEL_KEY = "session-shelf";
  var STYLE_ID = "dss-shelf-style";

  /* Services that are looked up lazily: the panel may mount before the harness
   * finishes wiring them, and a missing service must degrade to a toast rather
   * than a crash. */
  var RUNTIME = { uiWorkspace: null, layout: null };

  /* ------------------------------------------------------------------ i18n */

  var DICT = {
    zh: {
      nav: "会话书柜",
      title: "会话书柜",
      tabs: "分类",
      tabArchived: "归档",
      tabPinned: "收藏",
      tabAll: "全部",
      search: "搜索标题、路径或会话 ID",
      searchClear: "清除搜索",
      sort: "排序",
      sortRecent: "最近活动",
      sortOldest: "最早活动",
      sortTitle: "按标题",
      group: "分组显示",
      groupHint: "按工作区分组显示",
      expandGroup: "展开分组",
      collapseGroup: "收起分组",
      refresh: "刷新",
      loading: "正在读取会话…",
      loadError: "读取失败：{msg}",
      retry: "重试",
      emptyArchived: "还没有归档会话。在侧边栏归档任意会话后，它会出现在这里。",
      emptyPinned: "还没有收藏会话。点击行内的星标即可收藏。",
      emptyAll: "当前没有任何会话。",
      emptySearch: "没有匹配的会话。",
      untitled: "未命名会话",
      badgeArchived: "归档",
      issueNoLog: "日志缺失",
      issueNoMeta: "无元数据",
      issueBadMeta: "元数据损坏",
      issueUnregistered: "未登记",
      actPin: "收藏",
      actUnpin: "取消收藏",
      actRestore: "恢复",
      actArchive: "归档",
      archiveDone: "已归档",
      archiveFailed: "归档失败：{msg}",
      actRepair: "修复元数据",
      repairDone: "已清除损坏的元数据缓存，下次打开会话时会自动重建",
      repairFailed: "修复失败：{msg}",
      actDelete: "永久删除",
      actCopy: "复制 ID",
      copyDone: "已复制会话 ID",
      copyFailed: "复制失败",
      selected: "已选 {n} 项",
      clear: "清空选择",
      batchRestore: "恢复所选",
      batchDelete: "删除所选",
      selectAll: "全选当前列表",
      confirmTitle: "永久删除会话",
      confirmBody: "将删除 {n} 个会话的日志、元数据与登记信息，此操作无法撤销。",
      confirmHint: "最近有活动的会话会被跳过，除非勾选强制删除。",
      confirmSync: "删除前会先归档该会话，让左侧列表立即同步隐藏。",
      confirmForce: "强制删除（即使会话最近有活动）",
      confirmOk: "确认删除",
      cancel: "取消",
      working: "处理中…",
      deleteDone: "已删除 {n} 个会话",
      deleteSkipped: "{n} 个会话最近有活动，已跳过",
      deleteFailed: "删除失败：{msg}",
      restoreDone: "已恢复",
      restoreDoneMany: "已恢复 {n} 个会话",
      restoreFailed: "恢复失败：{msg}",
      pinDone: "已收藏",
      unpinDone: "已取消收藏",
      pruneBanner: "有 {n} 条归档或收藏记录找不到对应会话文件。",
      pruneAction: "清理失效记录",
      pruneDone: "已清理 {n} 条记录",
      pruneNone: "没有需要清理的记录",
      ghostBanner: "侧栏还挂着 {n} 条已删除会话的记录（只存在于 Harness 内存快照里）。",
      ghostAction: "同步侧栏",
      ghostDone: "已让 Harness 丢弃 {n} 条残留记录",
      ghostNone: "没有残留记录",
      ghostFailed: "同步失败：{msg}",
      registryIssue: "会话登记表无法读取（{reason}），列表可能不完整。",
      footerUpdated: "更新于 {time}",
      footerAuto: "每 15 秒自动刷新",
      footerNoLog: "{n} 项缺少日志",
      close: "关闭",
      relNow: "刚刚",
      relMin: "{n} 分钟前",
      relHour: "{n} 小时前",
      relDay: "{n} 天前",
      errActive: "该会话正在使用中，请先关闭它",
      errNoService: "当前界面缺少会话服务，请重启 Harness 后再试",
      errUnknown: "未知错误",
    },
    en: {
      nav: "Session shelf",
      title: "Session shelf",
      tabs: "Sections",
      tabArchived: "Archived",
      tabPinned: "Favourites",
      tabAll: "All",
      search: "Search title, path or session id",
      searchClear: "Clear search",
      sort: "Sort",
      sortRecent: "Recently active",
      sortOldest: "Least recently active",
      sortTitle: "Title",
      group: "Group by workspace",
      groupHint: "Group rows by workspace",
      expandGroup: "Expand group",
      collapseGroup: "Collapse group",
      refresh: "Refresh",
      loading: "Reading sessions…",
      loadError: "Could not load: {msg}",
      retry: "Retry",
      emptyArchived: "Nothing archived yet. Archive a session from the sidebar and it lands here.",
      emptyPinned: "No favourites yet. Use the star on any row to add one.",
      emptyAll: "No sessions found.",
      emptySearch: "No session matches this search.",
      untitled: "Untitled session",
      badgeArchived: "Archived",
      issueNoLog: "log missing",
      issueNoMeta: "no metadata",
      issueBadMeta: "metadata broken",
      issueUnregistered: "unregistered",
      actPin: "Favourite",
      actUnpin: "Remove favourite",
      actRestore: "Restore",
      actArchive: "Archive",
      archiveDone: "Archived",
      archiveFailed: "Archive failed: {msg}",
      actRepair: "Repair metadata",
      repairDone: "Broken metadata cache cleared; it rebuilds the next time the session opens",
      repairFailed: "Repair failed: {msg}",
      actDelete: "Delete permanently",
      actCopy: "Copy id",
      copyDone: "Session id copied",
      copyFailed: "Copy failed",
      selected: "{n} selected",
      clear: "Clear selection",
      batchRestore: "Restore selected",
      batchDelete: "Delete selected",
      selectAll: "Select every row in this list",
      confirmTitle: "Delete sessions permanently",
      confirmBody: "This removes logs, metadata and registry entries for {n} session(s). It cannot be undone.",
      confirmHint: "Sessions with recent activity are skipped unless you force the deletion.",
      confirmSync: "Each session is archived first so the sidebar hides it right away.",
      confirmForce: "Force deletion even for recently active sessions",
      confirmOk: "Delete",
      cancel: "Cancel",
      working: "Working…",
      deleteDone: "Deleted {n} session(s)",
      deleteSkipped: "Skipped {n} recently active session(s)",
      deleteFailed: "Delete failed: {msg}",
      restoreDone: "Restored",
      restoreDoneMany: "Restored {n} session(s)",
      restoreFailed: "Restore failed: {msg}",
      pinDone: "Added to favourites",
      unpinDone: "Removed from favourites",
      pruneBanner: "{n} archive/favourite entr(y/ies) point at sessions that no longer exist.",
      pruneAction: "Drop stale entries",
      pruneDone: "Dropped {n} stale entr(y/ies)",
      pruneNone: "Nothing to clean up",
      ghostBanner: "{n} deleted session(s) still linger in the sidebar (in-memory snapshot only).",
      ghostAction: "Sync sidebar",
      ghostDone: "Asked the harness to forget {n} ghost record(s)",
      ghostNone: "No ghost record",
      ghostFailed: "Sync failed: {msg}",
      registryIssue: "The workspace registry is unreadable ({reason}); this list may be incomplete.",
      footerUpdated: "Updated {time}",
      footerAuto: "Refreshes every 15s",
      footerNoLog: "{n} without a log",
      close: "Close",
      relNow: "just now",
      relMin: "{n} min ago",
      relHour: "{n} h ago",
      relDay: "{n} d ago",
      errActive: "This session is in use — close it first",
      errNoService: "Session services are unavailable; restart the harness and try again",
      errUnknown: "Unknown error",
    },
  };

  function detectLang() {
    try {
      var list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""];
      for (var i = 0; i < list.length; i += 1) {
        var tag = String(list[i] || "").toLowerCase();
        if (tag.indexOf("zh") === 0) return "zh";
        if (tag.indexOf("en") === 0) return "en";
      }
    } catch (error) {
      /* navigator unavailable in tests */
    }
    return "zh";
  }

  function makeT(lang) {
    var table = DICT[lang] || DICT.zh;
    return function translate(key, params) {
      var text = table[key] != null ? table[key] : key;
      if (!params) return text;
      return text.replace(/\{(\w+)\}/g, function (match, name) {
        return params[name] != null ? String(params[name]) : match;
      });
    };
  }

  /* ------------------------------------------------------------- utilities */

  function report(stage, message, detail) {
    try {
      fetch(API + "/client-report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stage: stage, message: message || null, detail: detail || null }),
        keepalive: true,
      }).catch(function () {});
    } catch (error) {
      /* reporting must never break the UI */
    }
  }

  function pad2(value) {
    return value < 10 ? "0" + value : String(value);
  }

  function fmtBytes(bytes) {
    if (!bytes || bytes < 0) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function fmtWhen(ts, t) {
    if (!ts) return "";
    var diff = Date.now() - ts;
    if (diff < 60e3) return t("relNow");
    if (diff < 3600e3) return t("relMin", { n: Math.floor(diff / 60e3) });
    if (diff < 86400e3) return t("relHour", { n: Math.floor(diff / 3600e3) });
    if (diff < 7 * 86400e3) return t("relDay", { n: Math.floor(diff / 86400e3) });
    var date = new Date(ts);
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
  }

  function fmtClock(ts) {
    if (!ts) return "";
    var date = new Date(ts);
    return pad2(date.getHours()) + ":" + pad2(date.getMinutes()) + ":" + pad2(date.getSeconds());
  }

  function shortPath(value) {
    if (!value) return "";
    var normalized = String(value);
    if (normalized.length <= 48) return normalized;
    return normalized.slice(0, 20) + "…" + normalized.slice(-26);
  }

  function cls() {
    var parts = [];
    for (var i = 0; i < arguments.length; i += 1) if (arguments[i]) parts.push(arguments[i]);
    return parts.join(" ");
  }

  function service(ctx, name) {
    if (RUNTIME[name]) return RUNTIME[name];
    var scope = ctx;
    for (var i = 0; scope && i < 4; i += 1) {
      try {
        if (typeof scope.get === "function") {
          var found = scope.get(name);
          if (found) return found;
        }
      } catch (error) {
        /* service not registered on this scope */
      }
      try {
        if (scope[name]) return scope[name];
      } catch (error) {
        /* getter threw; keep walking */
      }
      try {
        scope = scope.parent;
      } catch (error) {
        scope = null;
      }
    }
    return undefined;
  }

  function callService(ctx, name, method, args) {
    var target = service(ctx, name);
    if (!target || typeof target[method] !== "function") {
      var missing = new Error(method + "@" + name);
      missing.code = "service-unavailable";
      return Promise.reject(missing);
    }
    try {
      return Promise.resolve(target[method].apply(target, args || []));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function describeError(error, t) {
    var code = error && (error.code || (error.cause && error.cause.code));
    var text = String((error && error.message) || error || "");
    if (code === "service-unavailable") return t("errNoService");
    if (code === "workspace/session-active" || /session-active/.test(text)) return t("errActive");
    return text || t("errUnknown");
  }

  /* ------------------------------------------------------------- data hook */

  function useShelf() {
    var pair = useState({ status: "loading", data: null, error: null });
    var state = pair[0];
    var setState = pair[1];

    var reload = useCallback(function (options) {
      var silent = !!(options && options.silent);
      var fresh = !!(options && options.fresh);
      if (!silent) {
        setState(function (prev) {
          return { status: prev.data ? "refreshing" : "loading", data: prev.data, error: null };
        });
      }
      var url = API + "/state?scope=all" + (fresh ? "&fresh=1" : "");
      return fetch(url, { cache: "no-store" })
        .then(function (response) {
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.json();
        })
        .then(function (data) {
          var sessions = (data && Array.isArray(data.sessions) ? data.sessions : []).map(function (item) {
            return {
              id: item.id,
              title: item.title || "",
              cwd: item.cwd || "",
              workspaceId: item.workspaceId || null,
              workspaceTitle: item.workspaceTitle || null,
              workspacePath: item.workspacePath || null,
              archived: !!item.archived,
              pinned: !!item.pinned,
              issues: Array.isArray(item.issues) ? item.issues : [],
              createdAt: item.createdAt || 0,
              updatedAt: item.updatedAt || 0,
              log: item.log || null,
            };
          });
          var shaped = {
            generatedAt: (data && data.generatedAt) || Date.now(),
            home: (data && data.home) || "",
            workspacePath: (data && data.workspacePath) || "",
            sessions: sessions,
            workspaces: (data && Array.isArray(data.workspaces) ? data.workspaces : []),
            counts: (data && data.counts) || { archived: 0, pinned: 0, listed: sessions.length },
            archivedSessionIds: (data && Array.isArray(data.archivedSessionIds) ? data.archivedSessionIds : []),
            pinnedSessionIds: (data && Array.isArray(data.pinnedSessionIds) ? data.pinnedSessionIds : []),
            registryIssue: (data && data.registryIssue) || null,
            ghosts: data && Array.isArray(data.ghosts) ? data.ghosts : [],
          };
          setState({ status: "ready", data: shaped, error: null });
          return shaped;
        })
        .catch(function (error) {
          setState(function (prev) {
            return { status: prev.data ? "ready" : "error", data: prev.data, error: (error && error.message) || String(error) };
          });
          return null;
        });
    }, []);

    useEffect(function () {
      reload();
      var timer = setInterval(function () {
        if (typeof document === "undefined" || document.visibilityState === "visible") reload({ silent: true });
      }, 15000);
      var onFocus = function () {
        reload({ silent: true });
      };
      window.addEventListener("focus", onFocus);
      return function () {
        clearInterval(timer);
        window.removeEventListener("focus", onFocus);
      };
    }, [reload]);

    return { state: state, reload: reload };
  }

  function useToasts() {
    var pair = useState([]);
    var items = pair[0];
    var setItems = pair[1];
    var push = useCallback(function (tone, text) {
      var id = Math.random().toString(36).slice(2);
      setItems(function (prev) {
        return prev.concat([{ id: id, tone: tone, text: text }]);
      });
      setTimeout(function () {
        setItems(function (prev) {
          return prev.filter(function (item) {
            return item.id !== id;
          });
        });
      }, 5200);
    }, []);
    return { items: items, push: push };
  }

  /* ------------------------------------------------------------ components */

  function ShelfIcon(props) {
    var size = (props && props.size) || 16;
    return h(
      "svg",
      { width: size, height: size, viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true" },
      h("path", { d: "M2 13.4h12", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round" }),
      h("rect", { x: 3.05, y: 4.5, width: 2.7, height: 8.9, rx: 0.9, stroke: "currentColor", strokeWidth: 1.2 }),
      h("rect", { x: 6.65, y: 6.1, width: 2.7, height: 7.3, rx: 0.9, stroke: "currentColor", strokeWidth: 1.2 }),
      h("rect", { x: 10.25, y: 5.2, width: 2.7, height: 8.2, rx: 0.9, stroke: "currentColor", strokeWidth: 1.2 }),
    );
  }

  function Badge(props) {
    return h("span", { className: cls("dss-badge", props.tone && "dss-badge-" + props.tone), title: props.title || undefined }, props.children);
  }

  function SearchIcon(props) {
    var size = (props && props.size) || 14;
    return h(
      "svg",
      { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
      h("circle", { cx: 7, cy: 7, r: 4.4, stroke: "currentColor", strokeWidth: 1.3 }),
      h("path", { d: "M10.4 10.4 13.6 13.6", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round" }),
    );
  }

  function Chevron(props) {
    return h(
      "svg",
      {
        width: 12,
        height: 12,
        viewBox: "0 0 12 12",
        fill: "none",
        "aria-hidden": "true",
        className: props.open ? "dss-chevron is-open" : "dss-chevron",
      },
      h("path", { d: "M2.6 4.4 6 7.8l3.4-3.4", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" }),
    );
  }

  /**
   * A theme-owned picker. The harness panel sits inside a scrolling host, so a
   * bare <select> lets the platform popup bleed out of the panel and paints its
   * options with the platform palette. This menu is placed with fixed
   * coordinates measured from the trigger, so it can never be clipped, and it
   * borrows Canvas/CanvasText so it always matches the surrounding surface.
   */
  function Dropdown(props) {
    var openState = useState(false);
    var open = openState[0];
    var setOpen = openState[1];
    var posState = useState(null);
    var pos = posState[0];
    var setPos = posState[1];
    var trigger = useRef(null);

    var options = props.options || [];
    var current = null;
    for (var index = 0; index < options.length; index += 1) {
      if (options[index].value === props.value) {
        current = options[index];
        break;
      }
    }
    if (!current && options.length > 0) current = options[0];

    var toggle = function () {
      if (open) {
        setOpen(false);
        return;
      }
      var node = trigger.current;
      if (!node) return;
      var rect = node.getBoundingClientRect();
      var itemHeight = 32;
      var menuHeight = options.length * itemHeight + 10;
      var menuWidth = Math.max(rect.width, 168);
      var below = window.innerHeight - rect.bottom;
      var top = below < menuHeight + 12 ? Math.max(8, rect.top - menuHeight - 6) : rect.bottom + 6;
      var left = Math.min(rect.left, Math.max(8, window.innerWidth - menuWidth - 8));
      setPos({ top: top, left: left, width: menuWidth });
      setOpen(true);
    };

    useEffect(
      function () {
        if (!open) return undefined;
        var dismiss = function (event) {
          if (trigger.current && trigger.current.contains(event.target)) return;
          setOpen(false);
        };
        var onKey = function (event) {
          if (event.key === "Escape") setOpen(false);
        };
        var onViewport = function () {
          setOpen(false);
        };
        document.addEventListener("pointerdown", dismiss, true);
        document.addEventListener("keydown", onKey);
        window.addEventListener("resize", onViewport);
        window.addEventListener("scroll", onViewport, true);
        return function () {
          document.removeEventListener("pointerdown", dismiss, true);
          document.removeEventListener("keydown", onKey);
          window.removeEventListener("resize", onViewport);
          window.removeEventListener("scroll", onViewport, true);
        };
      },
      [open],
    );

    return h(
      "div",
      { className: "dss-dd" },
      h(
        "button",
        {
          ref: trigger,
          type: "button",
          className: cls("dss-dd-btn", open && "is-open"),
          "aria-haspopup": "listbox",
          "aria-expanded": open ? "true" : "false",
          title: props.title || undefined,
          onClick: toggle,
        },
        h("span", { className: "dss-dd-text" }, current ? current.label : ""),
        h(Chevron, { open: open }),
      ),
      open && pos
        ? h(
            "div",
            {
              className: "dss-dd-menu",
              role: "listbox",
              style: { top: pos.top + "px", left: pos.left + "px", minWidth: pos.width + "px" },
            },
            options.map(function (option) {
              var active = option.value === props.value;
              return h(
                "button",
                {
                  key: option.value,
                  type: "button",
                  role: "option",
                  "aria-selected": active ? "true" : "false",
                  className: cls("dss-dd-item", active && "is-active"),
                  onClick: function () {
                    setOpen(false);
                    if (!active && typeof props.onChange === "function") props.onChange(option.value);
                  },
                },
                h("span", { className: "dss-dd-item-text" }, option.label),
                active ? h("span", { className: "dss-dd-tick", "aria-hidden": "true" }, "✓") : null,
              );
            }),
          )
        : null,
    );
  }

  function SessionRow(props) {
    var session = props.session;
    var t = props.t;
    var selected = props.selected;
    var active = props.active;
    var meta = [];
    if (session.workspaceTitle) meta.push(session.workspaceTitle);
    if (session.cwd) meta.push(shortPath(session.cwd));
    if (session.updatedAt) meta.push(fmtWhen(session.updatedAt, t));
    if (session.log && session.log.bytes) meta.push(fmtBytes(session.log.bytes));

    var title = session.title || t("untitled");
    return h(
      "div",
      {
        className: cls("dss-row", selected && "is-selected", active && "is-active"),
        onClick: function () {
          props.onToggle(session.id);
        },
      },
      h("input", {
        className: "dss-check",
        type: "checkbox",
        checked: !!selected,
        onChange: function () {
          props.onToggle(session.id);
        },
        onClick: function (event) {
          event.stopPropagation();
        },
      }),
      h(
        "button",
        {
          className: cls("dss-star", session.pinned && "is-on"),
          type: "button",
          title: session.pinned ? t("actUnpin") : t("actPin"),
          "aria-pressed": session.pinned ? "true" : "false",
          onClick: function (event) {
            event.stopPropagation();
            props.onPin(session);
          },
        },
        session.pinned ? "★" : "☆",
      ),
      h(
        "div",
        { className: "dss-main" },
        h(
          "div",
          { className: "dss-titleline" },
          h("span", { className: "dss-title", title: title }, title),
          session.archived ? h(Badge, { tone: "muted" }, t("badgeArchived")) : null,
          session.issues.indexOf("no-log") >= 0 ? h(Badge, { tone: "warn" }, t("issueNoLog")) : null,
          session.issues.indexOf("broken-projection") >= 0 ? h(Badge, { tone: "warn" }, t("issueBadMeta")) : null,
          session.issues.indexOf("no-projection") >= 0 ? h(Badge, { tone: "muted" }, t("issueNoMeta")) : null,
          session.issues.indexOf("unregistered") >= 0 ? h(Badge, { tone: "muted" }, t("issueUnregistered")) : null,
        ),
        h("div", { className: "dss-meta", title: session.cwd || "" }, meta.join(" · ")),
      ),
      h(
        "div",
        { className: "dss-actions" },
        session.issues.indexOf("broken-projection") >= 0
          ? h(
              "button",
              {
                className: "dss-btn",
                type: "button",
                title: t("actRepair"),
                onClick: function (event) {
                  event.stopPropagation();
                  props.onRepair(session);
                },
              },
              t("actRepair"),
            )
          : null,
        session.archived
          ? h(
              "button",
              {
                className: "dss-btn",
                type: "button",
                onClick: function (event) {
                  event.stopPropagation();
                  props.onRestore(session);
                },
              },
              t("actRestore"),
            )
          : props.showArchive
            ? h(
                "button",
                {
                  className: "dss-btn",
                  type: "button",
                  title: t("actArchive"),
                  onClick: function (event) {
                    event.stopPropagation();
                    props.onArchive(session);
                  },
                },
                t("actArchive"),
              )
            : null,
        h(
          "button",
          {
            className: "dss-btn dss-btn-ghost",
            type: "button",
            title: t("actCopy"),
            onClick: function (event) {
              event.stopPropagation();
              props.onCopy(session);
            },
          },
          "ID",
        ),
        h(
          "button",
          {
            className: "dss-btn dss-btn-danger",
            type: "button",
            title: t("actDelete"),
            onClick: function (event) {
              event.stopPropagation();
              props.onDelete(session);
            },
          },
          t("actDelete"),
        ),
      ),
    );
  }

  function EmptyState(props) {
    return h("div", { className: "dss-empty" }, h("div", { className: "dss-empty-icon" }, h(ShelfIcon, { size: 28 })), h("div", null, props.text));
  }

  function ConfirmDialog(props) {
    var t = props.t;
    var pair = useState(false);
    var force = pair[0];
    var setForce = pair[1];
    return h(
      "div",
      {
        className: "dss-overlay",
        onClick: function (event) {
          if (event.target === event.currentTarget && !props.busy) props.onCancel();
        },
      },
      h(
        "div",
        { className: "dss-dialog", role: "dialog", "aria-modal": "true" },
        h("div", { className: "dss-dialog-title" }, t("confirmTitle")),
        h("div", { className: "dss-dialog-body" }, t("confirmBody", { n: props.count })),
        h("div", { className: "dss-dialog-hint" }, t("confirmHint")),
        h("div", { className: "dss-dialog-hint" }, t("confirmSync")),
        h(
          "label",
          { className: "dss-dialog-force" },
          h("input", {
            type: "checkbox",
            checked: force,
            disabled: !!props.busy,
            onChange: function (event) {
              setForce(event.target.checked);
            },
          }),
          " ",
          t("confirmForce"),
        ),
        h(
          "div",
          { className: "dss-dialog-actions" },
          h(
            "button",
            {
              className: "dss-btn",
              type: "button",
              disabled: !!props.busy,
              onClick: function () {
                props.onCancel();
              },
            },
            t("cancel"),
          ),
          h(
            "button",
            {
              className: "dss-btn dss-btn-danger",
              type: "button",
              disabled: !!props.busy,
              onClick: function () {
                props.onConfirm(force);
              },
            },
            props.busy ? t("working") : t("confirmOk"),
          ),
        ),
      ),
    );
  }

  function Panel(props) {
    var ctx = props.ctx;
    var t = props.t;
    var shelf = useShelf();
    var toasts = useToasts();

    var tabPair = useState("archived");
    var tab = tabPair[0];
    var setTab = tabPair[1];
    var queryPair = useState("");
    var query = queryPair[0];
    var setQuery = queryPair[1];
    var sortPair = useState("recent");
    var sort = sortPair[0];
    var setSort = sortPair[1];
    var groupedPair = useState(true);
    var grouped = groupedPair[0];
    var setGrouped = groupedPair[1];
    var collapsedPair = useState(function () {
      return new Set();
    });
    var collapsed = collapsedPair[0];
    var setCollapsed = collapsedPair[1];
    var selectionPair = useState(function () {
      return new Set();
    });
    var selected = selectionPair[0];
    var setSelected = selectionPair[1];
    var busyPair = useState(false);
    var busy = busyPair[0];
    var setBusy = busyPair[1];
    var confirmPair = useState(null);
    var pendingDelete = confirmPair[0];
    var setPendingDelete = confirmPair[1];

    var data = shelf.state.data;
    var layout = service(ctx, "layout");
    useEffect(function () {
      if (!data) return;
      var alive = new Set(data.sessions.map(function (item) {
        return item.id;
      }));
      setSelected(function (prev) {
        var next = new Set();
        prev.forEach(function (id) {
          if (alive.has(id)) next.add(id);
        });
        return next.size === prev.size ? prev : next;
      });
    }, [data]);

    var visible = useMemo(function () {
      var list = (data && data.sessions) || [];
      list = list.filter(function (item) {
        if (tab === "archived") return item.archived;
        if (tab === "pinned") return item.pinned;
        return true;
      });
      var needle = query.trim().toLowerCase();
      if (needle) {
        list = list.filter(function (item) {
          var haystack = [item.title || "", item.cwd || "", item.workspaceTitle || "", item.id].join(" ").toLowerCase();
          return haystack.indexOf(needle) >= 0;
        });
      }
      var sorted = list.slice();
      sorted.sort(function (a, b) {
        if (sort === "title") return String(a.title || a.id).localeCompare(String(b.title || b.id));
        var left = sort === "oldest" ? a.updatedAt || 0 : b.updatedAt || 0;
        var right = sort === "oldest" ? b.updatedAt || 0 : a.updatedAt || 0;
        return left - right;
      });
      return sorted;
    }, [data, tab, query, sort]);

    var groups = useMemo(function () {
      if (!grouped) return [{ key: "all", title: null, items: visible }];
      var map = new Map();
      visible.forEach(function (item) {
        var key = item.workspaceId || "__none__";
        if (!map.has(key)) {
          map.set(key, { key: key, title: item.workspaceTitle || null, path: item.workspacePath || null, items: [] });
        }
        map.get(key).items.push(item);
      });
      return Array.from(map.values());
    }, [visible, grouped]);

    var shown = useMemo(function () {
      var list = [];
      groups.forEach(function (group) {
        if (collapsed.has(group.key)) return;
        list.push.apply(list, group.items);
      });
      return list;
    }, [groups, collapsed]);

    var toggleGroup = function (key) {
      setCollapsed(function (prev) {
        var next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    };

    var counts = (data && data.counts) || { archived: 0, pinned: 0, listed: 0 };    var missingLogs = (data && data.sessions ? data.sessions.filter(function (item) {
      return item.issues.indexOf("no-log") >= 0;
    }).length : 0) || 0;

    var refreshAll = function () {
      return shelf.reload({ fresh: true });
    };

    var toggleSelect = function (id) {
      setSelected(function (prev) {
        var next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    };

    var selectAllVisible = function () {
      setSelected(function (prev) {
        var all = shown.every(function (item) {
          return prev.has(item.id);
        });
        if (all) return new Set();
        var next = new Set(prev);
        shown.forEach(function (item) {
          next.add(item.id);
        });
        return next;
      });
    };

    var restoreSessions = function (sessions) {
      var targets = sessions.filter(function (item) {
        return item.archived;
      });
      if (targets.length === 0) return Promise.resolve(0);
      var done = 0;
      var failures = [];
      return targets
        .reduce(function (chain, item) {
          return chain.then(function () {
            return callService(ctx, "uiWorkspace", "unarchiveSession", [item.id])
              .then(function () {
                done += 1;
              })
              .catch(function (error) {
                failures.push({ id: item.id, message: describeError(error, t) });
              });
          });
        }, Promise.resolve())
        .then(function () {
          if (done > 0) toasts.push("ok", done === 1 ? t("restoreDone") : t("restoreDoneMany", { n: done }));
          if (failures.length > 0) {
            toasts.push("err", t("restoreFailed", { msg: failures[0].message }));
            report("restore-failed", failures[0].message, failures);
          }
          setSelected(new Set());
          return shelf.reload({ silent: true, fresh: true });
        });
    };

    var archiveOne = function (session) {
      return callService(ctx, "uiWorkspace", "archiveSession", [session.id])
        .then(function () {
          toasts.push("ok", t("archiveDone"));
          return shelf.reload({ silent: true, fresh: true });
        })
        .catch(function (error) {
          toasts.push("err", t("archiveFailed", { msg: describeError(error, t) }));
        });
    };

    var togglePin = function (session) {
      var method = session.pinned ? "unpinSession" : "pinSession";
      return callService(ctx, "uiWorkspace", method, [session.id])
        .then(function () {
          toasts.push("ok", session.pinned ? t("unpinDone") : t("pinDone"));
          return shelf.reload({ silent: true, fresh: true });
        })
        .catch(function (error) {
          toasts.push("err", describeError(error, t));
        });
    };

    var repairOne = function (session) {
      fetch(API + "/repair-projection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [session.id] }),
      })
        .then(function (response) {
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.json();
        })
        .then(function () {
          toasts.push("ok", t("repairDone"));
          return shelf.reload({ silent: true, fresh: true });
        })
        .catch(function (error) {
          toasts.push("err", t("repairFailed", { msg: (error && error.message) || String(error) }));
        });
    };

    var requestDelete = function (sessions) {
      var ids = sessions.map(function (item) {
        return item.id;
      });
      if (ids.length === 0) return;
      setPendingDelete({ ids: ids });
    };

    var runDelete = function (force) {
      if (!pendingDelete) return;
      var ids = pendingDelete.ids.slice();
      setBusy(true);
      /* The harness exposes no session-delete API and its sidebar renders from
       * an in-memory snapshot, so purging files alone leaves the row visible.
       * Archiving first pushes the official archive set through the harness'
       * own channel (the row hides immediately), then the purge removes the
       * bytes. Failures are ignored: the archive guard and the purge guard use
       * the same activity rule, so a rejected archive means a skipped purge. */
      ids
        .reduce(function (chain, id) {
          return chain.then(function () {
            return callService(ctx, "uiWorkspace", "archiveSession", [id]).catch(function () {
              /* already archived or refused as active */
            });
          });
        }, Promise.resolve())
        .then(function () {
          return fetch(API + "/purge", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ids: ids, force: !!force }),
          });
        })
        .then(function (response) {
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.json();
        })
        .then(function (result) {
          var removed = (result.removed || []).length;
          var skipped = result.skipped || [];
          if (removed > 0) toasts.push("ok", t("deleteDone", { n: removed }));
          if (skipped.length > 0) toasts.push("err", t("deleteSkipped", { n: skipped.length }));
          setSelected(new Set());
          setPendingDelete(null);
          return shelf.reload({ silent: true, fresh: true });
        })
        .catch(function (error) {
          toasts.push("err", t("deleteFailed", { msg: (error && error.message) || String(error) }));
          report("purge-failed", (error && error.message) || String(error));
        })
        .then(function () {
          setBusy(false);
        });
    };

    var syncGhosts = function () {
      setBusy(true);
      fetch(API + "/detach-ghosts", { method: "POST" })
        .then(function (response) {
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.json();
        })
        .then(function (result) {
          var n = (result.detached || []).length;
          toasts.push(n > 0 ? "ok" : "muted", n > 0 ? t("ghostDone", { n: n }) : t("ghostNone"));
          return shelf.reload({ silent: true, fresh: true });
        })
        .catch(function (error) {
          toasts.push("err", t("ghostFailed", { msg: (error && error.message) || String(error) }));
        })
        .then(function () {
          setBusy(false);
        });
    };

    var pruneStale = function () {
      setBusy(true);
      fetch(API + "/prune-orphans", { method: "POST" })
        .then(function (response) {
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.json();
        })
        .then(function (result) {
          var removed = (result.removed || []).length;
          toasts.push(removed > 0 ? "ok" : "muted", removed > 0 ? t("pruneDone", { n: removed }) : t("pruneNone"));
          return shelf.reload({ silent: true, fresh: true });
        })
        .catch(function (error) {
          toasts.push("err", t("deleteFailed", { msg: (error && error.message) || String(error) }));
        })
        .then(function () {
          setBusy(false);
        });
    };

    var copyId = function (session) {
      var write = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(session.id) : Promise.reject(new Error("no clipboard"));
      write
        .then(function () {
          toasts.push("ok", t("copyDone"));
        })
        .catch(function () {
          toasts.push("err", t("copyFailed"));
        });
    };

    var closePanel = function () {
      try {
        if (layout && typeof layout.selectPanel === "function") layout.selectPanel(null);
      } catch (error) {
        /* panel already gone */
      }
    };

    var selectedSessions = visible.filter(function (item) {
      return selected.has(item.id);
    });
    var staleCount = 0;
    if (data) {
      var known = new Set(data.sessions.map(function (item) {
        return item.id;
      }));
      var stale = data.archivedSessionIds.concat(data.pinnedSessionIds).filter(function (id) {
        return !known.has(id);
      });
      staleCount = new Set(stale).size;
    }

    var tabs = [
      { key: "archived", label: t("tabArchived"), count: counts.archived },
      { key: "pinned", label: t("tabPinned"), count: counts.pinned },
      { key: "all", label: t("tabAll"), count: counts.listed },
    ];

    var emptyText = query.trim()
      ? t("emptySearch")
      : tab === "archived"
        ? t("emptyArchived")
        : tab === "pinned"
          ? t("emptyPinned")
          : t("emptyAll");

    var header = h(
      "div",
      { className: "dss-header" },
      h(
        "div",
        { className: "dss-heading" },
        h("span", { className: "dss-heading-icon" }, h(ShelfIcon, { size: 18 })),
        h("span", { className: "dss-heading-text" }, t("title")),
        h("span", { className: "dss-heading-count", title: t("tabAll") }, String(counts.listed)),
      ),
      h(
        "div",
        { className: "dss-header-tools" },
        h(
          "label",
          { className: "dss-search" },
          h("span", { className: "dss-search-icon" }, h(SearchIcon, { size: 14 })),
          h("input", {
            className: "dss-search-input",
            type: "text",
            value: query,
            placeholder: t("search"),
            onChange: function (event) {
              setQuery(event.target.value);
            },
          }),
          query
            ? h(
                "button",
                {
                  className: "dss-search-clear",
                  type: "button",
                  title: t("searchClear"),
                  onClick: function () {
                    setQuery("");
                  },
                },
                "✕",
              )
            : null,
        ),
        h(Dropdown, {
          value: sort,
          title: t("sort"),
          options: [
            { value: "recent", label: t("sortRecent") },
            { value: "oldest", label: t("sortOldest") },
            { value: "title", label: t("sortTitle") },
          ],
          onChange: function (value) {
            setSort(value);
          },
        }),
        h(
          "button",
          {
            className: cls("dss-btn", "dss-btn-ghost", grouped && "is-on"),
            type: "button",
            title: t("groupHint"),
            onClick: function () {
              setGrouped(!grouped);
            },
          },
          t("group"),
        ),
        h(
          "button",
          {
            className: "dss-btn dss-btn-ghost dss-iconbtn",
            type: "button",
            title: t("refresh"),
            onClick: function () {
              refreshAll();
            },
          },
          "⟳",
        ),
        h(
          "button",
          {
            className: "dss-btn dss-btn-ghost dss-iconbtn",
            type: "button",
            title: t("close"),
            onClick: closePanel,
          },
          "✕",
        ),
      ),
    );

    var tabBar = h(
      "div",
      { className: "dss-tabs" },
      tabs.map(function (item) {
        return h(
          "button",
          {
            key: item.key,
            type: "button",
            className: cls("dss-tab", tab === item.key && "is-active"),
            onClick: function () {
              setTab(item.key);
            },
          },
          item.label,
          h("span", { className: "dss-tab-count" }, String(item.count)),
        );
      }),
    );

    var selectionBar =
      selectedSessions.length > 0
        ? h(
            "div",
            { className: "dss-selectionbar" },
            h("span", { className: "dss-selection-label" }, t("selected", { n: selectedSessions.length })),
            h(
              "button",
              {
                className: "dss-btn",
                type: "button",
                onClick: function () {
                  restoreSessions(selectedSessions);
                },
              },
              t("batchRestore"),
            ),
            h(
              "button",
              {
                className: "dss-btn dss-btn-danger",
                type: "button",
                onClick: function () {
                  requestDelete(selectedSessions);
                },
              },
              t("batchDelete"),
            ),
            h(
              "button",
              {
                className: "dss-btn dss-btn-ghost",
                type: "button",
                onClick: function () {
                  setSelected(new Set());
                },
              },
              t("clear"),
            ),
          )
        : null;

    var banners = [];
    if (staleCount > 0) {
      banners.push(
        h(
          "div",
          { className: "dss-banner", key: "stale" },
          h("span", null, t("pruneBanner", { n: staleCount })),
          h(
            "button",
            {
              className: "dss-btn dss-btn-ghost",
              type: "button",
              disabled: busy,
              onClick: pruneStale,
            },
            t("pruneAction"),
          ),
        ),
      );
    }
    if (data && data.ghosts && data.ghosts.length > 0) {
      banners.push(
        h(
          "div",
          { className: "dss-banner", key: "ghosts" },
          h("span", null, t("ghostBanner", { n: data.ghosts.length })),
          h(
            "button",
            {
              className: "dss-btn dss-btn-ghost",
              type: "button",
              disabled: busy,
              onClick: syncGhosts,
            },
            t("ghostAction"),
          ),
        ),
      );
    }
    if (data && data.registryIssue) {
      banners.push(
        h("div", { className: "dss-banner", key: "registry" }, h("span", null, t("registryIssue", { reason: data.registryIssue }))),
      );
    }
    if (shelf.state.error) {
      banners.push(
        h(
          "div",
          { className: "dss-banner", key: "load" },
          h("span", null, t("loadError", { msg: shelf.state.error })),
          h(
            "button",
            {
              className: "dss-btn dss-btn-ghost",
              type: "button",
              onClick: function () {
                refreshAll();
              },
            },
            t("retry"),
          ),
        ),
      );
    }

    var allSelected = shown.length > 0 && shown.every(function (item) {
      return selected.has(item.id);
    });

    var body;
    if (!data && shelf.state.status === "loading") {
      body = h("div", { className: "dss-empty" }, t("loading"));
    } else if (visible.length === 0) {
      body = h(EmptyState, { text: emptyText });
    } else {
      body = h(
        "div",
        { className: "dss-list" },
        h(
          "label",
          { className: "dss-selectall" },
          h("input", { type: "checkbox", checked: allSelected, onChange: selectAllVisible }),
          " ",
          t("selectAll"),
        ),
        groups.map(function (group) {
          var isCollapsed = collapsed.has(group.key);
          return h(
            "section",
            { className: cls("dss-group", isCollapsed && "is-collapsed"), key: group.key },
            group.title
              ? h(
                  "header",
                  {
                    className: "dss-group-head",
                    role: "button",
                    tabIndex: 0,
                    title: isCollapsed ? t("expandGroup") : t("collapseGroup"),
                    onClick: function () {
                      toggleGroup(group.key);
                    },
                    onKeyDown: function (event) {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleGroup(group.key);
                      }
                    },
                  },
                  h("span", { className: "dss-group-caret" }, "▾"),
                  h("span", { className: "dss-group-title" }, group.title),
                  group.path ? h("span", { className: "dss-group-path" }, shortPath(group.path)) : null,
                  h("span", { className: "dss-group-count" }, String(group.items.length)),
                )
              : null,
            isCollapsed
              ? null
              : group.items.map(function (item) {
                  return h(SessionRow, {
                    key: item.id,
                    session: item,
                    t: t,
                    selected: selected.has(item.id),
                    active: false,
                    showArchive: tab === "all",
                    onToggle: toggleSelect,
                    onArchive: archiveOne,
                    onRestore: function (session) {
                      restoreSessions([session]);
                    },
                    onRepair: repairOne,
                    onPin: togglePin,
                    onDelete: function (session) {
                      requestDelete([session]);
                    },
                    onCopy: copyId,
                  });
                }),
          );
        }),
      );
    }

    var footer = h(
      "div",
      { className: "dss-footer" },
      data ? h("span", null, t("footerUpdated", { time: fmtClock(data.generatedAt) })) : null,
      h("span", { className: "dss-footer-sep" }, "·"),
      h("span", null, t("footerAuto")),
      missingLogs > 0 ? h("span", { className: "dss-footer-sep" }, "·") : null,
      missingLogs > 0 ? h("span", { className: "dss-footer-warn" }, t("footerNoLog", { n: missingLogs })) : null,
    );

    return h(
      "div",
      { className: "dss-root" },
      header,
      tabBar,
      selectionBar,
      banners.length > 0 ? h("div", { className: "dss-banners" }, banners) : null,
      h("div", { className: "dss-body" }, body),
      footer,
      h(
        "div",
        { className: "dss-toasts" },
        toasts.items.map(function (item) {
          return h("div", { key: item.id, className: cls("dss-toast", "dss-toast-" + item.tone) }, item.text);
        }),
      ),
      pendingDelete ? h(ConfirmDialog, { t: t, count: pendingDelete.ids.length, busy: busy, onCancel: function () {
        if (!busy) setPendingDelete(null);
      }, onConfirm: runDelete }) : null,
    );
  }

  /* --------------------------------------------------------------- styling */

  var CSS = [
    ":root{--dss-accent:#e0a030;--dss-danger:#e05260;--dss-ok:#3f9d63}",
    ".dss-root{display:flex;flex-direction:column;height:100%;min-height:60vh;color:inherit;font-size:13px;line-height:1.45;--dss-line:color-mix(in srgb,currentColor 12%,transparent)}",
    ".dss-root *{box-sizing:border-box}",
    ".dss-header{display:flex;align-items:center;gap:12px;padding:12px 16px;flex-wrap:wrap;border-bottom:1px solid var(--dss-line);background:color-mix(in srgb,Canvas 40%,transparent)}",
    ".dss-heading{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;white-space:nowrap}",
    ".dss-heading-icon{display:inline-flex;opacity:.85}",
    ".dss-heading-count{font-size:11px;font-weight:500;opacity:.6;padding:1px 7px;border-radius:999px;background:color-mix(in srgb,currentColor 9%,transparent)}",
    ".dss-header-tools{display:flex;align-items:center;gap:8px;flex:1;min-width:260px;flex-wrap:wrap;justify-content:flex-end}",
    ".dss-search{display:flex;align-items:center;gap:6px;flex:1;min-width:200px;max-width:420px;padding:0 8px;height:30px;border-radius:9px;border:1px solid color-mix(in srgb,currentColor 16%,transparent);background:color-mix(in srgb,currentColor 4%,transparent);transition:border-color .12s ease,background .12s ease}",
    ".dss-search:focus-within{border-color:color-mix(in srgb,currentColor 36%,transparent);background:color-mix(in srgb,currentColor 6%,transparent)}",
    ".dss-search-icon{display:inline-flex;opacity:.5}",
    ".dss-search-input{flex:1;min-width:0;height:100%;border:none;background:transparent;color:inherit;font:inherit;outline:none}",
    ".dss-search-input::placeholder{color:inherit;opacity:.45}",
    ".dss-search-clear{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:none;border-radius:50%;background:color-mix(in srgb,currentColor 12%,transparent);color:inherit;font-size:10px;line-height:1;cursor:pointer;opacity:.7}",
    ".dss-search-clear:hover{opacity:1}",
    ".dss-dd{position:relative;display:inline-flex}",
    ".dss-dd-btn{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 10px;border-radius:9px;border:1px solid color-mix(in srgb,currentColor 16%,transparent);background:color-mix(in srgb,currentColor 4%,transparent);color:inherit;font:inherit;cursor:pointer;white-space:nowrap}",
    ".dss-dd-btn:hover{background:color-mix(in srgb,currentColor 8%,transparent)}",
    ".dss-dd-btn.is-open{border-color:color-mix(in srgb,currentColor 34%,transparent);background:color-mix(in srgb,currentColor 8%,transparent)}",
    ".dss-dd-text{opacity:.9}",
    ".dss-chevron{opacity:.6;transition:transform .14s ease}",
    ".dss-chevron.is-open{transform:rotate(180deg);opacity:.9}",
    ".dss-dd-menu{position:fixed;z-index:90;display:flex;flex-direction:column;gap:2px;padding:5px;border-radius:11px;background:Canvas;color:CanvasText;border:1px solid color-mix(in srgb,CanvasText 16%,transparent);box-shadow:0 14px 36px rgba(0,0,0,.28)}",
    ".dss-dd-item{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:6px 10px;border:none;border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:13px;text-align:left;cursor:pointer;white-space:nowrap}",
    ".dss-dd-item:hover{background:color-mix(in srgb,CanvasText 8%,transparent)}",
    ".dss-dd-item.is-active{background:color-mix(in srgb,CanvasText 12%,transparent);font-weight:600}",
    ".dss-dd-tick{opacity:.65;font-size:11px}",
    ".dss-btn{display:inline-flex;align-items:center;gap:4px;height:30px;padding:0 11px;border-radius:9px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);background:transparent;color:inherit;font:inherit;cursor:pointer;white-space:nowrap;transition:background .12s ease,opacity .12s ease}",
    ".dss-btn:hover:not(:disabled){background:color-mix(in srgb,currentColor 7%,transparent)}",
    ".dss-btn:disabled{opacity:.5;cursor:default}",
    ".dss-btn-ghost{border-color:transparent;opacity:.78}",
    ".dss-btn-ghost:hover:not(:disabled){opacity:1;background:color-mix(in srgb,currentColor 7%,transparent)}",
    ".dss-btn-ghost.is-on{opacity:1;border-color:color-mix(in srgb,currentColor 24%,transparent);background:color-mix(in srgb,currentColor 8%,transparent)}",
    ".dss-btn-danger{color:var(--dss-danger);border-color:color-mix(in srgb,var(--dss-danger) 40%,transparent)}",
    ".dss-btn-danger:hover:not(:disabled){background:color-mix(in srgb,var(--dss-danger) 12%,transparent)}",
    ".dss-iconbtn{padding:0;width:30px;justify-content:center;font-size:13px}",
    ".dss-btn:focus-visible,.dss-tab:focus-visible,.dss-dd-btn:focus-visible,.dss-row:focus-visible,.dss-star:focus-visible{outline:2px solid color-mix(in srgb,currentColor 45%,transparent);outline-offset:1px}",
    ".dss-tabs{display:flex;gap:6px;padding:10px 16px 0;border-bottom:1px solid var(--dss-line)}",
    ".dss-tab{display:inline-flex;align-items:center;gap:7px;padding:6px 11px 7px;border:none;border-bottom:2px solid transparent;background:transparent;color:inherit;opacity:.62;font:inherit;cursor:pointer;transition:opacity .12s ease}",
    ".dss-tab:hover{opacity:.9}",
    ".dss-tab.is-active{opacity:1;border-bottom-color:color-mix(in srgb,currentColor 62%,transparent);font-weight:600}",
    ".dss-tab-count{font-size:11px;font-weight:500;opacity:.72;padding:0 6px;border-radius:999px;background:color-mix(in srgb,currentColor 9%,transparent)}",
    ".dss-selectionbar{display:flex;align-items:center;gap:8px;padding:8px 16px;background:color-mix(in srgb,currentColor 6%,transparent);border-bottom:1px solid var(--dss-line);flex-wrap:wrap}",
    ".dss-selection-label{font-weight:600;margin-right:4px}",
    ".dss-banners{display:flex;flex-direction:column;gap:6px;padding:10px 16px 0}",
    ".dss-banner{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 10px;border-radius:9px;border-left:3px solid color-mix(in srgb,var(--dss-accent) 70%,transparent);background:color-mix(in srgb,var(--dss-accent) 11%,transparent);font-size:12px}",
    ".dss-body{flex:1;min-height:0;overflow:auto;padding:6px 0 14px}",
    ".dss-list{display:flex;flex-direction:column}",
    ".dss-selectall{display:flex;align-items:center;gap:6px;padding:6px 18px;font-size:12px;opacity:.7;cursor:pointer}",
    ".dss-selectall input{accent-color:currentColor}",
    ".dss-group{display:flex;flex-direction:column;margin-top:4px}",
    ".dss-group-head{display:flex;align-items:baseline;gap:8px;padding:8px 18px 5px;font-size:12px;position:sticky;top:0;z-index:1;backdrop-filter:blur(8px);background:color-mix(in srgb,Canvas 86%,transparent);cursor:pointer;user-select:none}",
    ".dss-group-head:hover{background:color-mix(in srgb,Canvas 74%,currentColor 6%)}",
    ".dss-group-head:focus-visible{outline:2px solid color-mix(in srgb,currentColor 45%,transparent);outline-offset:-2px}",
    ".dss-group-caret{display:inline-flex;width:10px;opacity:.5;transition:transform .12s ease}",
    ".dss-group.is-collapsed .dss-group-caret{transform:rotate(-90deg)}",
    ".dss-group-title{font-weight:600;letter-spacing:.01em}",
    ".dss-group-path{opacity:.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:48%}",
    ".dss-group-count{margin-left:auto;opacity:.45;font-variant-numeric:tabular-nums}",
    ".dss-row{display:flex;align-items:center;gap:10px;min-height:46px;padding:6px 18px;border-left:2px solid transparent;transition:background .1s ease}",
    ".dss-row+.dss-row{box-shadow:inset 0 1px 0 color-mix(in srgb,currentColor 6%,transparent)}",
    ".dss-row:hover{background:color-mix(in srgb,currentColor 6%,transparent)}",
    ".dss-row.is-selected{background:color-mix(in srgb,currentColor 11%,transparent);border-left-color:color-mix(in srgb,currentColor 55%,transparent)}",
    ".dss-row.is-active{background:color-mix(in srgb,currentColor 12%,transparent)}",
    ".dss-check{accent-color:currentColor;cursor:pointer;margin:0}",
    ".dss-star{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:none;border-radius:6px;background:transparent;color:inherit;font-size:14px;line-height:1;cursor:pointer;opacity:.4}",
    ".dss-star:hover{opacity:.9;background:color-mix(in srgb,currentColor 8%,transparent)}",
    ".dss-star.is-on{opacity:1;color:var(--dss-accent)}",
    ".dss-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}",
    ".dss-titleline{display:flex;align-items:center;gap:6px;min-width:0}",
    ".dss-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}",
    ".dss-meta{font-size:11.5px;opacity:.52;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}",
    ".dss-badge{font-size:10.5px;padding:0 6px;border-radius:6px;border:1px solid color-mix(in srgb,currentColor 22%,transparent);opacity:.85;white-space:nowrap;line-height:1.5}",
    ".dss-badge-muted{opacity:.6}",
    ".dss-badge-warn{border-color:color-mix(in srgb,var(--dss-accent) 55%,transparent);color:#c98a1c;opacity:.95}",
    ".dss-actions{display:flex;align-items:center;gap:6px;opacity:0;transition:opacity .12s ease}",
    ".dss-row:hover .dss-actions,.dss-row.is-selected .dss-actions,.dss-row:focus-within .dss-actions{opacity:1}",
    ".dss-actions .dss-btn{height:24px;padding:0 9px;font-size:12px;border-radius:7px}",
    ".dss-actions .dss-btn-danger{opacity:.85}",
    ".dss-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:72px 24px;text-align:center;opacity:.6}",
    ".dss-empty-icon{opacity:.75}",
    ".dss-footer{display:flex;align-items:center;gap:6px;padding:7px 16px;font-size:11.5px;opacity:.52;border-top:1px solid var(--dss-line);flex-wrap:wrap}",
    ".dss-footer-warn{color:#c98a1c;opacity:.95}",
    ".dss-toasts{position:fixed;right:20px;bottom:20px;display:flex;flex-direction:column;gap:8px;z-index:60;pointer-events:none}",
    ".dss-toast{padding:8px 12px;border-radius:10px;font-size:12.5px;background:color-mix(in srgb,Canvas 90%,#000 4%);color:CanvasText;border:1px solid color-mix(in srgb,CanvasText 16%,transparent);box-shadow:0 8px 22px rgba(0,0,0,.2);max-width:340px}",
    ".dss-toast-err{color:var(--dss-danger)}",
    ".dss-toast-ok{color:var(--dss-ok)}",
    ".dss-toast-muted{opacity:.8}",
    ".dss-overlay{position:fixed;inset:0;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;z-index:70}",
    ".dss-dialog{width:min(440px,92vw);background:Canvas;color:CanvasText;border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:10px;box-shadow:0 18px 48px rgba(0,0,0,.32)}",
    ".dss-dialog-title{font-size:15px;font-weight:600}",
    ".dss-dialog-body{font-size:13px;opacity:.85}",
    ".dss-dialog-hint{font-size:12px;opacity:.6}",
    ".dss-dialog-force{font-size:12px;display:flex;align-items:center;gap:6px;opacity:.78;cursor:pointer}",
    ".dss-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}",
  ].join("\n");

  function ensureStyles() {
    if (typeof document === "undefined") return function () {};
    if (document.getElementById(STYLE_ID)) return function () {};
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
    return function () {
      if (style.parentNode) style.parentNode.removeChild(style);
    };
  }

  /* --------------------------------------------------------------- mounting */

  function mount(ctx, t) {
    var disposers = [];
    var keep = function (maybe) {
      if (typeof maybe === "function") disposers.push(maybe);
    };

    keep(ensureStyles());

    keep(
      ctx.slots.inject("main", function () {
        report("seat-main");
        return ctx.slots.register(
          { name: "main", key: PANEL_KEY, label: function () { return t("nav"); }, inject: function () { return {}; } },
          function () {
            return h(Panel, { ctx: ctx, t: t });
          },
        );
      }),
    );

    keep(
      ctx.slots.inject("sidebar.panellist", function () {
        report("seat-panellist");
        return ctx.slots.register(
          { name: "sidebar.panellist", id: PANEL_KEY, order: 60, label: function () { return t("nav"); } },
          function (owner) {
            var size = owner && owner.size ? owner.size : 16;
            return h(ShelfIcon, { size: size });
          },
        );
      }),
    );

    return function () {
      for (var i = disposers.length - 1; i >= 0; i -= 1) {
        try {
          disposers[i]();
        } catch (error) {
          /* disposal is best effort during hot reload */
        }
      }
      disposers.length = 0;
    };
  }

  function apply(ctx) {
    var t = makeT(detectLang());
    report("apply", null, { lang: detectLang() });

    /* Ask the harness to hand us the client services we need. Optional on
     * purpose: an older host may lack one of them and the panel must still
     * open. */
    var adopt = function (scoped) {
      try {
        if (scoped && scoped.uiWorkspace) RUNTIME.uiWorkspace = scoped.uiWorkspace;
        if (scoped && scoped.layout) RUNTIME.layout = scoped.layout;
      } catch (error) {
        /* ignore */
      }
    };
    adopt(ctx);
    try {
      if (typeof ctx.inject === "function") ctx.inject(["uiWorkspace", "layout"], adopt);
    } catch (error) {
      report("inject-failed", String((error && error.message) || error));
    }

    try {
      if (typeof ctx.effect === "function") {
        ctx.effect(function () {
          var teardown = mount(ctx, t);
          report("mounted", null, { panel: PANEL_KEY });
          return function () {
            teardown();
          };
        }, "session-shelf: browser half");
      } else {
        mount(ctx, t);
        report("mounted", null, { panel: PANEL_KEY });
      }
    } catch (error) {
      report("error", String((error && error.stack) || error));
      if (typeof console !== "undefined" && console.error) console.error("[session-shelf] mount failed", error);
    }
  }

  exports.name = "session-shelf";
  exports.inject = ["slots"];
  exports.apply = apply;
  return module.exports;
}});
