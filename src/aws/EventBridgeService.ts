import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";

/**
 * Publishes application events to the dedicated provisioning event bus.
 * The bus and its delivery rule are managed by CloudFormation, while callers
 * choose the source, detail type, and payload for each event. This service
 * reports EventBridge acceptance without waiting for the API destination.
 * It does not create infrastructure or deduplicate repeated publications.
 */
export class EventBridgeService {
  /** Shared AWS transport reused across calls in this execution environment. */
  private static readonly client = new EventBridgeClient({});

  /**
   * Keeps event publication accessible through static operations only.
   * The shared client resolves credentials and region through standard AWS
   * configuration and lives for the lifetime of this loaded module.
   * Warm Lambda invocations reuse its transport, while publication chooses
   * and validates the destination bus separately for each operation.
   */
  private constructor() {}

  /**
   * Submits one event and returns the identifier assigned by EventBridge.
   * Callers provide a JSON-serializable detail object and AWS-compatible
   * source and detail type values. Entry failures can accompany a successful
   * HTTP response, so they are surfaced alongside transport errors here.
   * Acceptance does not confirm delivery or processing by the destination;
   * callers decide whether failures warrant another publication attempt.
   *
   * @param source Event source identifier used by bus rules, such as agentic.setup.
   * @param detailType Event category used by bus rules, such as ProvisionRequested.
   * @param detail JSON-serializable event payload sent as the entry's Detail string.
   * @param busName Destination bus name or ARN, defaulting to EVENT_BUS_NAME at call time; must be nonblank.
   * @returns The accepted event's EventBridge identifier.
   * @throws Missing bus configuration, serialization, transport, or event rejection errors.
   */
  static async putEvent(
    source: string, detailType: string,
    detail: Record<string, unknown>, busName = process.env.EVENT_BUS_NAME,
  ): Promise<string> {
    if (!busName?.trim()) throw new Error("EventBridge bus name is required");

    const result = await this.client.send(new PutEventsCommand({
      Entries: [{
        EventBusName: busName, Source: source,
        DetailType: detailType, Detail: JSON.stringify(detail),
      }],
    }));

    const entry = result.Entries?.[0];
    if (result.FailedEntryCount || entry?.ErrorCode || !entry?.EventId)
      throw new Error(`EventBridge publication failed: ${entry?.ErrorCode ?? "MissingEventId"}`);

    return entry.EventId;
  }
}
