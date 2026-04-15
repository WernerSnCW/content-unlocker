// C14. determinePostCloseActions (V3)
// Maps a Call 3 outcome to the ordered action list from POST_CLOSE_WORKFLOW
// (for committed) or ADVISER_LOOP_WORKFLOW (for adviser_loop). needs_time and
// no get short inline lists.
import { POST_CLOSE_WORKFLOW, ADVISER_LOOP_WORKFLOW } from "../config";
import type { AdviserLoopAction, Investor, Owner, PostCloseAction } from "../types";

export interface PostCloseResult {
  postCloseActions: PostCloseAction[] | null;
  adviserLoopActions: AdviserLoopAction[] | null;
}

export function determinePostCloseActions(
  outcome: string | null,
  investor: Investor,
): PostCloseResult {
  if (outcome === "committed") {
    const actions: PostCloseAction[] = [];
    for (const stage of POST_CLOSE_WORKFLOW.stages) {
      if (stage.stage >= 6 && stage.stage <= 8) {
        for (const a of stage.actions ?? []) {
          actions.push({
            action: a.action,
            owner: a.owner as Owner,
            timing: a.timing,
            detail: a.detail,
          });
        }
      }
    }
    // Include the first recurring action from stage 9 as a reminder
    const stage9 = POST_CLOSE_WORKFLOW.stages.find((s) => s.stage === 9);
    if (stage9?.recurringActions?.[0]) {
      const q = stage9.recurringActions[0];
      actions.push({
        action: q.action,
        owner: q.owner as Owner,
        timing: q.timing,
        detail: q.detail,
      });
    }
    return { postCloseActions: actions, adviserLoopActions: null };
  }

  if (outcome === "adviser_loop") {
    const adviserActions: AdviserLoopAction[] = [
      {
        phase: "pre_call",
        actions: ADVISER_LOOP_WORKFLOW.preCall.actions.map((a) => ({
          action: a.action,
          owner: a.owner as Owner,
          timing: a.timing,
          detail: a.detail,
        })),
      },
      {
        phase: "during_call",
        actions: [
          { action: ADVISER_LOOP_WORKFLOW.duringCall.tomRole, owner: "tom", timing: "during_call" },
          { action: ADVISER_LOOP_WORKFLOW.duringCall.openingFrame, owner: "tom", timing: "during_call", detail: "Opening frame" },
        ],
      },
      {
        phase: "post_call",
        actions: ADVISER_LOOP_WORKFLOW.postCall.actions.map((a) => ({
          action: a.action,
          owner: (a.owner ?? "tom") as Owner,
          timing: a.timing ?? "ongoing",
          detail: a.detail ?? a.nextStep,
        })),
      },
    ];
    return { postCloseActions: null, adviserLoopActions: adviserActions };
  }

  if (outcome === "needs_time") {
    return {
      postCloseActions: [
        { action: "set_specific_followup_date", owner: "tom", timing: "immediate" },
        { action: "send_remaining_content", owner: "tom", timing: "24_48_hours" },
        { action: "note_unresolved_belief", owner: "tom", timing: "immediate" },
      ],
      adviserLoopActions: null,
    };
  }

  if (outcome === "no") {
    const actions: PostCloseAction[] = [
      { action: "close_as_lost", owner: "system", timing: "immediate" },
      { action: "log_reason", owner: "tom", timing: "immediate" },
    ];
    // If there's platform interest, flag Book 2 eligibility
    const platformInterest = investor.factFind?.exactPhrases?.some((p) =>
      /platform|tool|system|access|interface/i.test(p)
    );
    if (platformInterest) {
      actions.push({ action: "tag_book2_eligible", owner: "system", timing: "immediate", detail: "Platform interest without investment commitment" });
    }
    return { postCloseActions: actions, adviserLoopActions: null };
  }

  return { postCloseActions: null, adviserLoopActions: null };
}
