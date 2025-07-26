import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import clipRouter from "./routes/clip.route";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseKey = process.env.SUPABASE_KEY as string;
const bucketName = process.env.SUPABASE_BUCKET || "videos";
if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase credentials are needed");
}
const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
});

const app = express();
const port = process.env.PORT || 3001;

const allowedOrigin =
    process.env.NODE_ENV === "production"
        ? "https://ytclipper.com"
        : "http://localhost:3000";

const corsOptions: cors.CorsOptions = {
    origin: allowedOrigin,
    credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({extended:true}))

const uploadsDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

const jobsDir = path.join(__dirname, "../jobs");
if (!fs.existsSync(jobsDir)) {
    fs.mkdirSync(jobsDir);
}


app.use("/api/clip", clipRouter);



app.get("/", (req, res) => res.send("Server is running!"));

app.get("/api/ping", (_req, res) => {
    return res.json({ success: true });
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});


