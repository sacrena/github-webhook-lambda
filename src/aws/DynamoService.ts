import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { TrackedRequest } from "../requests/TrackedRequest.js";

/**
 * Stores incoming requests so later processing can retrieve their context.
 * Each operation's table must have a string deliveryId partition key and no
 * sort key. Creation preserves the first record for a delivery; callers
 * decide how to handle duplicates and storage failures at their boundary.
 * This service does not authorize requests, create tables or schedule work.
 */
export class DynamoService {
  /** Shared document client reused across calls in this execution environment. */
  private static readonly client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });

  /**
   * Keeps request storage accessible through static operations only.
   * The shared client resolves credentials and region through standard AWS
   * configuration and omits undefined fields during marshalling. Its lifetime
   * follows the loaded module, allowing warm Lambda invocations to reuse
   * the transport while each operation selects its own destination table.
   */
  private constructor() {}

  /**
   * Saves the first request associated with a GitHub delivery ID.
   * A conditional write prevents subsequent deliveries from replacing its
   * original timestamp or event context. Callers supply a validated request
   * and handle duplicate delivery errors separately from other AWS failures.
   * The full item must fit within DynamoDB's 400 KB item size limit.
   *
   * @param tableName Destination table with a string deliveryId partition key and no sort key.
   * @param request Validated record to store, keyed by its GitHub deliveryId.
   * @returns A promise that resolves without a value after DynamoDB accepts the write.
   * @throws Marshalling or AWS errors, including ConditionalCheckFailedException for an existing delivery.
   */
  static async create(tableName: string, request: TrackedRequest): Promise<void> {
    await this.client.send(new PutCommand({
      TableName: tableName,
      Item: request,
      ConditionExpression: "attribute_not_exists(deliveryId)",
    }));
  }

  /**
   * Retrieves the original request for a known GitHub delivery ID.
   * A strongly consistent read lets callers look up a record immediately
   * after creating it or encountering a duplicate write. Missing records
   * return undefined; other AWS failures propagate to the caller.
   * Stored items are trusted to follow this service's request contract.
   *
   * @param tableName Source table with a string deliveryId partition key and no sort key.
   * @param deliveryId GitHub delivery ID identifying the stored request.
   * @returns The stored request without runtime validation, or undefined if no item exists.
   * @throws AWS SDK errors when the read cannot be completed.
   */
  static async get(tableName: string, deliveryId: string): Promise<TrackedRequest | undefined> {
    const result = await this.client.send(new GetCommand({
      TableName: tableName, Key: { deliveryId }, ConsistentRead: true,
    }));

    return result.Item as TrackedRequest | undefined;
  }
}
