const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_STALE_AFTER_DAYS = 45;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateKnowledgeBase(data) {
  const errors = [];

  if (!isObject(data)) return ["root must be an object"];
  if (typeof data._version !== "string" || data._version.length === 0) {
    errors.push("_version must be a non-empty string");
  }
  if (typeof data._updatedAt !== "string" || data._updatedAt.length === 0) {
    errors.push("_updatedAt must be a non-empty string");
  }
  if (!Array.isArray(data.DEPRECATED)) errors.push("DEPRECATED must be an array");
  if (!isObject(data.DOCS)) errors.push("DOCS must be an object");
  if (!isObject(data.VERSIONS)) errors.push("VERSIONS must be an object");

  return errors;
}

function parseUpdatedAt(value) {
  if (typeof value !== "string") return null;
  const normalized = /^\d{4}-\d{2}$/.test(value)
    ? `${value}-01T00:00:00Z`
    : value;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function knowledgeBaseFreshness(
  data,
  now = new Date(),
  staleAfterDays = DEFAULT_STALE_AFTER_DAYS
) {
  const updatedAt = data?._updatedAt ?? null;
  const updatedTimestamp = parseUpdatedAt(updatedAt);
  const nowTimestamp = now instanceof Date ? now.getTime() : Date.parse(now);

  if (!Number.isFinite(updatedTimestamp) || !Number.isFinite(nowTimestamp)) {
    return { status: "unknown", updatedAt, ageDays: null, staleAfterDays };
  }

  const ageDays = Math.floor((nowTimestamp - updatedTimestamp) / DAY_MS);
  if (ageDays < 0) {
    return { status: "unknown", updatedAt, ageDays, staleAfterDays };
  }

  return {
    status: ageDays > staleAfterDays ? "stale" : "current",
    updatedAt,
    ageDays,
    staleAfterDays,
  };
}

export function knowledgeBaseFooter(data) {
  const freshness = knowledgeBaseFreshness(data);
  return `KB ${data?._version || "?"} | updated ${data?._updatedAt || "unknown"} | freshness ${freshness.status} | source ${data?._source || "unknown"}`;
}

export function packageVersion(packageJson) {
  if (!packageJson || typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error("package.json version must be a non-empty string");
  }
  return packageJson.version;
}
