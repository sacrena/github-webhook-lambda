// @ts-check
const { AsyncLocalStorage } = require("node:async_hooks");

const context = new AsyncLocalStorage();
const levels = { debug: 10, info: 20, warn: 30, error: 40, silent: 50 };

/**
 * Writes a structured operational event for Lambda and deployment scripts.
 * Callers supply a stable event name and explicitly selected scalar metadata;
 * credentials, command arguments, and raw errors must stay outside it.
 * Lifecycle endpoints log delivery and resource identities rather than raw
 * event bodies, keeping command content outside operational metadata.
 * LOG_LEVEL is read at emission time and defaults to info for unknown values.
 * Lambda records use the matching console severity so CloudWatch labels agree
 * with the JSON level. Outside Lambda, stderr keeps command stdout separate.
 * Reserved envelope fields are assigned last to keep their meaning stable.
 *
 * @param {"debug" | "info" | "warn" | "error"} level Event severity.
 * @param {string} event Stable name describing the operation or outcome.
 * @param {Record<string, string | number | boolean | undefined>} fields Safe metadata.
 */
function log(level, event, fields = {}) {
  const configured = process.env.LOG_LEVEL?.toLowerCase() ?? "info";
  const threshold = Object.hasOwn(levels, configured)
    ? levels[/** @type {keyof typeof levels} */ (configured)] : levels.info;

  if (levels[level] < threshold) return;

  const output = process.env.AWS_LAMBDA_FUNCTION_NAME ? level : "error";

  console[output](JSON.stringify({
    ...context.getStore(), ...fields,
    timestamp: new Date().toISOString(), level, event,
  }));
}

/**
 * Attaches correlation fields to logs within one asynchronous operation.
 * The Lambda entry point uses this boundary so nested feature modules can
 * identify their request without passing transport data through every helper.
 * AsyncLocalStorage isolates concurrent invocations and restores the parent
 * context afterward, including when the callback throws or returns a promise.
 * Nested scopes inherit parent metadata and may override matching fields.
 *
 * @template T
 * @param {Record<string, string | number | boolean | undefined>} fields Safe context.
 * @param {() => T} operation Work to execute within the logging context.
 * @returns {T} The callback's unchanged result.
 */
function withLogContext(fields, operation) {
  return context.run({ ...context.getStore(), ...fields }, operation);
}

exports.log = log;
exports.withLogContext = withLogContext;
