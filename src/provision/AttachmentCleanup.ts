import {
  EC2Client, DescribeVolumesCommand, DeleteVolumeCommand,
  DescribeNetworkInterfacesCommand, DeleteNetworkInterfaceCommand,
} from "@aws-sdk/client-ec2";
import type { CleanupResult } from "./CleanupResult.js";
import { expiredResourceTags } from "./InstanceResources.js";
import { EC2_MANAGEMENT_TAG_FILTER, EC2_MANAGEMENT_TAG_VALUE } from "./ProvisioningConstants.js";

/**
 * Reconciles detached worker attachments independently of instance discovery.
 * Normal termination removes the launch-created disk and primary interface,
 * but detached leftovers must be discoverable through their own durable tags.
 * Every deletion rechecks expiry and attachment state; attached resources are
 * left for instance termination and a later pass rather than forcibly detached.
 */
export class AttachmentCleanup {
  /**
   * Removes expired managed volumes that EC2 reports as detached and available.
   * Paginated discovery is followed by an ID-specific read before each delete,
   * protecting volumes attached or retagged since the discovery observation.
   * Per-volume failures do not stop other candidates, while a failed page read
   * propagates so the caller can report incomplete discovery for this category.
   */
  static async volumes(client: EC2Client, result: CleanupResult): Promise<void> {
    let nextToken: string | undefined;
    const seen = new Set<string>();
    do {
      const page = await client.send(new DescribeVolumesCommand({
        Filters: [
          { Name: EC2_MANAGEMENT_TAG_FILTER, Values: [EC2_MANAGEMENT_TAG_VALUE] },
          { Name: "status", Values: ["available"] },
        ], NextToken: nextToken,
      }));
      for (const volume of page.Volumes ?? []) {
        const id = volume.VolumeId;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        try {
          const fresh = await client.send(new DescribeVolumesCommand({ VolumeIds: [id] }));
          const current = fresh.Volumes?.find((entry) => entry.VolumeId === id);
          const ownership = current && expiredResourceTags(current.Tags, Date.now());
          if (!current || current.State !== "available" || current.Attachments?.length || !ownership?.token?.trim()) {
            result.skipped.push(id);
            continue;
          }
          await client.send(new DeleteVolumeCommand({ VolumeId: id }));
          result.deletedVolumes.push(id);
        } catch (error) {
          if (error instanceof Error && error.name === "InvalidVolume.NotFound") result.deletedVolumes.push(id);
          else result.failed.push(id);
        }
      }
      nextToken = page.NextToken;
    } while (nextToken);
  }

  /**
   * Removes expired managed interfaces only after they become unattached.
   * Requester-managed interfaces and interfaces with address associations are
   * excluded because they are outside this release's launch-created resources.
   * Fresh state and ownership checks precede deletion, and an already absent
   * interface is treated as reconciled when concurrent cleanup removed it.
   */
  static async interfaces(client: EC2Client, result: CleanupResult): Promise<void> {
    let nextToken: string | undefined;
    const seen = new Set<string>();
    do {
      const page = await client.send(new DescribeNetworkInterfacesCommand({
        Filters: [
          { Name: EC2_MANAGEMENT_TAG_FILTER, Values: [EC2_MANAGEMENT_TAG_VALUE] },
          { Name: "status", Values: ["available"] },
        ], NextToken: nextToken,
      }));
      for (const networkInterface of page.NetworkInterfaces ?? []) {
        const id = networkInterface.NetworkInterfaceId;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        try {
          const fresh = await client.send(new DescribeNetworkInterfacesCommand({ NetworkInterfaceIds: [id] }));
          const current = fresh.NetworkInterfaces?.find((entry) => entry.NetworkInterfaceId === id);
          const ownership = current && expiredResourceTags(current.TagSet, Date.now());
          if (!current || current.Status !== "available" || current.Attachment || current.RequesterManaged
            || current.Association || !ownership?.token?.trim()) {
            result.skipped.push(id);
            continue;
          }
          await client.send(new DeleteNetworkInterfaceCommand({ NetworkInterfaceId: id }));
          result.deletedNetworkInterfaces.push(id);
        } catch (error) {
          if (error instanceof Error && error.name === "InvalidNetworkInterfaceID.NotFound") result.deletedNetworkInterfaces.push(id);
          else result.failed.push(id);
        }
      }
      nextToken = page.NextToken;
    } while (nextToken);
  }
}
