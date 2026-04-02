import { Router, type IRouter } from "express";
import healthRouter from "./health";
import leadsRouter from "./leads";
import documentsRouter from "./documents";
import recommendationRouter from "./recommendation";
import contentRouter from "./content";
import generationRouter from "./generation";
import dashboardRouter from "./dashboard";
import gdocsRouter from "./gdocs";

const router: IRouter = Router();

router.use(healthRouter);
router.use(leadsRouter);
router.use(documentsRouter);
router.use(recommendationRouter);
router.use(contentRouter);
router.use(generationRouter);
router.use(dashboardRouter);
router.use(gdocsRouter);

export default router;
