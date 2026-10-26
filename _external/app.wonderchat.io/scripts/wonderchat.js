(function () {
  // Prevent duplicate script execution
  if (window.__wonderchatLoaded) return;
  window.__wonderchatLoaded = true;

  console.log("loaded wonderchat.js");

  const removeHttp = (url) => {
    if (url === undefined) {
      return "";
    }

    return url.replace(/^https?:\/\//, "");
  };

  // Page-Aware Answers: the loader (not the iframed widget) is what sits on the
  // host page, so it scrapes the page title + visible text and forwards them in
  // the URL_CHANGE message. The iframed widget decides whether to send them on
  // to the API based on the bot's config. Kept in sync with the search bar's
  // extractPageContext() in src/embeddable/page-context.ts. Caps mirror
  // src/utils/page-context-limits.ts (can't import into this standalone bundle).
  const WC_PAGE_CONTENT_MAX_CHARS = 4000;
  const WC_PAGE_TITLE_MAX_CHARS = 300;
  function getWonderchatPageContext() {
    let title = "";
    let content = "";
    try {
      title = (document.title || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, WC_PAGE_TITLE_MAX_CHARS);
      const root =
        document.querySelector("main") ||
        document.querySelector("article") ||
        document.body;
      if (root) {
        const clone = root.cloneNode(true);
        clone
          .querySelectorAll("script, style, noscript, template, svg")
          .forEach((el) => el.remove());
        ["wonderchat", "wonderchat-searchbar", "wonderchatWrapper"].forEach(
          (id) => {
            clone.querySelectorAll("#" + id).forEach((el) => el.remove());
          },
        );
        content = (clone.innerText || clone.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, WC_PAGE_CONTENT_MAX_CHARS);
      }
    } catch (e) {
      // Best-effort — send whatever was captured.
    }
    return { title, content };
  }

  // Make path matching tolerant of trivial canonical-URL differences so a
  // configured "https://www.site.com/x" still matches a visitor on
  // "https://site.com/x" (and vice-versa). Strips a leading "www." (with or
  // without protocol) and surrounding whitespace. Trailing-slash handling
  // stays at the call sites.
  function normalizeForMatch(value) {
    return value.trim().replace(/^(https?:\/\/)?www\./i, "$1");
  }

  function isCrossOriginFrame(iframe = undefined) {
    try {
      if (iframe !== undefined) {
        return !iframe?.window?.top?.location.hostname;
      }

      return !window?.top?.location.hostname;
    } catch (e) {
      return true;
    }
  }

  /* UTM params */
  function getUTMParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    return {
      wc_utm_source: urlParams.get("utm_source"),
      wc_utm_medium: urlParams.get("utm_medium"),
      wc_utm_campaign: urlParams.get("utm_campaign"),
      wc_utm_term: urlParams.get("utm_term"),
      wc_utm_content: urlParams.get("utm_content"),
    };
  }

  try {
    const utmParams = getUTMParameters();

    Object.keys(utmParams).forEach((key) => {
      if (utmParams[key]) {
        sessionStorage.setItem(key, utmParams[key]);
      }
    });
  } catch (err) {
    console.log("Error occurred when getting utm params");
  }

  const oldOverflow = document?.body?.style?.overflow ?? "";

  // Helper function to get static greeting message
  function getStaticGreeting() {
    return dataGreeting || greeting || null;
  }

  // Proactive greeting timing. Kept in sync with wonderchat-seo.js (standalone
  // bundles can't share code). SMART fires on whichever comes first: a reading
  // dwell (10s desktop / 15s mobile, 3s from the second page of a visit), a
  // half-page scroll, or desktop exit intent.
  // Returns the dwell timer id; callers store it in window.greetingTimeout and
  // every cancel site clears that, so the scroll/exit paths check it too.
  if (!window.__wcPageViewCounted) {
    window.__wcPageViewCounted = true;
    try {
      sessionStorage.setItem(
        "wc_page_views",
        String(Number(sessionStorage.getItem("wc_page_views") || 0) + 1),
      );
    } catch (e) {}
  }

  function scheduleProactiveGreeting(trigger, show) {
    if (trigger === "IMMEDIATE") {
      return setTimeout(show, 1000);
    }

    var isMobile = window.matchMedia("(max-width: 990px)").matches;
    var pageViews = 1;
    try {
      pageViews = Number(sessionStorage.getItem("wc_page_views") || 1);
    } catch (e) {}
    var dwellMs = pageViews >= 2 ? 3000 : isMobile ? 15000 : 10000;
    // Scroll/exit only count once the visitor has been here a moment, so a
    // fast scroll on arrival doesn't pop the greeting instantly.
    var armedAt = Date.now() + 3000;
    var timer;
    var fired = false;

    function cleanup() {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("mouseout", onMouseOut);
    }
    function fire() {
      cleanup();
      if (fired || window.greetingTimeout !== timer) return;
      fired = true;
      clearTimeout(timer);
      whenTabVisible(show);
    }
    function onScroll() {
      if (Date.now() < armedAt) return;
      var doc = document.documentElement;
      var scrollable = doc.scrollHeight - window.innerHeight;
      if (scrollable > window.innerHeight * 0.5 && window.scrollY >= scrollable * 0.5) {
        fire();
      }
    }
    function onMouseOut(e) {
      if (Date.now() < armedAt) return;
      if (!e.relatedTarget && e.clientY <= 0) fire();
    }

    timer = setTimeout(fire, dwellMs);
    window.addEventListener("scroll", onScroll, { passive: true });
    // A visitor who scrolled past halfway before arming and then stopped
    // produces no further scroll events, so check once when armed.
    setTimeout(onScroll, 3050);
    if (!isMobile) document.addEventListener("mouseout", onMouseOut);
    return timer;
  }

  // A greeting that fires while the tab is in the background waits for the
  // visitor to come back; meanwhile the tab title shows "(1)" like a message.
  function whenTabVisible(show) {
    if (!document.hidden) {
      show();
      return;
    }
    var originalTitle = document.title;
    document.title = "(1) " + originalTitle;
    function onVisible() {
      if (document.hidden) return;
      document.removeEventListener("visibilitychange", onVisible);
      if (document.title === "(1) " + originalTitle) {
        document.title = originalTitle;
      }
      show();
    }
    document.addEventListener("visibilitychange", onVisible);
  }

  const wonderchatScript = document.currentScript;

  // Read config from multiple sources to survive tag managers that strip data-* attributes.
  // Priority: data-attribute (back-compat) > URL query string on src > window.wonderchatSettings
  function readConfig(name) {
    if (wonderchatScript) {
      const dataValue = wonderchatScript.getAttribute("data-" + name);
      if (dataValue !== null) return dataValue;
      try {
        if (wonderchatScript.src) {
          const queryValue = new URL(wonderchatScript.src).searchParams.get(
            name,
          );
          if (queryValue !== null) return queryValue;
        }
      } catch (e) {
        // ignore parse errors
      }
    }
    const settings = window.wonderchatSettings;
    if (settings && typeof settings === "object") {
      const camelName = name.replace(/-([a-z])/g, function (_, c) {
        return c.toUpperCase();
      });
      if (settings[camelName] !== undefined && settings[camelName] !== null) {
        return String(settings[camelName]);
      }
      if (settings[name] !== undefined && settings[name] !== null) {
        return String(settings[name]);
      }
    }
    return null;
  }

  const offsetBottom = readConfig("widget-offset-bottom");
  const offsetRight = readConfig("widget-offset-right");
  const offsetLeft = readConfig("widget-offset-left");
  const offsetBottomMobile = readConfig("widget-offset-bottom-mobile");
  const offsetRightMobile = readConfig("widget-offset-right-mobile");
  const offsetLeftMobile = readConfig("widget-offset-left-mobile");
  const dataPreviewLiveChat = readConfig("preview-live-chat");
  const placement = readConfig("placement") || "right";
  const isSeoWidget = readConfig("seo-widget");
  let wonderchatId = readConfig("id");

  const wonderchatPassphrase = readConfig("passphrase");
  // Accept data-address as a bare host or a full base URL ("https://host/") —
  // downstream code (URL building, e.origin matching) expects a bare host.
  const rawWonderchatAddress = readConfig("address");
  const wonderchatAddress = rawWonderchatAddress
    ? removeHttp(rawWonderchatAddress).replace(/\/+$/, "")
    : rawWonderchatAddress;
  const greeting = wonderchatScript?.getAttribute("greeting");
  const dataGreeting = readConfig("greeting");
  const dataIgnorePaths = readConfig("ignore-paths");
  const dataShowPaths = readConfig("show-paths");
  const dataHeaderHidden = readConfig("header-hidden");
  const dataLanguage = readConfig("language");
  const dataDefaultLanguage = readConfig("default-language");
  const dataContext = readConfig("context");
  const dataUserId = readConfig("user-id");
  const dataUserEmail = readConfig("user-email");
  const dataUserName = readConfig("user-name");
  const dataIdentityToken = readConfig("identity-token");
  const dataCustomCss = readConfig("custom-css");
  const dataWidgetMovable = readConfig("movable");
  const dataIsInitiallyOpen = readConfig("initial-open") === "true";
  const dataInitialOpenUrls = readConfig("initial-open-urls");
  const dataDeviceVisibility = readConfig("device-visibility");
  const dataHidden = readConfig("hidden");
  let dataInitialHidden = readConfig("initial-hidden");
  const dataZIndex = readConfig("z-index");
  const dataDelay = parseInt(readConfig("delay") || "0", 10);

  // Opt-in host-page analytics: when enabled, the widget emits namespaced
  // lifecycle events to the site's own analytics — GTM (window.dataLayer) and/or
  // PostHog (window.posthog) — so site owners can build triggers/funnels from
  // them. Lives on the host page's top window (this script), so both globals are
  // directly reachable — the iframe itself never touches them.
  // Enabled by either the legacy embed attributes (baked into old snippets) or
  // the server-persisted chatbot settings delivered via the chatbotLoaded
  // message, so toggling in the dashboard needs no embed re-copy.
  let dataLayerEvents = readConfig("datalayer-events") === "true";
  let posthogEvents = readConfig("posthog-events") === "true";
  // Tracks whether the current conversation has already emitted a
  // "conversation started" event, so a fresh conversation only fires it once.
  let analyticsConversationStarted = false;

  function trackAnalyticsEvent(event, extra) {
    if (dataLayerEvents) {
      try {
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push(
          Object.assign(
            { event: event, chatbotId: wonderchatId, source: "widget" },
            extra || {},
          ),
        );
      } catch (e) {
        // never let analytics break the widget
      }
    }
    if (posthogEvents) {
      // Uses the host page's own posthog-js instance; its snippet queues
      // capture() calls made before the library finishes loading.
      try {
        if (window.posthog && typeof window.posthog.capture === "function") {
          window.posthog.capture(
            event,
            Object.assign(
              { chatbotId: wonderchatId, source: "widget" },
              extra || {},
            ),
          );
        }
      } catch (e) {
        // never let analytics break the widget
      }
    }
  }

  // UTM parameters passed from wonderchat-seo.js
  const dataUtmSource = readConfig("utm-source");
  const dataUtmMedium = readConfig("utm-medium");
  const dataUtmCampaign = readConfig("utm-campaign");
  const dataUtmTerm = readConfig("utm-term");
  const dataUtmContent = readConfig("utm-content");

  let widgetSize = readConfig("widget-size");
  let widgetButtonSize = readConfig("widget-button-size");

  // Z-index values - use custom value or defaults
  const zIndexVisible = dataZIndex ? parseInt(dataZIndex, 10) : 2147483646;
  const zIndexHidden = -2147483645;

  // Fire one impression per visitor per day per chatbot.
  // Skipped when loaded by the SEO facade — facade already sent the impression.
  // Called only when the widget is actually appended (after path/device checks).
  function trackWidgetImpression() {
    if (isSeoWidget) return;
    if (!wonderchatId) return;
    try {
      const visitorKey = "wc_vid_" + wonderchatId;
      const lastKey = "wc_last_impr_" + wonderchatId;
      let visitorId = localStorage.getItem(visitorKey);
      if (!visitorId) {
        visitorId =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
                /[xy]/g,
                function (c) {
                  const r = (Math.random() * 16) | 0;
                  const v = c === "x" ? r : (r & 0x3) | 0x8;
                  return v.toString(16);
                },
              );
        localStorage.setItem(visitorKey, visitorId);
      }
      const today = new Date().toISOString().slice(0, 10);
      if (localStorage.getItem(lastKey) === today) return;
      localStorage.setItem(lastKey, today);

      const address = wonderchatAddress || "app.wonderchat.io";
      const proto = address.includes("localhost") ? "http" : "https";
      const url = proto + "://" + removeHttp(address) + "/api/widget-impression";
      const body = JSON.stringify({
        c: wonderchatId,
        v: visitorId,
        u: window.location.href,
      });
      if (
        typeof navigator !== "undefined" &&
        typeof navigator.sendBeacon === "function"
      ) {
        const blob = new Blob([body], { type: "application/json" });
        navigator.sendBeacon(url, blob);
      } else {
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body,
          keepalive: true,
        }).catch(function () {});
      }
    } catch (e) {
      // localStorage disabled / private mode — silently skip
    }
  }

  const wonderchatWrapper = document.createElement("div");
  wonderchatWrapper.id = "wonderchat-wrapper";
  wonderchatWrapper.style.zIndex = zIndexHidden;
  wonderchatWrapper.style.background = "transparent";
  wonderchatWrapper.style.overflow = "hidden";
  wonderchatWrapper.style.position = "fixed";
  wonderchatWrapper.style.bottom = "0px";
  if (placement === "left") {
    wonderchatWrapper.style.left = "0px";
  } else {
    wonderchatWrapper.style.right = "0px";
  }

  if (!dataHidden && !dataInitialHidden) {
    wonderchatWrapper.style.height =
      widgetButtonSize === "extraLarge"
        ? "135px"
        : widgetButtonSize === "large"
          ? "122.5px"
          : "110px";
    wonderchatWrapper.style.width =
      widgetButtonSize === "extraLarge"
        ? "135px"
        : widgetButtonSize === "large"
          ? "122.5px"
          : "110px";
  } else {
    wonderchatWrapper.style.height = "0px";
    wonderchatWrapper.style.width = "0px";
  }

  // Desktop
  if (window.matchMedia("(min-width: 991px)").matches) {
    if (offsetBottom) {
      wonderchatWrapper.style.marginBottom = `min(${offsetBottom}, calc(100vh - 135px - 20px))`;
    }
    if (offsetRight) {
      wonderchatWrapper.style.marginRight = `min(${offsetRight}, calc(100vw - 629px - 20px))`;
    }
    if (offsetLeft) {
      wonderchatWrapper.style.marginLeft = `min(${offsetLeft}, calc(100vw - 629px - 20px))`;
    }
  } else {
    /* Mobile */
    if (offsetBottomMobile) {
      wonderchatWrapper.style.marginBottom = `min(${offsetBottomMobile}, calc(100vh - 135px - 20px))`;
    }
    if (offsetRightMobile) {
      wonderchatWrapper.style.marginRight = `min(${offsetRightMobile}, calc(100vw - 135px - 20px))`;
    }
    if (offsetLeftMobile) {
      wonderchatWrapper.style.marginLeft = `min(${offsetLeftMobile}, calc(100vw - 135px - 20px))`;
    }
  }
  let widgetOpen = false;
  // The page-aware greeting can be ready before the proactive trigger fires;
  // hold it until then so it follows the same timing and dismissal rules.
  let greetingTriggerFired = false;
  let readyDynamicGreeting = null;
  let widgetExpanded = false;

  // Free-plan widgets disappear once the owner runs out of message credits.
  // The SEO facade gates this before ever loading wonderchat.js, so we only
  // need to re-check here for standalone (non-SEO) embeds. Fail open on any
  // error so a transient fetch failure never hides a paying customer's widget.
  function initializeWidget() {
    if (isSeoWidget) {
      renderWidget();
      return;
    }

    const address = wonderchatAddress || "app.wonderchat.io";
    const proto = address.includes("localhost") ? "http" : "https";
    fetch(
      proto +
        "://" +
        removeHttp(address) +
        "/api/get-widget-info?chatbotId=" +
        encodeURIComponent(wonderchatId),
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data && data.widgetDisabled) return;
        renderWidget();
      })
      .catch(() => {
        renderWidget();
      });
  }

  // Function to initialize the widget (can be delayed)
  function renderWidget() {
    document.body.appendChild(wonderchatWrapper);

    const VALID_WIDGET_SIZES = {
      small: {
        height: "748px",
        width: "422px",
      },
      normal: {
        height: "880px",
        width: "484px",
      },
      large: {
        height: "902px",
        width: "629px",
      },
    };

    const EXPANDED_HEIGHT = 1000;
    const EXPANDED_WIDTH = 900;

    function getAvailableSpace() {
      const bottomOffset = parseInt(offsetBottom || "0");
      const rightOffset = parseInt(offsetRight || "0");
      const leftOffset = parseInt(offsetLeft || "0");
      return {
        height: Math.max(100, window.innerHeight - bottomOffset - 20),
        width: Math.max(
          200,
          window.innerWidth - Math.max(rightOffset, leftOffset) - 20,
        ),
      };
    }

    function getConstrainedSize(targetHeight, targetWidth) {
      const available = getAvailableSpace();
      return {
        height: Math.min(available.height, targetHeight),
        width: Math.min(available.width, targetWidth),
      };
    }

    if (!VALID_WIDGET_SIZES[widgetSize]) {
      widgetSize = "normal";
    }

    const baseWidgetButtonWrapperHeight =
      widgetButtonSize === "extraLarge" ? "240px" : "220px";
    let widgetButtonWrapperHeight = baseWidgetButtonWrapperHeight;

    const iframe = document.createElement("iframe");

    function changeChatbotId(newChatbotId) {
      wonderchatId = newChatbotId;
      const iframe = document.getElementById("wonderchat");
      const iframeUrl = getIframeUrl(wonderchatId);
      iframe.setAttribute("src", iframeUrl);
    }

    if (typeof window !== "undefined" && !window.changeChatbotId) {
      window.changeChatbotId = changeChatbotId;
    }

    function setChatbotLanguage(language) {
      // Let the lightweight SEO facade re-resolve its external spontaneous-
      // greeting popup for the new language. That bubble lives outside the
      // iframe, so posting to the frame alone would leave it stale. Fire before
      // the no-iframe early return so the popup updates even pre-open.
      try {
        window.dispatchEvent(
          new CustomEvent("wonderchat:languagechange", {
            detail: { language: language },
          })
        );
      } catch (e) {}
      var iframe = document.getElementById("wonderchat");
      if (!iframe) return;
      iframe.contentWindow.postMessage(
        JSON.stringify({ type: "setChatbotLanguage", payload: { language: language } }),
        "*"
      );
    }

    function toggleChat(show) {
      const iframe = document.getElementById("wonderchat");
      if (!iframe) return;

      if (show === undefined) {
        show = !widgetOpen;
      }

      // Clear any pending greeting timeouts
      if (window.greetingTimeout) {
        clearTimeout(window.greetingTimeout);
        window.greetingTimeout = null;
      }
      if (window.dynamicGreetingTimeout) {
        clearTimeout(window.dynamicGreetingTimeout);
        window.dynamicGreetingTimeout = null;
      }

      // Opening the chat dismisses the greeting popup. The facade bubble lives
      // on the host page (window.hideGreeting only exists when the SEO script
      // rendered it), so the iframe can't hide it itself.
      if (show && typeof window.hideGreeting === "function") {
        window.hideGreeting();
      }

      iframe.contentWindow.postMessage(
        JSON.stringify({
          type: "toggleChat",
          payload: { isOpen: show },
        }),
        "*",
      );
    }

    function identify(params) {
      if (!params || typeof params !== "object") {
        console.error("identify() requires an object with parameters");
        return;
      }

      const { email, name, phoneNumber, custom, token } = params;

      // Validate standard fields
      const validatedParams = {};

      if (email && typeof email === "string") {
        validatedParams.email = email.substring(0, 100);
      }
      if (name && typeof name === "string") {
        validatedParams.name = name.substring(0, 100);
      }
      if (phoneNumber && typeof phoneNumber === "string") {
        validatedParams.phoneNumber = phoneNumber.substring(0, 100);
      }
      if (token && typeof token === "string") {
        validatedParams.token = token;
      }

      // Validate custom parameters
      if (custom && typeof custom === "object") {
        const validatedCustom = {};
        for (const [key, value] of Object.entries(custom)) {
          if (typeof value === "string" && value.length <= 5000) {
            validatedCustom[key] = value;
          } else if (typeof value === "string") {
            console.warn(
              `Custom parameter "${key}" exceeds 5000 character limit, truncating`,
            );
            validatedCustom[key] = value.substring(0, 5000);
          } else {
            console.warn(
              `Custom parameter "${key}" must be a string, skipping`,
            );
          }
        }
        if (Object.keys(validatedCustom).length > 0) {
          validatedParams.custom = validatedCustom;
        }
      }

      const iframe = document.getElementById("wonderchat");
      if (!iframe) return;

      iframe.contentWindow.postMessage(
        JSON.stringify({
          type: "identify",
          payload: validatedParams,
        }),
        "*",
      );

      if (validatedParams.token) {
        const iframeEl = document.getElementById("wonderchat");
        if (iframeEl && iframeEl.src) {
          const url = new URL(iframeEl.src);
          url.searchParams.set("identityToken", validatedParams.token);
          iframeEl.src = url.toString();
        }
      }
    }

    function clearChatbotHistory() {
      const iframe = document.getElementById("wonderchat");
      if (!iframe) return;

      iframe.contentWindow.postMessage(
        JSON.stringify({
          type: "clearChatbotHistory",
        }),
        "*",
      );
    }

    function prefillChatbotQuestion(question) {
      const iframe = document.getElementById("wonderchat");
      if (!iframe) return;

      iframe.contentWindow.postMessage(
        JSON.stringify({
          type: "prefillQuestion",
          payload: { question },
        }),
        "*",
      );
    }

    function sendChatbotQuestion(question) {
      const iframe = document.getElementById("wonderchat");
      if (!iframe) return;

      iframe.contentWindow.postMessage(
        JSON.stringify({
          type: "autoSendQuestion",
          payload: { question },
        }),
        "*",
      );
    }

    function showWidget() {
      dataInitialHidden = false;
      const wrapper = document.getElementById("wonderchat-wrapper");
      if (wrapper) {
        const btnSize =
          widgetButtonSize === "extraLarge"
            ? "135px"
            : widgetButtonSize === "large"
              ? "122.5px"
              : "110px";
        wrapper.style.height = btnSize;
        wrapper.style.width = btnSize;
      }
    }

    function hideWidget() {
      dataInitialHidden = true;
      const wrapper = document.getElementById("wonderchat-wrapper");
      if (wrapper) {
        wrapper.style.height = "0px";
        wrapper.style.width = "0px";
      }
    }

    if (typeof window !== "undefined") {
      // Backwards compatibility - keep old functions on window
      window.toggleChat = toggleChat;
      window.chatbotIdentify = identify;
      window.clearChatbotHistory = clearChatbotHistory;
      window.prefillChatbotQuestion = prefillChatbotQuestion;
      window.sendChatbotQuestion = sendChatbotQuestion;
      window.showWidget = showWidget;
      window.hideWidget = hideWidget;
      window.setChatbotLanguage = setChatbotLanguage;

      function chatbotLoaded(callback) {
        const handler = (e) => {
          try {
            const { type } = JSON.parse(e.data);
            if (type === "chatbotLoaded") {
              window.removeEventListener("message", handler); // Optional: remove after first match
              callback();
            }
          } catch (err) {
            // Ignore non-JSON messages
          }
        };

        window.addEventListener("message", handler);
      }

      window.chatbotLoaded = chatbotLoaded;

      // New wonderchat namespace
      window.wonderchat = {
        toggleChat: toggleChat,
        chatbotIdentify: identify,
        clearChatbotHistory: clearChatbotHistory,
        prefillChatbotQuestion: prefillChatbotQuestion,
        sendChatbotQuestion: sendChatbotQuestion,
        chatbotLoaded: chatbotLoaded,
        changeChatbotId: changeChatbotId,
        setChatbotLanguage: setChatbotLanguage,
        showWidget: showWidget,
        hideWidget: hideWidget,
      };
    }

    function getIframeUrl(chatbotId) {
      let iframeUrl = `${
        window.location.protocol === "https:" ? "https" : "http"
      }://${removeHttp(wonderchatAddress)}/widget/${chatbotId}`;
      const urlObj = new URL(iframeUrl);
      const wonderchatParams = new URLSearchParams();

      // Add current URL for embed tracking
      wonderchatParams.append("embedUrl", window.location.href);

      // Add UTM parameters from parent page
      const parentUrlParams = new URLSearchParams(window.location.search);
      const utmParams = [
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
      ];

      // Map to reference the data attribute variables directly
      const utmDataAttributes = {
        utm_source: dataUtmSource,
        utm_medium: dataUtmMedium,
        utm_campaign: dataUtmCampaign,
        utm_term: dataUtmTerm,
        utm_content: dataUtmContent,
      };

      utmParams.forEach((param) => {
        const value = parentUrlParams.get(param);
        if (value) {
          wonderchatParams.append(param, value);
        } else {
          // Fallback to data attributes (from wonderchat-seo.js)
          const dataValue = utmDataAttributes[param];
          if (dataValue) {
            wonderchatParams.append(param, dataValue);
          }
        }
      });

      if (dataGreeting) {
        wonderchatParams.append("greeting", dataGreeting);
      } else if (greeting) {
        wonderchatParams.append("greeting", greeting);
      }

      if (widgetButtonSize) {
        wonderchatParams.append("widgetButtonSize", widgetButtonSize);
      }

      if (widgetSize === "large") {
        wonderchatParams.append("widgetSize", "large");
      }

      if (dataHeaderHidden) {
        wonderchatParams.append("headerHidden", true);
      }

      if (dataHidden) {
        wonderchatParams.append("widgetButtonHidden", true);
      }

      if (dataDefaultLanguage) {
        wonderchatParams.append("language", dataDefaultLanguage);
      } else if (dataLanguage) {
        wonderchatParams.append("language", dataLanguage);
      }

      if (dataContext) {
        wonderchatParams.append("context", dataContext);
      }

      if (dataUserId) {
        wonderchatParams.append("userId", dataUserId);
      }

      if (dataUserEmail) {
        wonderchatParams.append("userEmail", dataUserEmail);
      }

      if (dataUserName) {
        wonderchatParams.append("userName", dataUserName);
      }

      if (placement) {
        wonderchatParams.append("placement", placement);
      }

      if (dataCustomCss) {
        wonderchatParams.append("customCss", encodeURIComponent(dataCustomCss));
      }

      if (isSeoWidget) {
        wonderchatParams.append("isSeoWidget", "true");
      }

      if (wonderchatPassphrase) {
        wonderchatParams.append(
          "passphrase",
          encodeURIComponent(wonderchatPassphrase),
        );
      }

      if (dataIdentityToken) {
        wonderchatParams.append("identityToken", dataIdentityToken);
      }

      if (dataIsInitiallyOpen) {
        if (window.matchMedia("(min-width: 991px)").matches) {
          if (dataInitialOpenUrls) {
            const currentUrl = window.location.href;
            const urlPatterns = dataInitialOpenUrls.split(",");
            let urlMatch = false;

            for (let pattern of urlPatterns) {
              pattern = pattern.trim();
              if (pattern.endsWith("*")) {
                const trimmedPattern = pattern.slice(0, pattern.length - 1);
                if (currentUrl.startsWith(trimmedPattern)) {
                  urlMatch = true;
                  break;
                }
              } else {
                if (pattern.endsWith("/")) {
                  pattern = pattern.slice(0, pattern.length - 1);
                }
                let url = currentUrl;
                if (url.endsWith("/")) {
                  url = url.slice(0, url.length - 1);
                }

                if (pattern === url) {
                  urlMatch = true;
                  break;
                }
              }
            }

            if (urlMatch) {
              wonderchatParams.append("isInitiallyOpen", "true");
            }
          } else {
            wonderchatParams.append("isInitiallyOpen", "true");
          }
        }
      }

      urlObj.search = wonderchatParams.toString();

      iframeUrl = urlObj.toString();
      return iframeUrl;
    }

    let iframeUrl = getIframeUrl(wonderchatId);

    iframe.setAttribute("src", iframeUrl);
    iframe.setAttribute("title", "Chat widget");
    iframe.setAttribute("frameborder", "0");
    iframe.setAttribute("scrolling", "no");
    iframe.setAttribute(
      "allow",
      "fullscreen; clipboard-read; clipboard-write; microphone",
    );
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.background = "transparent";
    iframe.style["min-height"] = "auto";
    iframe.style["color-scheme"] = "light";
    if (isSeoWidget) {
      iframe.style["display"] = "none";
    }
    iframe.id = "wonderchat";

    function shouldAppendIframe() {
      // Check if we should hide the widget based on device type
      if (dataDeviceVisibility) {
        const isMobile = window.matchMedia("(max-width: 990px)").matches;
        const isDesktop = window.matchMedia("(min-width: 991px)").matches;

        if (dataDeviceVisibility === "desktop" && isMobile) {
          return false;
        }

        if (dataDeviceVisibility === "mobile" && isDesktop) {
          return false;
        }
      }

      if (!dataIgnorePaths && !dataShowPaths) {
        if (!document.getElementById("wonderchat")) {
          wonderchatWrapper.style.zIndex = zIndexVisible;
          wonderchatWrapper?.appendChild(iframe);
          trackWidgetImpression();
        }
      } else {
        let paths = [];
        if (dataIgnorePaths) {
          paths = dataIgnorePaths.split(",");
        } else if (dataShowPaths) {
          paths = dataShowPaths.split(",");
        }

        let pathMatch = false;
        for (let path of paths) {
          path = normalizeForMatch(path);
          if (path.endsWith("*")) {
            const trimmedPath = path.slice(0, path.length - 2);
            const href = normalizeForMatch(window.location.href);
            if (
              dataIgnorePaths
                ? href.startsWith(trimmedPath)
                : !href.startsWith(trimmedPath)
            ) {
              const iframeToRemove = document.getElementById("wonderchat");
              if (iframeToRemove) {
                iframeToRemove.parentNode.removeChild(iframeToRemove);
                wonderchatWrapper.style.zIndex = zIndexHidden;
              }
              return;
            }
          } else {
            if (path.endsWith("/")) {
              path = path.slice(0, path.length - 1);
            }
            let url = normalizeForMatch(window.location.href);
            if (url.endsWith("/")) {
              url = url.slice(0, url.length - 1);
            }

            if (dataIgnorePaths && path === url) {
              const iframeToRemove = document.getElementById("wonderchat");
              if (iframeToRemove) {
                iframeToRemove.parentNode.removeChild(iframeToRemove);
                wonderchatWrapper.style.zIndex = zIndexHidden;
              }
              return;
            }

            if (dataShowPaths && path === url) {
              pathMatch = true;
            }
          }
        }

        if (!pathMatch && dataShowPaths) {
          const iframeToRemove = document.getElementById("wonderchat");
          if (iframeToRemove) {
            iframeToRemove.parentNode.removeChild(iframeToRemove);
            wonderchatWrapper.style.zIndex = zIndexHidden;
          }
          return;
        }

        if (!document.getElementById("wonderchat")) {
          wonderchatWrapper?.appendChild(iframe);
          wonderchatWrapper.style.zIndex = zIndexVisible;
          trackWidgetImpression();
        }
      }
    }

    shouldAppendIframe();

    let oldHref = document.location.href;

    // Create an observer instance to watch for URL changes
    const observer = new MutationObserver(function (mutations) {
      if (oldHref !== document.location.href) {
        const newHref = document.location.href;
        oldHref = newHref;

        if (iframe?.contentWindow) {
          const pageContext = getWonderchatPageContext();
          iframe.contentWindow.postMessage(
            JSON.stringify({
              type: "URL_CHANGE",
              payload: {
                url: newHref,
                title: pageContext.title,
                content: pageContext.content,
              },
            }),
            "*",
          );
        }
      }
    });

    // Start observing the document with the configured parameters
    observer.observe(document, { subtree: true, childList: true });

    // Also watch for history changes
    window.addEventListener("popstate", function () {
      if (iframe?.contentWindow) {
        const pageContext = getWonderchatPageContext();
        iframe.contentWindow.postMessage(
          JSON.stringify({
            type: "URL_CHANGE",
            payload: {
              url: this.document.location.href,
              title: pageContext.title,
              content: pageContext.content,
            },
          }),
          "*",
        );
      }
    });

    if (dataIgnorePaths || dataShowPaths) {
      window.onload = function () {
        const bodyList = document.querySelector("body");

        const observer = new MutationObserver(function (mutations) {
          if (oldHref != document.location.href) {
            oldHref = document.location.href;
            shouldAppendIframe();
            /* Changed ! your code here */
          }
        });

        const config = {
          childList: true,
          subtree: true,
        };

        observer.observe(bodyList, config);
      };
    }

    function waitForElm(selector) {
      return new Promise((resolve) => {
        if (document.querySelector(selector)) {
          return resolve(document.querySelector(selector));
        }

        const observer = new MutationObserver((mutations) => {
          if (document.querySelector(selector)) {
            resolve(document.querySelector(selector));
            observer.disconnect();
          }
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true,
        });
      });
    }

    function addDragger() {
      const dragger = document.createElement("div");
      dragger.style.position = "absolute";
      dragger.style.top = "20px";
      dragger.style.left = "60px";
      dragger.style.width = "220px";
      dragger.style.height = "85px";
      dragger.style.cursor = "grab";
      dragger.id = "chatbot-dragger";

      var isDragging = false;
      var startPos = { x: 0, y: 0 };
      var elementPos = { x: 0, y: 0 };

      // Mouse down event
      dragger.addEventListener("mousedown", function (e) {
        isDragging = true;
        dragger.style.top = "20px";
        dragger.style.left = "60px";
        dragger.style.width = "300px";
        dragger.style.height = "800px";

        startPos = {
          x: e.clientX,
          y: e.clientY,
        };

        // Get the element's position including margins
        var rect = wonderchatWrapper.getBoundingClientRect();

        elementPos = {
          x: placement === "left" ? rect.left : window.innerWidth - rect.right,
          y: window.innerHeight - rect.bottom,
        };
        dragger.style.cursor = "grabbing";
      });

      // Mouse move event
      document.addEventListener("mousemove", function (e) {
        if (isDragging) {
          // Calculate the new position
          var dx = startPos.x - e.clientX;
          var dy = startPos.y - e.clientY;

          // Get current margins
          var computedStyle = window.getComputedStyle(wonderchatWrapper);
          var marginLeft = parseInt(computedStyle.marginLeft) || 0;
          var marginRight = parseInt(computedStyle.marginRight) || 0;

          // Update the element's position, subtracting margins
          if (placement === "left") {
            wonderchatWrapper.style.left =
              elementPos.x - dx - marginLeft + "px";
          } else {
            wonderchatWrapper.style.right =
              elementPos.x + dx - marginRight + "px";
          }
          wonderchatWrapper.style.bottom = elementPos.y + dy + "px";
        }
      });

      // Mouse up event
      window.addEventListener("mouseup", function () {
        isDragging = false;
        dragger.style.top = "20px";
        dragger.style.left = "60px";
        dragger.style.width = "220px";
        dragger.style.height = "85px";
        dragger.style.cursor = "grab";
        // wonderchatWrapper.style.left = "0px";
      });

      wonderchatWrapper.appendChild(dragger);
    }

    function removeDragger() {
      wonderchatWrapper.removeChild(document.getElementById("chatbot-dragger"));
    }

    waitForElm("#wonderchat").then((elm) => {
      var iframe = document.getElementById("wonderchat");

      // Send greeting to iframe, preferring an explicit override, then data-greeting, then default
      function sendGreetingToIframe(greetingOverride) {
        var greetingText = greetingOverride || getStaticGreeting();
        if (greetingText) {
          iframe.contentWindow.postMessage(
            JSON.stringify({
              type: "showDynamicGreeting",
              payload: { greeting: greetingText },
            }),
            "*",
          );
        } else {
          iframe.contentWindow.postMessage(
            JSON.stringify({ type: "showGreeting" }),
            "*",
          );
        }

        if (!dataInitialHidden) {
          wonderchatWrapper.style.height = widgetButtonWrapperHeight;
          wonderchatWrapper.style.width = "min(100%, 350px)";
        }
      }

      // Only add draggable if not mobile
      if (
        dataWidgetMovable &&
        window.matchMedia("(min-width: 991px)").matches
      ) {
        addDragger();
      }

      // Add escape key listener to close widget
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && widgetOpen) {
          toggleChat(false);
        }
      });

      window.addEventListener(
        "message",
        function (e) {
          if (!e.origin.match(wonderchatAddress)) {
            return;
          }
          let type;
          let payload;

          try {
            const parsed = JSON.parse(e.data);
            type = parsed.type;
            payload = parsed.payload;
          } catch (err) {
            return;
          }
          switch (type) {
            case "changeWrapperMargin": {
              if (window.matchMedia("(min-width: 991px)").matches) {
                if (offsetBottom) {
                  wonderchatWrapper.style.marginBottom = offsetBottom;
                }
                if (offsetRight) {
                  wonderchatWrapper.style.marginRight = offsetRight;
                }
                if (offsetLeft) {
                  wonderchatWrapper.style.marginLeft = offsetLeft;
                }
              } else {
                /* Mobile */
                if (offsetBottomMobile) {
                  wonderchatWrapper.style.marginBottom = offsetBottomMobile;
                }
                if (offsetRightMobile) {
                  wonderchatWrapper.style.marginRight = offsetRightMobile;
                }
                if (offsetLeftMobile) {
                  wonderchatWrapper.style.marginLeft = offsetLeftMobile;
                }
              }
              break;
            }
            case "showChat": {
              // Clear any pending timeout
              if (window.dynamicGreetingTimeout && !!payload.isOpen) {
                clearTimeout(window.dynamicGreetingTimeout);
                window.dynamicGreetingTimeout = null;
              }

              if (window.greetingTimeout && !!payload.isOpen) {
                clearTimeout(window.greetingTimeout);
                window.greetingTimeout = null;
              }
              const wasWidgetOpen = widgetOpen;
              widgetOpen = !!payload.isOpen;
              // Only emit on a real open/close transition — the iframe re-posts
              // showChat (incl. isOpen:false on load) for layout reasons, which
              // would otherwise spam analytics with phantom close events.
              if (widgetOpen !== wasWidgetOpen) {
                trackAnalyticsEvent(
                  widgetOpen
                    ? "wonderchat_widget_opened"
                    : "wonderchat_widget_closed",
                );
              }
              if (payload.isOpen === true) {
                /* Non mobile, normal widget */
                if (window.matchMedia("(min-width: 991px)").matches) {
                  const targetHeight = widgetExpanded
                    ? EXPANDED_HEIGHT
                    : parseInt(VALID_WIDGET_SIZES[widgetSize].height);
                  const targetWidth = widgetExpanded
                    ? EXPANDED_WIDTH
                    : parseInt(VALID_WIDGET_SIZES[widgetSize].width);
                  const size = getConstrainedSize(targetHeight, targetWidth);

                  iframe.parentNode.style.height = size.height + "px";
                  iframe.parentNode.style.width = size.width + "px";
                  iframe.style.width = "100%";
                  document.body.style.overflow = oldOverflow;
                } else {
                  /* Mobile, full screen widget */

                  iframe.parentNode.style.height = "100%";
                  iframe.parentNode.style.width = "100%";
                  iframe.style.width = "100%";
                  document.body.style.setProperty(
                    "overflow",
                    "hidden",
                    "important",
                  );
                  if (offsetBottom || offsetBottomMobile) {
                    wonderchatWrapper.style.marginBottom = "0px";
                  }
                  if (offsetRight || offsetRightMobile) {
                    wonderchatWrapper.style.marginRight = "0px";
                  }
                  if (offsetLeft || offsetLeftMobile) {
                    wonderchatWrapper.style.marginLeft = "0px";
                  }
                }
              } else {
                if (dataHidden || dataInitialHidden) {
                  iframe.parentNode.style.height = "0px";
                  iframe.parentNode.style.width = "0px";
                } else {
                  iframe.parentNode.style.height =
                    widgetButtonSize === "extraLarge"
                      ? "135px"
                      : widgetButtonSize === "large"
                        ? "122.5px"
                        : "110px";
                  iframe.parentNode.style.width =
                    widgetButtonSize === "extraLarge"
                      ? "135px"
                      : widgetButtonSize === "large"
                        ? "122.5px"
                        : "110px";
                }
                document.body.style.overflow = oldOverflow;
              }

              break;
            }
            case "expandWidget": {
              widgetExpanded = !!payload.isExpanded;

              if (
                !window.matchMedia("(min-width: 991px)").matches ||
                !widgetOpen
              ) {
                break;
              }

              // Temporarily set transition for smooth animation
              iframe.parentNode.style.transition =
                "width 0.3s ease, height 0.3s ease";

              const targetHeight = payload.isExpanded
                ? EXPANDED_HEIGHT
                : parseInt(VALID_WIDGET_SIZES[widgetSize].height);
              const targetWidth = payload.isExpanded
                ? EXPANDED_WIDTH
                : parseInt(VALID_WIDGET_SIZES[widgetSize].width);
              const size = getConstrainedSize(targetHeight, targetWidth);

              iframe.parentNode.style.height = size.height + "px";
              iframe.parentNode.style.width = size.width + "px";

              // Clear transition after animation completes to avoid conflicts with open/close
              setTimeout(function () {
                iframe.parentNode.style.transition = "";
              }, 350);

              break;
            }
            case "chatbotHydrated": {
              iframe.style["display"] = "block";
              break;
            }
            case "chatbotLoaded":
              if (payload && payload.enableGtmEvents) {
                dataLayerEvents = true;
              }
              if (payload && payload.enablePosthogEvents) {
                posthogEvents = true;
              }
              const chatHistory = JSON.parse(
                dataUserId
                  ? this.localStorage.getItem(
                      `chatHistory_${wonderchatId}_${dataUserId}`,
                    )
                  : localStorage.getItem(`chatHistory_${wonderchatId}`)
                    ? localStorage.getItem(`chatHistory_${wonderchatId}`)
                    : localStorage.getItem(`chatHistory`)
                      ? localStorage.getItem(`chatHistory`)
                      : "[]",
              );
              const chatlogId = dataUserId
                ? this.localStorage.getItem(
                    `chatlogId_${wonderchatId}_${dataUserId}`,
                  )
                : (localStorage.getItem(`chatlogId_${wonderchatId}`) ??
                  localStorage.getItem(`chatlogId`) ??
                  null);
              const userDetail = JSON.parse(
                this.localStorage.getItem(`userDetail_${wonderchatId}`) ??
                  this.localStorage.getItem(`userDetail`) ??
                  "{}",
              );
              const userToken =
                localStorage.getItem(`${chatlogId}_token`) ?? null;

              // Migration: if conversations array doesn't exist but old chatlogId does, migrate
              const conversationsKey = dataUserId
                ? `conversations_${wonderchatId}_${dataUserId}`
                : `conversations_${wonderchatId}`;
              let conversations = [];
              try {
                conversations = JSON.parse(
                  this.localStorage.getItem(conversationsKey) || "[]",
                );
              } catch (e) {
                conversations = [];
              }
              if (conversations.length === 0 && chatlogId && userToken) {
                conversations = [
                  {
                    chatlogId: chatlogId,
                    userToken: userToken,
                    lastActive: new Date().toISOString(),
                  },
                ];
                this.localStorage.setItem(
                  conversationsKey,
                  JSON.stringify(conversations),
                );
              }

              iframe.contentWindow.postMessage(
                JSON.stringify({
                  type: "chatHistory",
                  payload: {
                    chatHistory,
                    chatlogId,
                    userDetail,
                    userToken,
                    conversations,
                    customGreeting: getStaticGreeting() || undefined,
                  },
                }),
                "*",
              );

              if (dataPreviewLiveChat) {
                iframe.contentWindow.postMessage(
                  JSON.stringify({
                    type: "previewLiveChat",
                    payload: {},
                  }),
                  "*",
                );
              }

              iframe.contentWindow.postMessage(
                JSON.stringify({
                  type: "utmParams",
                  payload: {
                    utm_source:
                      sessionStorage.getItem("wc_utm_source") ?? undefined,
                    utm_medium:
                      sessionStorage.getItem("wc_utm_medium") ?? undefined,
                    utm_campaign:
                      sessionStorage.getItem("wc_utm_campaign") ?? undefined,
                    utm_term:
                      sessionStorage.getItem("wc_utm_term") ?? undefined,
                    utm_content:
                      sessionStorage.getItem("wc_utm_content") ?? undefined,
                  },
                }),
                "*",
              );

              const initialPageContext = getWonderchatPageContext();
              iframe.contentWindow.postMessage(
                JSON.stringify({
                  type: "URL_CHANGE",
                  payload: {
                    url: document.location.href,
                    title: initialPageContext.title,
                    content: initialPageContext.content,
                  },
                }),
                "*",
              );

              // Process any queued SDK calls now that chatbot is loaded
              if (
                window.__wonderchatSDKQueue &&
                Array.isArray(window.__wonderchatSDKQueue)
              ) {
                window.__wonderchatSDKQueue.forEach((queuedCall) => {
                  try {
                    switch (queuedCall.method) {
                      case "chatbotIdentify":
                        identify.apply(null, queuedCall.args);
                        break;
                      case "toggleChat":
                        toggleChat.apply(null, queuedCall.args);
                        break;
                      case "changeChatbotId":
                        changeChatbotId.apply(null, queuedCall.args);
                        break;
                      case "clearChatbotHistory":
                        clearChatbotHistory.apply(null, queuedCall.args);
                        break;
                      case "prefillChatbotQuestion":
                        prefillChatbotQuestion.apply(null, queuedCall.args);
                        break;
                      case "sendChatbotQuestion":
                        sendChatbotQuestion.apply(null, queuedCall.args);
                        break;
                      case "chatbotLoaded":
                        // For callbacks, just execute them since we're already loaded
                        if (typeof queuedCall.args[0] === "function") {
                          queuedCall.args[0]();
                        }
                        break;
                      case "showWidget":
                        showWidget();
                        break;
                      case "hideWidget":
                        hideWidget();
                        break;
                      case "setChatbotLanguage":
                        setChatbotLanguage.apply(null, queuedCall.args);
                        break;
                    }
                  } catch (err) {
                    console.error("Error processing queued SDK call:", err);
                  }
                });
                // Clear the queue
                window.__wonderchatSDKQueue = [];
              }

              // Replace queue functions with real SDK functions now that chatbot is ready
              window.toggleChat = toggleChat;
              window.chatbotIdentify = identify;
              window.changeChatbotId = changeChatbotId;
              window.clearChatbotHistory = clearChatbotHistory;
              window.prefillChatbotQuestion = prefillChatbotQuestion;
              window.sendChatbotQuestion = sendChatbotQuestion;
              window.showWidget = showWidget;
              window.hideWidget = hideWidget;
              window.setChatbotLanguage = setChatbotLanguage;
              // chatbotLoaded is already set in the initial setup

              // Also update the wonderchat namespace
              if (window.wonderchat) {
                window.wonderchat.toggleChat = toggleChat;
                window.wonderchat.chatbotIdentify = identify;
                window.wonderchat.changeChatbotId = changeChatbotId;
                window.wonderchat.clearChatbotHistory = clearChatbotHistory;
                window.wonderchat.prefillChatbotQuestion =
                  prefillChatbotQuestion;
                window.wonderchat.sendChatbotQuestion = sendChatbotQuestion;
                window.wonderchat.chatbotLoaded = window.chatbotLoaded;
                window.wonderchat.showWidget = showWidget;
                window.wonderchat.hideWidget = hideWidget;
                window.wonderchat.setChatbotLanguage = setChatbotLanguage;
              }

              // The SEO facade owns the greeting popup and its timer. Scheduling
              // here would overwrite its window.greetingTimeout, which its SMART
              // trigger checks before showing, so the popup would never appear.
              if (isSeoWidget) break;

              // An owner-requested initial open keeps the old prompt timing.
              const greetingTrigger = dataIsInitiallyOpen
                ? "IMMEDIATE"
                : payload.greetingTrigger;
              window.greetingTimeout = scheduleProactiveGreeting(greetingTrigger, () => {
                // Check if we should show the greeting based on behavior
                const shouldNotGreet = (() => {
                  // greeting message handled by outer seo script
                  if (isSeoWidget) {
                    return true;
                  }
                  const greetingBehavior =
                    payload.greetingBehavior || "ON_PAGE_REOPEN";
                  const greetingState = localStorage.getItem(
                    `greeting_state_${wonderchatId}`,
                  );

                  if (!greetingState) return false;

                  const state = JSON.parse(greetingState);

                  switch (greetingBehavior) {
                    case "ALWAYS_SHOW":
                      return false;
                    case "DONT_SHOW_AGAIN":
                      return state.dismissed;
                    case "AFTER_ONE_DAY":
                      return (
                        state.dismissedAt &&
                        Date.now() - state.dismissedAt < 24 * 60 * 60 * 1000
                      );
                    case "ON_PAGE_REOPEN":
                    default:
                      return sessionStorage.getItem("shouldNotGreet") === "1";
                  }
                })();

                // shouldSpontaneouslyGreet is the master switch — mobile greeting is
                // only a sub-toggle that further restricts it, never one that can
                // greet on its own.
                const isMobile =
                  window.matchMedia("(max-width: 990px)").matches;
                const shouldGreet =
                  payload.shouldSpontaneouslyGreet &&
                  (!isMobile ||
                    (payload.shouldSpontaneouslyGreetMobile ?? true));

                if (
                  !widgetOpen &&
                  !isSeoWidget &&
                  ((!shouldNotGreet && shouldGreet) ||
                    (dataIsInitiallyOpen &&
                      !window.matchMedia("(min-width: 991px)").matches &&
                      (!dataInitialOpenUrls ||
                        (() => {
                          const currentUrl = window.location.href;
                          const urlPatterns = dataInitialOpenUrls.split(",");
                          for (let pattern of urlPatterns) {
                            pattern = pattern.trim();
                            if (pattern.endsWith("*")) {
                              const trimmedPattern = pattern.slice(
                                0,
                                pattern.length - 1,
                              );
                              if (currentUrl.startsWith(trimmedPattern)) {
                                return true;
                              }
                            } else {
                              if (pattern.endsWith("/")) {
                                pattern = pattern.slice(0, pattern.length - 1);
                              }
                              let url = currentUrl;
                              if (url.endsWith("/")) {
                                url = url.slice(0, url.length - 1);
                              }

                              if (pattern === url) {
                                return true;
                              }
                            }
                          }
                          return false;
                        })())))
                ) {
                  greetingTriggerFired = true;
                  if (payload.enableDynamicGreeting && readyDynamicGreeting) {
                    sendGreetingToIframe(readyDynamicGreeting);
                  } else if (payload.enableDynamicGreeting) {
                    window.dynamicGreetingTimeout = setTimeout(() => {
                      console.warn(
                        "Dynamic greeting timeout, falling back to static greeting",
                      );
                      sendGreetingToIframe();
                    }, 1000);
                  } else {
                    sendGreetingToIframe();
                  }
                }
              });
              break;

            case "dynamicGreetingReady": {
              // Ignore seo widget
              if (widgetOpen) break;
              if (isSeoWidget) break;

              const {
                greeting,
                shouldSpontaneouslyGreet,
                shouldSpontaneouslyGreetMobile,
              } = payload;

              // Clear any pending timeout
              if (window.dynamicGreetingTimeout) {
                clearTimeout(window.dynamicGreetingTimeout);
                window.dynamicGreetingTimeout = null;
              }

              // Check if we should show greeting based on device type.
              // shouldSpontaneouslyGreet is the master switch — mobile greeting is
              // only a sub-toggle that further restricts it.
              const isMobile = window.matchMedia("(max-width: 990px)").matches;
              const shouldGreet =
                shouldSpontaneouslyGreet &&
                (!isMobile || (shouldSpontaneouslyGreetMobile ?? true));

              // Don't show greeting if shouldGreet is false
              if (!shouldGreet) {
                break;
              }

              if (!greetingTriggerFired) {
                readyDynamicGreeting = greeting;
                break;
              }

              // data-greeting attribute takes priority over dynamic greeting
              sendGreetingToIframe(greeting);
              break;
            }

            case "expandGreetingWrapper": {
              // Expand wrapper to accommodate suggested questions
              if (widgetOpen || isSeoWidget) break;

              const { questionsCount, additionalHeight, measuredWrapperHeight } =
                payload;

              const baseHeight = parseInt(baseWidgetButtonWrapperHeight);
              // Prefer the child's measured stack height (robust to multi-line
              // wrapping of the greeting or chips); fall back to the legacy
              // per-chip estimate for older child scripts. Never shrink below base.
              const totalHeight =
                measuredWrapperHeight > 0
                  ? Math.max(baseHeight, measuredWrapperHeight)
                  : baseHeight + (additionalHeight || 0);

              // Expand when there are chips, or when even a wrapped greeting alone
              // needs more room than the base wrapper height.
              if (questionsCount > 0 || measuredWrapperHeight > baseHeight) {
                widgetButtonWrapperHeight = `${totalHeight}px`;
                if (!dataInitialHidden) {
                  wonderchatWrapper.style.height = widgetButtonWrapperHeight;
                  wonderchatWrapper.style.width = "min(100%, 350px)";
                }
              }
              break;
            }

            case "messageListReady": {
              // Message list is ready in Chat component, send any pending question
              if (window.pendingQuestion) {
                iframe.contentWindow.postMessage(
                  JSON.stringify({
                    type: "autoSendQuestion",
                    payload: { question: window.pendingQuestion },
                  }),
                  "*",
                );
                window.pendingQuestion = null;
              }
              break;
            }

            case "chatbotAcknowledged": {
              // Save greeting state based on behavior
              const greetingBehavior = e.greetingBehavior || "ON_PAGE_REOPEN";
              const state = {
                dismissed: true,
                dismissedAt: Date.now(),
              };

              localStorage.setItem(
                `greeting_state_${wonderchatId}`,
                JSON.stringify(state),
              );
              sessionStorage.setItem("shouldNotGreet", "1");
              break;
            }
            case "requestWidth": {
              if (window.matchMedia("(min-width: 991px)").matches) {
                iframe.contentWindow.postMessage(
                  JSON.stringify({ type: `popup` }),
                  "*",
                );
              } else {
                iframe.contentWindow.postMessage(
                  JSON.stringify({ type: "fullscreen" }),
                  "*",
                );
              }
              break;
            }
            case "chatHistory": {
              const { chatHistory, chatlogId } = payload;
              if (dataUserId) {
                this.localStorage.setItem(
                  `chatHistory_${wonderchatId}_${dataUserId}`,
                  JSON.stringify(chatHistory),
                );
              } else {
                this.localStorage.setItem(
                  `chatHistory_${wonderchatId}`,
                  JSON.stringify(chatHistory),
                );
              }

              if (chatlogId) {
                if (dataUserId) {
                  this.localStorage.setItem(
                    `chatlogId_${wonderchatId}_${dataUserId}`,
                    chatlogId,
                  );
                } else {
                  this.localStorage.setItem(
                    `chatlogId_${wonderchatId}`,
                    chatlogId,
                  );
                }

                // Upsert into conversations array
                const convKey = dataUserId
                  ? `conversations_${wonderchatId}_${dataUserId}`
                  : `conversations_${wonderchatId}`;
                let convList = [];
                try {
                  convList = JSON.parse(
                    this.localStorage.getItem(convKey) || "[]",
                  );
                } catch (e) {
                  convList = [];
                }
                const convToken =
                  this.localStorage.getItem(`${chatlogId}_token`) || null;
                if (convToken) {
                  const existingIdx = convList.findIndex(
                    (c) => c.chatlogId === chatlogId,
                  );
                  if (existingIdx >= 0) {
                    const [existing] = convList.splice(existingIdx, 1);
                    existing.lastActive = new Date().toISOString();
                    existing.userToken = convToken;
                    convList.unshift(existing);
                  } else {
                    convList.unshift({
                      chatlogId: chatlogId,
                      userToken: convToken,
                      lastActive: new Date().toISOString(),
                    });
                  }
                  // Cap at 50 conversations
                  if (convList.length > 50) {
                    convList = convList.slice(0, 50);
                  }
                  this.localStorage.setItem(convKey, JSON.stringify(convList));

                  // Notify iframe of updated conversations
                  iframe.contentWindow.postMessage(
                    JSON.stringify({
                      type: "conversationsUpdated",
                      payload: { conversations: convList },
                    }),
                    "*",
                  );
                }
              }
              break;
            }

            case "clearChatHistory": {
              const chatlogId = dataUserId
                ? this.localStorage.getItem(
                    `chatlogId_${wonderchatId}_${dataUserId}`,
                  )
                : this.localStorage.getItem(`chatlogId_${wonderchatId}`);
              this.localStorage.removeItem(`chatlogId`);
              this.localStorage.removeItem(`chatHistory`);
              this.localStorage.removeItem(`userDetail`);
              this.localStorage.removeItem(`chatlogId_${wonderchatId}`);
              this.localStorage.removeItem(
                `chatlogId_${wonderchatId}_${dataUserId}`,
              );
              this.localStorage.removeItem(`chatHistory_${wonderchatId}`);
              this.localStorage.removeItem(
                `chatHistory_${wonderchatId}_${dataUserId}`,
              );
              this.localStorage.removeItem(`userDetail_${wonderchatId}`);
              this.localStorage.removeItem(`${chatlogId}_token`);
              // Only clear conversations array when conversation history is NOT enabled
              if (!payload?.enableConversationHistory) {
                this.localStorage.removeItem(`conversations_${wonderchatId}`);
                this.localStorage.removeItem(
                  `conversations_${wonderchatId}_${dataUserId}`,
                );
              }
              break;
            }

            case "switchConversation": {
              const { chatlogId: switchChatlogId, userToken: switchUserToken } =
                payload;
              // Update active chatlogId
              if (dataUserId) {
                this.localStorage.setItem(
                  `chatlogId_${wonderchatId}_${dataUserId}`,
                  switchChatlogId,
                );
              } else {
                this.localStorage.setItem(
                  `chatlogId_${wonderchatId}`,
                  switchChatlogId,
                );
              }
              // Store userToken so it persists across page reloads
              if (switchUserToken) {
                this.localStorage.setItem(
                  `${switchChatlogId}_token`,
                  switchUserToken,
                );
              }
              // Clear cached chatHistory (widget will re-fetch from DB)
              if (dataUserId) {
                this.localStorage.removeItem(
                  `chatHistory_${wonderchatId}_${dataUserId}`,
                );
              } else {
                this.localStorage.removeItem(`chatHistory_${wonderchatId}`);
              }
              break;
            }

            case "newConversation": {
              // Clear active chatlogId and chatHistory but keep conversations array intact
              if (dataUserId) {
                this.localStorage.removeItem(
                  `chatlogId_${wonderchatId}_${dataUserId}`,
                );
                this.localStorage.removeItem(
                  `chatHistory_${wonderchatId}_${dataUserId}`,
                );
              } else {
                this.localStorage.removeItem(`chatlogId_${wonderchatId}`);
                this.localStorage.removeItem(`chatHistory_${wonderchatId}`);
              }
              // A fresh conversation may emit "conversation started" again.
              analyticsConversationStarted = false;
              break;
            }

            case "messageSent": {
              // First visitor message of a conversation doubles as the
              // "conversation started" signal.
              if (!analyticsConversationStarted) {
                analyticsConversationStarted = true;
                trackAnalyticsEvent("wonderchat_conversation_started");
              }
              trackAnalyticsEvent("wonderchat_message_sent");
              break;
            }

            case "deleteConversation": {
              const { chatlogId: deleteChatlogId } = payload;
              const convKey = dataUserId
                ? `conversations_${wonderchatId}_${dataUserId}`
                : `conversations_${wonderchatId}`;
              try {
                let convs = JSON.parse(
                  this.localStorage.getItem(convKey) || "[]",
                );
                convs = convs.filter((c) => c.chatlogId !== deleteChatlogId);
                this.localStorage.setItem(convKey, JSON.stringify(convs));
              } catch (e) {}
              // Remove the token so chatHistory handler won't re-add this conversation
              this.localStorage.removeItem(`${deleteChatlogId}_token`);
              // If the deleted conversation was the active one, clear it
              const activeKey = dataUserId
                ? `chatlogId_${wonderchatId}_${dataUserId}`
                : `chatlogId_${wonderchatId}`;
              if (this.localStorage.getItem(activeKey) === deleteChatlogId) {
                this.localStorage.removeItem(activeKey);
                if (dataUserId) {
                  this.localStorage.removeItem(
                    `chatHistory_${wonderchatId}_${dataUserId}`,
                  );
                } else {
                  this.localStorage.removeItem(`chatHistory_${wonderchatId}`);
                }
              }
              break;
            }

            /*
          detail: 'EMAIL' | 'PHONE_NUMBER' | 'NAME'
        */

            case "userDetailCollected": {
              const { detail, value } = payload;
              const savedDetail =
                this.localStorage.getItem(`userDetail_${wonderchatId}`) ??
                this.localStorage.getItem(`userDetail`) ??
                "{}";
              try {
                const parsed = JSON.parse(savedDetail);
                const updatedDetail = { ...parsed, [detail]: value || true };
                this.localStorage.setItem(
                  `userDetail_${wonderchatId}`,
                  JSON.stringify(updatedDetail),
                );
              } catch (err) {
                console.log(err);
              }
              break;
            }

            case "linkClick": {
              const { href } = payload;
              window.location.href = href;
              break;
            }

            case "chatlogToken": {
              const { chatlogId, userToken } = payload;
              this.localStorage.setItem(`${chatlogId}_token`, userToken);
              break;
            }
          }
        },
        false,
      );
    });
  }

  // Apply delay if specified, otherwise initialize immediately
  // Skip delay if loaded from SEO widget (delay already applied there)
  if (dataDelay > 0 && !isSeoWidget) {
    setTimeout(initializeWidget, dataDelay);
  } else {
    initializeWidget();
  }
})();
