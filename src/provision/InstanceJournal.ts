import { createHash } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { resolveInstanceLaunch } from "./InstanceConfiguration.js";
import type { InstanceLaunchJournal, InstanceLaunchOptions } from "./InstanceLaunch.js";
import type { ProvisionedResource } from "./ProvisionedResource.js";

/**
 * Retains one launch token and worker identity on an existing request.
 * The saved identity and token let repeated calls locate an EC2 launch
 * when its result has not yet been stored. Once saved, the worker identity
 * is available directly to creation and cleanup callers. This record tracks
 * allocation identity; it does not persist configuration or observed state.
 */
export class InstanceJournal {
  /** Document transport for the launch record nested on each request. */
  private static readonly database = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });

  /**
   * Loads launch intent before provisioning or managing a worker.
   * Consistent reads retrieve the latest saved token and worker identity
   * without relying on eventually consistent database observations.
   * Missing intent is returned explicitly so first-time creation can resolve
   * defaults; cleanup callers must not infer arbitrary resource identities.
   */
  static async get(deliveryId: string, tableName: string): Promise<InstanceLaunchJournal | undefined> {
    const result = await this.database.send(new GetCommand({
      TableName: tableName, Key: { deliveryId }, ConsistentRead: true,
    }));
    return result.Item?.resourceLaunch as InstanceLaunchJournal | undefined;
  }

  /**
   * Saves the single worker observed during launch or reconciliation.
   * Creation, recovery, and deletion use the same nested instance ID field.
   * Updating that field retains the delivery identity and token
   * used to identify the worker. The launch record must already exist;
   * storage failures are returned to the caller without triggering deletion.
   */
  static async record(
    deliveryId: string, tableName: string,
    resource: ProvisionedResource,
  ) {
    await this.database.send(new UpdateCommand({
      TableName: tableName, Key: { deliveryId },
      UpdateExpression: "SET resourceLaunch.instanceId = :instanceId",
      ConditionExpression: "attribute_exists(resourceLaunch)",
      ExpressionAttributeValues: { ":instanceId": resource.resourceId },
    }));
    return resource;
  }

  /**
   * Establishes the identity shared by every attempt at this launch.
   * Existing identity remains accessible after a deadline passes so callers
   * can recover the worker. A conditional write chooses one stable token;
   * retries must supply the same deadline and deployment configuration when
   * repeating EC2 calls before the instance ID has been saved.
   */
  static async reserve(options: InstanceLaunchOptions, tableName: string): Promise<InstanceLaunchJournal> {
    if (!options.deliveryId?.trim()) throw new Error("Delivery ID is required");
    const existing = await this.get(options.deliveryId, tableName);
    if (existing) return existing;

    const config = resolveInstanceLaunch(options);
    if (Date.parse(config.timeoutAt) <= Date.now()) throw new Error("Launch deadline has passed");
    const token = createHash("sha256")
      .update(config.deliveryId)
      .digest("hex");

    const journal: InstanceLaunchJournal = { deliveryId: config.deliveryId, token };
    try {
      await this.database.send(new UpdateCommand({
        TableName: tableName, Key: { deliveryId: config.deliveryId },
        UpdateExpression: "SET resourceLaunch = :launch",
        ConditionExpression: "attribute_exists(deliveryId) AND attribute_not_exists(resourceLaunch)",
        ExpressionAttributeValues: { ":launch": journal },
      }));
      return journal;
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "ConditionalCheckFailedException") throw error;
      const saved = await this.get(config.deliveryId, tableName);
      if (!saved) throw new Error("Tracked request not found");
      return saved;
    }
  }
}
