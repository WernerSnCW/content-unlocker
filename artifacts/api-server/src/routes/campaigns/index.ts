import { Router, type IRouter } from "express";
import {
  db,
  campaignsTable,
  campaignAssetsTable,
  channelsTable,
  acuTable,
  changelogTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  buildSequenceFromBrief,
  buildAssetGenerationPrompt,
  buildACBuildInstructions,
  buildTagTable,
} from "../../lib/campaignGenerator";
import { runCampaignQC } from "../../lib/campaignQC";
import { getOutputTypeForChannel } from "../../lib/channelConstraints";

const router: IRouter = Router();

router.post("/campaigns", async (req, res): Promise<void> => {
  const {
    campaign_id,
    name,
    description,
    target_cluster,
    personas,
    entry_stage,
    target_stage,
    channels,
    duration_weeks,
    daily_volume,
    primary_belief,
    secondary_beliefs,
    primary_cta,
    secondary_cta,
    lead_magnet,
    compliance_constraints,
    blocked_content,
    prohibited_acus,
    notes,
  } = req.body;

  if (!name || !target_cluster || !entry_stage || !target_stage) {
    res.status(400).json({
      error:
        "name, target_cluster, entry_stage, and target_stage are required",
    });
    return;
  }

  const id = campaign_id || `cam_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "").slice(0, 40)}`;

  const [existing] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, id));
  if (existing) {
    res.status(409).json({ error: `Campaign ${id} already exists` });
    return;
  }

  const brief = {
    campaign_id: id,
    name,
    description,
    target_cluster,
    personas: personas || [],
    entry_stage,
    target_stage,
    channels: channels || ["email"],
    duration_weeks: duration_weeks || 8,
    daily_volume,
    primary_belief,
    secondary_beliefs: secondary_beliefs || [],
    primary_cta,
    secondary_cta,
    lead_magnet,
    compliance_constraints: compliance_constraints || [],
    blocked_content: blocked_content || [],
    prohibited_acus: prohibited_acus || [],
    notes,
  };

  const sequence = buildSequenceFromBrief(brief);

  const [campaign] = await db
    .insert(campaignsTable)
    .values({
      id,
      name,
      description: description || null,
      status: "DRAFT",
      target_cluster,
      personas: personas || [],
      entry_stage,
      target_stage,
      channels: channels || ["email"],
      duration_weeks: duration_weeks || 8,
      daily_volume: daily_volume || null,
      primary_belief: primary_belief || null,
      secondary_beliefs: secondary_beliefs || [],
      primary_cta: primary_cta || null,
      secondary_cta: secondary_cta || null,
      lead_magnet: lead_magnet || null,
      compliance_constraints: compliance_constraints || [],
      blocked_content: blocked_content || [],
      prohibited_acus: prohibited_acus || [],
      notes: notes || null,
      sequence: sequence,
      asset_count: sequence.length,
      created_at: new Date().toISOString(),
    })
    .returning();

  for (const node of sequence) {
    await db.insert(campaignAssetsTable).values({
      id: `${id}_asset_${node.node_id}`,
      campaign_id: id,
      node_id: node.node_id,
      channel: node.channel,
      output_type: node.output_type,
      title: node.title,
      day: node.day,
      sequence_position: sequence.indexOf(node),
      branch_condition: node.branch_condition || null,
      status: "PENDING",
      qc_status: "PENDING",
      metadata: { next_nodes: node.next_nodes },
    });
  }

  await db.insert(changelogTable).values({
    id: randomUUID(),
    action: "CAMPAIGN_CREATED",
    document_id: campaign_id,
    details: `Campaign created: ${name} (${sequence.length} touchpoints across ${new Set(sequence.map((n) => n.channel)).size} channels)`,
    triggered_by: "tom_king",
  });

  res.status(201).json({
    campaign,
    sequence,
    asset_count: sequence.length,
  });
});

router.get("/campaigns", async (_req, res): Promise<void> => {
  const campaigns = await db.select().from(campaignsTable);
  res.json(campaigns);
});

router.get("/campaigns/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, id));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  const assets = await db
    .select()
    .from(campaignAssetsTable)
    .where(eq(campaignAssetsTable.campaign_id, id));

  res.json({
    campaign,
    assets,
    channel_summary: summarizeChannels(assets),
  });
});

router.get("/campaigns/:id/assets", async (req, res): Promise<void> => {
  const { id } = req.params;
  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, id));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  const assets = await db
    .select()
    .from(campaignAssetsTable)
    .where(eq(campaignAssetsTable.campaign_id, id));

  res.json(assets);
});

