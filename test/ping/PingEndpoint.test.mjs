import assert from "node:assert/strict";
import test from "node:test";

import { handlePing } from "../../dist/ping/PingEndpoint.js";

test("handlePing returns the health-check response", () => {
  const response = handlePing();

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(response.body), { message: "pong" });
});
