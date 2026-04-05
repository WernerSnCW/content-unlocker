import { Router, type IRouter } from "express";
import healthRouter from "./health";
import leadsRouter from "./leads";
import documentsRouter from "./documents";
import recommendationRouter from "./recommendation";
import contentRouter from "./content";
import generationRouter from "./generation";
import dashboardRouter from "./dashboard";
import gdocsRouter from "./gdocs";
import callFrameworkRouter from "./call-framework";
import analyticsRouter from "./analytics";
import videosRouter from "./videos";
import acuRouter from "./acu";
import campaignsRouter from "./campaigns";
import templatesRouter from "./templates";
import promptsRouter from "./prompts";

const router: IRouter = Router();

router.use(healthRouter);
router.use(leadsRouter);
router.use(documentsRouter);
router.use(recommendationRouter);
router.use(contentRouter);
router.use(generationRouter);
router.use(dashboardRouter);
router.use(gdocsRouter);
router.use(callFrameworkRouter);
router.use(analyticsRouter);
router.use(videosRouter);
router.use(acuRouter);
router.use(campaignsRouter);
router.use(templatesRouter);
router.use(promptsRouter);

export default router;