router.post("/campaigns/:id/generate", async (req, res): Promise<void> => {
  const { id } = req.params;
  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, id));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  const assets = await db
    .select()
    .from(campaignAssetsTable)
    .where(eq(campaignAssetsTable.campaign_id, id));

  const pendingAssets = assets.filter((a) => a.status === "PENDING" || !a.content);
  if (pendingAssets.length === 0) {
    res.json({ message: "All assets already generated", generated: 0, total_pending: 0, generated_ids: [] });
    return;
  }

  const lockedACUs = await db
    .select()
    .from(acuTable)
    .where(eq(acuTable.status, "LOCKED"));

  const injectable = lockedACUs.filter((a) => a.type !== "prohibited");
  const prohibited = lockedACUs.filter((a) => a.type === "prohibited");
  const blockedIds = (campaign.blocked_content as string[]) || [];

  let acuSection = "## APPROVED CONTENT UNITS\n\n";
  acuSection += "### LOCKED CONTENT — inject verbatim, do not paraphrase:\n";
  for (const acu of injectable) {
    if (blockedIds.includes(acu.id)) continue;
    acuSection += `- [${acu.id}] (${acu.type}): ${acu.content}\n`;
  }
  acuSection += "\n### PROHIBITED CONTENT — must not appear in any form:\n";
  for (const acu of prohibited) {
    acuSection += `- [${acu.id}]: ${acu.content}\n`;
  }
  for (const blockedId of blockedIds) {
    const blockedACU = lockedACUs.find((a) => a.id === blockedId);
    if (blockedACU && blockedACU.type !== "prohibited") {
      acuSection += `- [${blockedACU.id}] (campaign-blocked): ${blockedACU.content}\n`;
    }
  }

  const brief = {
    campaign_id: campaign.id,
    name: campaign.name,
    target_cluster: campaign.target_cluster,
    personas: (campaign.personas as string[]) || [],
    entry_stage: campaign.entry_stage,
    target_stage: campaign.target_stage,
    channels: (campaign.channels as string[]) || [],
    duration_weeks: campaign.duration_weeks,
    daily_volume: campaign.daily_volume || undefined,
    primary_belief: campaign.primary_belief || undefined,
    secondary_beliefs: (campaign.secondary_beliefs as string[]) || [],
    primary_cta: campaign.primary_cta || undefined,
    secondary_cta: campaign.secondary_cta || undefined,
    compliance_constraints: (campaign.compliance_constraints as string[]) || [],
    blocked_content: blockedIds,
    notes: campaign.notes || undefined,
  };

  const sequence = (campaign.sequence as any[]) || [];
  const generated: string[] = [];

  for (const asset of pendingAssets) {
    const node = sequence.find((n: any) => n.node_id === asset.node_id);
    if (!node) continue;

    const [channelConfig] = await db
      .select()
      .from(channelsTable)
      .where(eq(channelsTable.id, asset.channel));

    try {
      const prompt = await buildAssetGenerationPrompt(
        node,
        brief,
        channelConfig,
        acuSection
      );

      const { claudeWithTimeout: claudeTimeout } = await import("../../lib/claudeTimeout");
      const { anthropic: anthropicClient } = await import("@workspace/integrations-anthropic-ai");

      const response = await claudeTimeout(anthropicClient, {
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      });

      const content =
        response.content[0].type === "text" ? response.content[0].text : "";

      const wordCount = content.split(/\s+/).filter(Boolean).length;

      await db
        .update(campaignAssetsTable)
        .set({
          content,
          word_count: wordCount,
          status: "GENERATED",
          qc_status: "PENDING",
        })
        .where(eq(campaignAssetsTable.id, asset.id));

      generated.push(asset.id);
    } catch (err: any) {
      await db
        .update(campaignAssetsTable)
        .set({
          status: "FAILED",
          metadata: { ...((asset.metadata as any) || {}), error: err.message },
        })
        .where(eq(campaignAssetsTable.id, asset.id));
    }
  }

  await db.insert(changelogTable).values({
    id: randomUUID(),
    action: "CAMPAIGN_ASSETS_GENERATED",
    document_id: id,
    details: `Generated ${generated.length}/${pendingAssets.length} campaign assets`,
    triggered_by: "system",
  });

  res.json({
    message: `Generated ${generated.length} of ${pendingAssets.length} pending assets`,
    generated: generated.length,
    total_pending: pendingAssets.length,
    generated_ids: generated,
  });
});

