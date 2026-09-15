interface FunctionUrlRequest {
  rawPath?: string;
  requestContext?: { http?: { method?: string } };
}

const respond = (statusCode: number, payload: object) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});

export async function handler(event: FunctionUrlRequest) {
  const method = event.requestContext?.http?.method;
  if (method === "GET" && event.rawPath === "/ping") {
    return respond(200, { message: "pong" });
  }

  return respond(404, { message: "Not found" });
}
