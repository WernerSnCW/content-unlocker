import { db, channelsTable, acuTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { validateChannelCompliance, type ChannelViolation } from "./channelConstraints";

interface SequenceNode {
  node_id: string;
  day: number;
  channel: string;
  content_id: string;
  next_nodes: { condition: string; node_id: string; day: number }[];
}

interface AssetRecord {
  id: string;
  node_id: string;
  channel: string;
  content: string | null;
  qc_status: string;
}

interface CampaignQCResult {
  overall_status: "PASSED" | "FAILED" | "PENDING";
  checks: CampaignQCCheck[];
  asset_results: AssetQCResult[];
  summary: {
    total_checks: number;
    passed: number;
    failed: number;
    warnings: number;
  };
}

interface CampaignQCCheck {
  check: string;
  status: "pass" | "fail" | "warning";
  message: string;
}

interface AssetQCResult {
  asset_id: string;
  node_id: string;
  channel: string;
  channel_violations: ChannelViolation[];
  status: "pass" | "fail" | "warning" | "pending";
}

export async function runCampaignQC(
  sequence: SequenceNode[],
  assets: AssetRecord[],
  complianceConstraints: string[],
  blockedContent: string[]
): Promise<CampaignQCResult> {
  const checks: CampaignQCCheck[] = [];
  const assetResults: AssetQCResult[] = [];

  const sequenceChecks = checkSequenceIntegrity(sequence, assets);
  checks.push(...sequenceChecks);

  for (const asset of assets) {
    if (!asset.content) {
      assetResults.push({
        asset_id: asset.id,
        node_id: asset.node_id,
        channel: asset.channel,
        channel_violations: [],
        status: "pending",
      });
      continue;
    }

    const [channelConfig] = await db
      .select()
      .from(channelsTable)
      .where(eq(channelsTable.id, asset.channel));

    let violations: ChannelViolation[] = [];
    if (channelConfig) {
      violations = validateChannelCompliance(asset.content, channelConfig);
    }

    const prohibitedACUs = await db
      .select()
      .from(acuTable)
      .where(eq(acuTable.type, "prohibited"));

    for (const acu of prohibitedACUs) {
      if (
        asset.content.toLowerCase().includes(acu.content.toLowerCase()) ||
        (acu.id === "acu_22p_prohibited" && /\b22p\b/i.test(asset.content)) ||
        (acu.id === "acu_78x_prohibited" && /7\.8x/i.test(asset.content))
      ) {
        violations.push({
          check: "ACU_PROHIBITED",
          message: `Content contains prohibited ACU: ${acu.id}`,
          severity: "fail",
        });
      }
    }

    for (const blockedId of blockedContent) {
      const [blockedACU] = await db
        .select()
        .from(acuTable)
        .where(eq(acuTable.id, blockedId));
      if (
        blockedACU &&
        asset.content.toLowerCase().includes(blockedACU.content.toLowerCase())
      ) {
        violations.push({
          check: "BLOCKED_CONTENT",
          message: `Content contains campaign-blocked ACU: ${blockedId}`,
          severity: "fail",
        });
      }
    }

    const hasFails = violations.some((v) => v.severity === "fail");
    assetResults.push({
      asset_id: asset.id,
      node_id: asset.node_id,
      channel: asset.channel,
      channel_violations: violations,
      status: hasFails ? "fail" : violations.length > 0 ? "warning" : "pass",
    });
  }

  const totalChecks =
    checks.length + assetResults.filter((a) => a.status !== "pending").length;
  const passed =
    checks.filter((c) => c.status === "pass").length +
    assetResults.filter((a) => a.status === "pass").length;
  const failed =
    checks.filter((c) => c.status === "fail").length +
    assetResults.filter((a) => a.status === "fail").length;
  const warnings =
    checks.filter((c) => c.status === "warning").length +
    assetResults.filter((a) => a.status === "warning").length;
  const pending = assetResults.filter((a) => a.status === "pending").length;

  const overallStatus: CampaignQCResult["overall_status"] =
    failed > 0 ? "FAILED" : pending > 0 ? "PENDING" : "PASSED";

  return {
    overall_status: overallStatus,
    checks,
    asset_results: assetResults,
    summary: {
      total_checks: totalChecks,
      passed,
      failed,
      warnings,
    },
  };
}

function checkSequenceIntegrity(
  sequence: SequenceNode[],
  assets: AssetRecord[]
): CampaignQCCheck[] {
  const checks: CampaignQCCheck[] = [];
  const nodeIds = new Set(sequence.map((n) => n.node_id));
  const assetNodeIds = new Set(assets.map((a) => a.node_id));

  for (const node of sequence) {
    if (!assetNodeIds.has(node.node_id)) {
      checks.push({
        check: "SEQUENCE_INTEGRITY",
        status: "fail",
        message: `Sequence node ${node.node_id} has no corresponding asset`,
      });
    }
  }

  for (const node of sequence) {
    for (const next of node.next_nodes) {
      const targetExists = sequence.some(
        (n) =>
          n.node_id === next.node_id ||
          next.node_id.includes("followup") ||
          next.node_id.includes("resend") ||
          next.node_id.includes("advance")
      );
      if (!targetExists) {
        checks.push({
          check: "SEQUENCE_INTEGRITY",
          status: "warning",
          message: `Branch from ${node.node_id} references ${next.node_id} which may need a content asset`,
        });
      }
    }
  }

  const terminalNodes = sequence.filter((n) => n.next_nodes.length === 0);
  if (terminalNodes.length === 0 && sequence.length > 0) {
    checks.push({
      check: "SEQUENCE_INTEGRITY",
      status: "warning",
      message: "No terminal nodes found — sequence may loop indefinitely",
    });
  }

  if (checks.filter((c) => c.status === "fail").length === 0) {
    checks.push({
      check: "SEQUENCE_INTEGRITY",
      status: "pass",
      message: `Sequence integrity verified: ${sequence.length} nodes, ${terminalNodes.length} terminal`,
    });
  }

  const channelCoverage = new Set(sequence.map((n) => n.channel));
  checks.push({
    check: "CHANNEL_COVERAGE",
    status: "pass",
    message: `Campaign covers ${channelCoverage.size} channels: ${[...channelCoverage].join(", ")}`,
  });

  return checks;
}
