import { createHash } from "node:crypto";
import { CreateScheduleCommand, GetScheduleCommand, SchedulerClient } from "@aws-sdk/client-scheduler";
import { requestDeadline } from "../requests/RequestDeadline.js";

/**
 * Registers timeout deliveries independently of immediate provisioning events.
 * EventBridge Scheduler assumes the configured role to publish the original
 * payload to the timeout bus at the deadline derived from original intake.
 * Repeated deliveries reuse a stable schedule name and verify conflicts.
 * Successful creation confirms registration, not eventual event delivery.
 */
export class SchedulerService {
  /** Shared transport reused across warm Lambda invocations. */
  private static readonly client = new SchedulerClient({});

  /**
   * Schedules a timeout for a provisioning request using its tracked request.
   * The target bus, execution role, and schedule group must be configured by
   * the deployment before callers accept webhook traffic. UTC timestamps have
   * second precision, although Scheduler delivery has minute-level precision.
   * Completed schedules delete themselves so one-time jobs do not accumulate.
   * Failures propagate to intake, which cannot roll back an accepted event.
   *
   * @param detail Tracked request also stored and published for provisioning.
   * @throws Missing configuration, serialization, or Scheduler service errors.
   */
  static async scheduleTimeout(detail: Record<string, unknown>): Promise<void> {
    const busArn = process.env.TIMEOUT_EVENT_BUS_ARN;
    const roleArn = process.env.TIMEOUT_SCHEDULER_ROLE_ARN;
    const groupName = process.env.TIMEOUT_SCHEDULE_GROUP;
    if (!busArn?.trim() || !roleArn?.trim() || !groupName?.trim())
      throw new Error("Timeout scheduler configuration is required");

    if (typeof detail.deliveryId !== "string" || !detail.deliveryId.trim() || typeof detail.receivedAt !== "string")
      throw new Error("Tracked request identity and timestamp are required");
    const timeoutAt = requestDeadline(detail.receivedAt);
    if (Date.parse(timeoutAt) <= Date.now()) return;
    const token = createHash("sha256").update(detail.deliveryId).digest("hex");
    const name = `timeout-${token.slice(0, 48)}`;
    const scheduledAt = timeoutAt.slice(0, 19);
    const command = new CreateScheduleCommand({
      Name: name, GroupName: groupName, ClientToken: token,
      ScheduleExpression: `at(${scheduledAt})`, ScheduleExpressionTimezone: "UTC",
      FlexibleTimeWindow: { Mode: "OFF" }, ActionAfterCompletion: "DELETE",
      Target: {
        Arn: busArn, RoleArn: roleArn, Input: JSON.stringify(detail),
        EventBridgeParameters: { Source: "agentic.setup", DetailType: "TimeoutRequested" },
      },
    });
    try {
      await this.client.send(command);
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "ConflictException") throw error;
      const saved = await this.client.send(new GetScheduleCommand({ Name: name, GroupName: groupName }));
      if (saved.State !== "ENABLED" || saved.ScheduleExpression !== command.input.ScheduleExpression
        || saved.ScheduleExpressionTimezone !== "UTC" || saved.ActionAfterCompletion !== "DELETE"
        || saved.FlexibleTimeWindow?.Mode !== "OFF" || saved.Target?.Arn !== busArn
        || saved.Target?.RoleArn !== roleArn || saved.Target?.Input !== command.input.Target?.Input
        || saved.Target?.EventBridgeParameters?.Source !== "agentic.setup"
        || saved.Target?.EventBridgeParameters?.DetailType !== "TimeoutRequested")
        throw new Error("Existing timeout schedule does not match the tracked request");
    }
  }
}
