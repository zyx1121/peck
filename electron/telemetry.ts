import { randomBytes } from "node:crypto"
export function telemetry(
  name: string,
  attributes: Record<string, string | number | boolean> = {}
) {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  if (!endpoint) return
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  for (const field of (process.env.OTEL_EXPORTER_OTLP_HEADERS ?? "").split(
    ","
  )) {
    const i = field.indexOf("=")
    if (i > 0) headers[field.slice(0, i).trim()] = field.slice(i + 1).trim()
  }
  const now = BigInt(Date.now()) * 1000000n
  const span = {
    traceId: randomBytes(16).toString("hex"),
    spanId: randomBytes(8).toString("hex"),
    name,
    kind: 1,
    startTimeUnixNano: now.toString(),
    endTimeUnixNano: (now + 1000000n).toString(),
    attributes: Object.entries(attributes).map(([key, value]) => ({
      key,
      value: { stringValue: String(value) },
    })),
  }
  void fetch(`${endpoint.replace(/\/$/, "")}/v1/traces`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(3000),
    body: JSON.stringify({
      resourceSpans: [
        {
          resource: {
            attributes: [
              {
                key: "service.name",
                value: { stringValue: process.env.OTEL_SERVICE_NAME ?? "peck" },
              },
            ],
          },
          scopeSpans: [{ scope: { name: "peck" }, spans: [span] }],
        },
      ],
    }),
  }).catch(() => {})
}
