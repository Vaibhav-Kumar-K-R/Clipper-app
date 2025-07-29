import { Router } from "express";
import { clipVideo } from "../controllers/clip.controller";

const router = Router();

router.post("/", (req, res) => {
    clipVideo(req, res);
});

export default router;