router.get("/campaigns/:id/qc", async (req, res): Promise<void> => {
  const { id } = req.params;
  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, id));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  const assets = await db
    .select()
    .from(campaignAssetsTable)
    .where(eq(campaignAssetsTable.campaign_id, id));

  const sequence = (campaign.sequence as any[]) || [];
  const complianceConstraints = (campaign.compliance_constraints as string[]) || [];
  const blockedContent = (campaign.blocked_content as string[]) || [];

  const qcResult = await runCampaignQC(
    sequence,
    assets as any,
    complianceConstraints,
    blockedContent
  );

  let passedCount = 0;
  for (const assetResult of qcResult.asset_results) {
    const newQCStatus =
      assetResult.status === "pass"
        ? "PASSED"
        : assetResult.status === "fail"
          ? "FAILED"
          : assetResult.status === "pending"
            ? "PENDING"
            : "WARNING";

    if (newQCStatus === "PASSED") passedCount++;

    await db
      .update(campaignAssetsTable)
      .set({
        qc_status: newQCStatus,
        qc_report: { violations: assetResult.channel_violations },
      })
      .where(eq(campaignAssetsTable.id, assetResult.asset_id));
  }

  await db
    .update(campaignsTable)
    .set({
      qc_status: qcResult.overall_status,
      qc_report: qcResult as any,
      assets_passed_qc: passedCount,
    })
    .where(eq(campaignsTable.id, id));

  res.json(qcResult);
});

router.patch("/campaigns/:id/activate", async (req, res): Promise<void> => {
  const { id } = req.params;
  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, id));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  if (campaign.qc_status !== "PASSED") {
    res.status(400).json({
      error: `Cannot activate: QC status is ${campaign.qc_status}. All assets must pass QC before activation.`,
      qc_status: campaign.qc_status,
    });
    return;
  }

  const [updated] = await db
    .update(campaignsTable)
    .set({
      status: "ACTIVE",
      activated_at: new Date().toISOString(),
    })
    .where(eq(campaignsTable.id, id))
    .returning();

  await db.insert(changelogTable).values({
    id: randomUUID(),
    action: "CAMPAIGN_ACTIVATED",
    document_id: id,
    details: `Campaign activated: ${campaign.name}`,
    triggered_by: "tom_king",
  });

  res.json(updated);
});

router.get("/campaigns/:id/sequence", async (req, res): Promise<void> => {
  const { id } = req.params;
  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, id));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  res.json({
    campaign_id: campaign.id,
    campaign_name: campaign.name,
    sequence: campaign.sequence,
    duration_weeks: campaign.duration_weeks,
    channels: campaign.channels,
  });
});

router.get("/campaigns/:id/ac-build", async (req, res): Promise<void> => {
  const { id } = req.params;
  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, id));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  const brief = {
    campaign_id: campaign.id,
    name: campaign.name,
    target_cluster: campaign.target_cluster,
    personas: (campaign.personas as string[]) || [],
    entry_stage: campaign.entry_stage,
    target_stage: campaign.target_stage,
    channels: (campaign.channels as string[]) || [],
    duration_weeks: campaign.duration_weeks,
    daily_volume: campaign.daily_volume || undefined,
    primary_belief: campaign.primary_belief || undefined,
    secondary_beliefs: (campaign.secondary_beliefs as string[]) || [],
    primary_cta: campaign.primary_cta || undefined,
    secondary_cta: campaign.secondary_cta || undefined,
    notes: campaign.notes || undefined,
  };

  const sequence = (campaign.sequence as any[]) || [];
  const instructions = buildACBuildInstructions(brief, sequence);

  res.json(instructions);
});

router.get("/campaigns/:id/tag-table", async (req, res): Promise<void> => {
  const { id } = req.params;
  const [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.id, id));
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }

  const brief = {
    campaign_id: campaign.id,
    name: campaign.name,
    target_cluster: campaign.target_cluster,
    personas: (campaign.personas as string[]) || [],
    entry_stage: campaign.entry_stage,
    target_stage: campaign.target_stage,
    channels: (campaign.channels as string[]) || [],
    duration_weeks: campaign.duration_weeks,
    notes: campaign.notes || undefined,
  };

  const sequence = (campaign.sequence as any[]) || [];
  const tagTableResult = buildTagTable(brief, sequence);

  res.json(tagTableResult);
});

router.get("/channels", async (_req, res): Promise<void> => {
  const channels = await db.select().from(channelsTable);
  res.json(channels);
});

router.get("/channels/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const [channel] = await db
    .select()
    .from(channelsTable)
    .where(eq(channelsTable.id, id));
  if (!channel) {
    res.status(404).json({ error: "Channel not found" });
    return;
  }
  res.json(channel);
});

function summarizeChannels(assets: any[]) {
  const summary: Record<string, { count: number; statuses: Record<string, number> }> = {};
  for (const asset of assets) {
    if (!summary[asset.channel]) {
      summary[asset.channel] = { count: 0, statuses: {} };
    }
    summary[asset.channel].count++;
    summary[asset.channel].statuses[asset.status] =
      (summary[asset.channel].statuses[asset.status] || 0) + 1;
  }
  return summary;
}

export default router;
