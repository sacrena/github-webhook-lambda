import assert from "node:assert/strict";
import test from "node:test";

import { handler } from "../dist/index.js";

test("GET /ping returns a JSON pong response", async () => {
  const response = await handler({
    rawPath: "/ping",
    requestContext: { http: { method: "GET" } },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(response.body), { message: "pong" });
});
