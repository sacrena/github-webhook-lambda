import assert from "node:assert/strict";
import test from "node:test";

import { handler } from "../dist/index.js";

test("routes unknown method and path combinations to not found", async () => {
  const response = await handler({
    rawPath: "/ping",
    requestContext: { http: { method: "POST" } },
  });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(JSON.parse(response.body), { message: "Not found" });
});
