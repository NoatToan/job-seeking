/**
 * Cookie consent (docs/DECISIONS.md "Cookie consent"). Only analytics (Google Tag Manager → GA4)
 * needs consent: every other cookie or storage key the app writes is strictly necessary or a
 * preference the visitor set themselves (session, CSRF, language, theme). Until the visitor
 * chooses, GTM is not loaded at all and Google Consent Mode v2 starts at "denied".
 *
 * The choice is a first-party cookie, `ujc_consent=v<version>.<a0|a1>.<unix seconds>`, kept for
 * 180 days; after that (or when `CONSENT_VERSION` is bumped because the cookie list changed) the
 * banner asks again.
 */
export const CONSENT_COOKIE = "ujc_consent";
/** Bump when a new non-essential cookie or purpose is added, so everyone is asked again. */
export const CONSENT_VERSION = 1;
export const CONSENT_MAX_AGE_S = 60 * 60 * 24 * 180;

export interface ConsentChoice {
  analytics: boolean;
  /** When the choice was made (unix seconds), kept as the record of consent. */
  at: number;
}

/** Parses a cookie value; null for a missing, malformed or outdated record. */
export function parseConsent(raw: string | null | undefined): ConsentChoice | null {
  const m = /^v(\d+)\.a([01])\.(\d+)$/.exec(raw ?? "");
  if (!m || Number(m[1]) !== CONSENT_VERSION) return null;
  return { analytics: m[2] === "1", at: Number(m[3]) };
}

export function readConsent(): ConsentChoice | null {
  try {
    const entry = document.cookie.split("; ").find((c) => c.startsWith(`${CONSENT_COOKIE}=`));
    return parseConsent(entry ? decodeURIComponent(entry.slice(CONSENT_COOKIE.length + 1)) : null);
  } catch {
    return null;
  }
}

export function writeConsent(analytics: boolean, now: number = Date.now()): ConsentChoice {
  const choice = { analytics, at: Math.floor(now / 1000) };
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie =
    `${CONSENT_COOKIE}=v${CONSENT_VERSION}.a${analytics ? 1 : 0}.${choice.at}` +
    `; path=/; max-age=${CONSENT_MAX_AGE_S}; samesite=lax${secure}`;
  return choice;
}

/** Google Analytics cookies (`_ga`, `_ga_<id>`, `_gid`, `_gat…`). */
export function isAnalyticsCookie(name: string): boolean {
  return name === "_ga" || name === "_gid" || name.startsWith("_ga_") || name.startsWith("_gat");
}

/**
 * Deletes the analytics cookies after consent is withdrawn. GA sets them on the widest domain it
 * can (`.example.com`), so each one is expired for the host and every parent domain.
 */
export function clearAnalyticsCookies(): void {
  const names = document.cookie
    .split("; ")
    .map((c) => c.split("=")[0])
    .filter(isAnalyticsCookie);
  const parts = window.location.hostname.split(".");
  const domains = [""];
  for (let i = 0; i < parts.length - 1; i++) domains.push(`; domain=.${parts.slice(i).join(".")}`);
  for (const name of names) {
    for (const domain of domains) document.cookie = `${name}=; path=/; max-age=0${domain}`;
  }
}

/** Consent Mode v2 signals: only analytics can ever be granted; the site runs no ads. */
export function consentModeState(analytics: boolean) {
  return {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: analytics ? "granted" : "denied",
  } as const;
}

/**
 * Inlined in <head> before anything else can touch `dataLayer`: defines `gtag`, sets every
 * Consent Mode signal to "denied" by default, and re-applies a saved "granted" so a returning
 * visitor's first page view is counted. Must stay in step with `parseConsent`.
 */
export const CONSENT_INIT_SCRIPT = `(function(){window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){window.dataLayer.push(arguments)};gtag("consent","default",${JSON.stringify(
  { ...consentModeState(false), wait_for_update: 500 },
)});try{var c=document.cookie.split("; ").find(function(x){return x.indexOf(${JSON.stringify(
  `${CONSENT_COOKIE}=`,
)})===0});if(c&&/^v${CONSENT_VERSION}\\.a1\\./.test(decodeURIComponent(c.split("=")[1])))gtag("consent","update",${JSON.stringify(
  consentModeState(true),
)})}catch(e){}})()`;
