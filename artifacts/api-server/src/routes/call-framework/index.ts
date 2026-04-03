import { Router, type IRouter } from "express";
import { CALL_FRAMEWORK_QUESTIONS } from "../../../../../lib/call-questions";

const router: IRouter = Router();

router.get("/call-framework/questions", async (_req, res): Promise<void> => {
  res.json({
    questions: CALL_FRAMEWORK_QUESTIONS,
    total: CALL_FRAMEWORK_QUESTIONS.length,
    version: "1.0",
  });
});

export default router;
