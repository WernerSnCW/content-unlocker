// C7. determineNextAction
import type {
  ActionType,
  CallType,
  ContentRecommendation,
  GateResult,
  Investor,
  NextAction,
  Owner,
  SignalMap,
} from "../types";

export function determineNextAction(
  callType: CallType,
  signals: SignalMap,
  investor: Investor,
  content: ContentRecommendation | null,
  gateResult: GateResult,
): NextAction {
  if (callType === "cold_call") {
    // Cold call — defer to disposition/outcome derived elsewhere.
    // Default: if content is available and gates allow, send follow-up; else nurture.
    if (content) {
      return {
        actionType: "send_content" as ActionType,
        detail: `Send ${content.docName}`,
        owner: "agent" as Owner,
        timing: "24_48_hours",
        contentToSend: content,
      };
    }
    return {
      actionType: "move_to_nurture",
      detail: "No content matched — nurture track",
      owner: "system",
      timing: "scheduled",
      contentToSend: null,
    };
  }

  if (callType === "demo") {
    if (gateResult.pack1 === "eligible") {
      return {
        actionType: "send_content",
        detail: "Pack 1 + schedule Call 3",
        owner: "tom",
        timing: "24_48_hours",
        contentToSend: content,
      };
    }
    if (content) {
      return {
        actionType: "send_content",
        detail: content.docName,
        owner: "tom",
        timing: "24_48_hours",
        contentToSend: content,
      };
    }
    if ((investor.demoScore ?? 0) < 50) {
      return {
        actionType: "escalate_to_tom",
        detail: "Low demo score — review before next action",
        owner: "tom",
        timing: "immediate",
        contentToSend: null,
      };
    }
    return {
      actionType: "move_to_nurture",
      detail: "Demo completed — no gated content yet",
      owner: "system",
      timing: "scheduled",
      contentToSend: null,
    };
  }

  // opportunity
  const allSGreen = ["S2", "S3", "S4", "S5", "S6"].every((c) => signals[c]?.state === "green");
  if (allSGreen) {
    return {
      actionType: "reserve_stock",
      detail: "Committed — reserve + send Pack 1/Pack 2 + initiate SeedLegals",
      owner: "tom",
      timing: "immediate",
      contentToSend: null,
    };
  }
  if (signals.S5?.state === "amber") {
    return {
      actionType: "schedule_adviser_call",
      detail: "Adviser loop — send Pack 2 + schedule three-way",
      owner: "tom",
      timing: "24_48_hours",
      contentToSend: null,
    };
  }
  if (signals.S2?.state === "red") {
    return {
      actionType: "close_deal",
      detail: "No to investing — close as lost, check Book 2 eligibility",
      owner: "system",
      timing: "immediate",
      contentToSend: null,
    };
  }
  return {
    actionType: "schedule_call",
    detail: "Needs time — set specific follow-up date, send remaining content",
    owner: "tom",
    timing: "scheduled",
    contentToSend: content,
  };
}
