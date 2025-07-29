import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { spawn } from "child_process";
import { Request, Response } from "express";
import { createJobId, adjustSubtitleTimestamps } from "../utils";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const uploadsDir = path.join(__dirname, "../../uploads");
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

const jobsDir = path.join(__dirname, "../../jobs");
if (!fs.existsSync(jobsDir)) {
    fs.mkdirSync(jobsDir);
}

const bucketName = process.env.SUPABASE_BUCKET || "videos";
const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseKey = process.env.SUPABASE_KEY as string;
const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
});

async function clipVideo(req: Request, res: Response) {
    const { url, startTime, endTime, subtitles, formatId, userId } =
        req.body || {};

    if (!url || !startTime || !endTime || !userId) {
        return res
            .status(400)
            .json({ error: "url, startTime, endTime and userId are required" });
    }

    const id = createJobId();
    const outputPath = path.join(uploadsDir, `clip-${id}.mp4`);

    const initialJobData = {
        id,
        user_id: userId,
        status: "processing",
    };

    const response = await supabase.from("jobs").insert([initialJobData]);
    console.log(response.error);

    if (response.error) {
        console.error(
            `[job ${id}] failed to create job in database`,
            response.error,
        );
        return res.status(500).json({ error: "Failed to create job" });
    }

    console.log(`[job ${id}] created and saved to database.`);

    (async () => {
        let finalJobStatus: { [key: string]: any } = {};
        let tempCookiesPath: string | null = null;
        try {
            const section = `*${startTime}-${endTime}`;

            const prodCookiesPath = "../../cookies.txt";
            if (fs.existsSync(prodCookiesPath)) {
                const cookiesContent = fs.readFileSync(
                    prodCookiesPath,
                    "utf-8",
                );
                tempCookiesPath = path.join(uploadsDir, `cookies-${id}.txt`);
                fs.writeFileSync(tempCookiesPath, cookiesContent);
            }

            const ytArgs = [url];
            if (formatId) {
                ytArgs.push("-f", formatId);
            } else {
                ytArgs.push(
                    "-f",
                    "bv[ext=mp4][vcodec^=avc1][height<=?1080][fps<=?60]+ba[ext=m4a]/best[ext=mp4][vcodec^=avc1][height<=?1080]",
                );
            }
            ytArgs.push(
                "--download-sections",
                section,
                "-o",
                outputPath,
                "--merge-output-format",
                "mp4",
                "--no-check-certificates",
                "--no-warnings",
                "--add-header",
                "referer:youtube.com",
                "--add-header",
                "user-agent:Mozilla/5.0",
                "--verbose",
            );
            if (subtitles) {
                ytArgs.push(
                    "--write-subs",
                    "--write-auto-subs",
                    "--sub-lang",
                    "en",
                    "--sub-format",
                    "vtt",
                );
            }
            if (tempCookiesPath) {
                ytArgs.push("--cookies", tempCookiesPath);
            } else {
                const localCookiesPath = path.join(__dirname, "cookies.txt");
                if (fs.existsSync(localCookiesPath)) {
                    ytArgs.push("--cookies", localCookiesPath);
                }
            }

            console.log(`[job ${id}] starting yt-dlp`);
            const yt = spawn(
                path.resolve(__dirname, "../../bin/yt-dlp.exe"),
                ytArgs,
            );
            yt.stderr.on("data", (d) =>
                console.error(`[job ${id}]`, d.toString()),
            );

            await new Promise<void>((resolve, reject) => {
                yt.on("close", (code, signal) => {
                    if (code === 0) {
                        resolve();
                    } else if (code === null) {
                        reject(
                            new Error(
                                `yt-dlp process was killed by signal: ${signal || "unknown"}`,
                            ),
                        );
                    } else {
                        reject(new Error(`yt-dlp exited with code ${code}`));
                    }
                });
                yt.on("error", reject);
            });

            const fastPath = path.join(uploadsDir, `clip-${id}-fast.mp4`);
            const subPath = outputPath.replace(/\.mp4$/, ".en.vtt");
            const subtitlesExist = fs.existsSync(subPath);

            // Adjust subtitle timestamps if subtitles exist
            if (subtitles && subtitlesExist) {
                const adjustedSubPath = path.join(
                    uploadsDir,
                    `clip-${id}-adjusted.vtt`,
                );
                await adjustSubtitleTimestamps(
                    subPath,
                    adjustedSubPath,
                    startTime,
                );
                // Replace the original subtitle file with the adjusted one
                await fs.promises.rename(adjustedSubPath, subPath);
            }

            await new Promise<void>((resolve, reject) => {
                const ffmpegArgs = ["-y", "-i", outputPath];

                if (subtitles && subtitlesExist) {
                    console.log(
                        `[job ${id}] burning subtitles from ${subPath}`,
                    );
                    ffmpegArgs.push(
                        "-vf",
                        `subtitles=${subPath}`,
                        "-c:v",
                        "libx264",
                        "-c:a",
                        "aac",
                        "-b:a",
                        "128k",
                        "-preset",
                        "ultrafast", // Faster encoding, less CPU
                        "-crf",
                        "28", // Lower quality but much smaller file
                        "-maxrate",
                        "2M", // Limit bitrate
                        "-bufsize",
                        "4M", // Limit buffer size
                    );
                } else {
                    // No subtitles to burn – copy video but transcode audio to AAC to ensure MP4 compatibility
                    ffmpegArgs.push(
                        "-c:v",
                        "copy", // keep original video
                        "-c:a",
                        "aac",
                        "-b:a",
                        "128k",
                    );
                }

                // Move the `faststart` flag and output path outside the conditional so it applies to both modes
                ffmpegArgs.push("-movflags", "+faststart", fastPath);

                console.log(`[job ${id}] running ffmpeg`, ffmpegArgs.join(" "));
                const ff = spawn("ffmpeg", ffmpegArgs);

                // Add timeout for ffmpeg process
                const ffmpegTimeout = setTimeout(() => {
                    console.log(
                        `[job ${id}] ffmpeg timeout reached, killing process`,
                    );
                    ff.kill("SIGKILL");
                }, 300000); // 5 minutes timeout

                ff.stderr.on("data", (d) =>
                    console.error(`[job ${id}] ffmpeg`, d.toString()),
                );
                ff.on("close", (code, signal) => {
                    clearTimeout(ffmpegTimeout);
                    if (code === 0) {
                        resolve();
                    } else if (code === null) {
                        reject(
                            new Error(
                                `ffmpeg process was killed by signal: ${signal || "unknown"} - likely due to memory limits on Render`,
                            ),
                        );
                    } else {
                        reject(new Error(`ffmpeg exited with code ${code}`));
                    }
                });
                ff.on("error", reject);
            });

            await fs.promises.unlink(outputPath).catch(() => {});
            await fs.promises.rename(fastPath, outputPath);

            if (subtitlesExist) {
                await fs.promises.unlink(subPath).catch(() => {});
            }

            // ---- Upload processed clip to Supabase ----
            const objectPath = `clip-${id}.mp4`;
            console.log(`[job ${id}] uploading to Supabase: ${objectPath}`);
            const fileBuffer = await fs.promises.readFile(outputPath);
            const { error: uploadError } = await supabase.storage
                .from(bucketName)
                .upload(objectPath, fileBuffer, {
                    contentType: "video/mp4",
                    upsert: true,
                });
            if (uploadError) throw uploadError;

            console.log(`[job ${id}] upload successful, getting public URL`);
            const { data: pub } = supabase.storage
                .from(bucketName)
                .getPublicUrl(objectPath);

            // Remove local file after upload
            await fs.promises.unlink(outputPath).catch(() => {});

            finalJobStatus = {
                storage_path: objectPath,
                public_url: pub.publicUrl,
                status: "ready",
            };

            console.log(
                `[job ${id}] ready - storagePath: ${finalJobStatus.storage_path}, publicUrl: ${finalJobStatus.public_url}`,
            );
        } catch (err: unknown) {
            console.error(`[job ${id}] failed`, err);
            const message = err instanceof Error ? err.message : String(err);
            finalJobStatus = {
                status: "error",
                error: message,
            };
        } finally {
            if (tempCookiesPath && fs.existsSync(tempCookiesPath)) {
                fs.unlinkSync(tempCookiesPath);
            }
            const { error: updateError } = await supabase
                .from("jobs")
                .update(finalJobStatus)
                .eq("id", id);

            if (updateError) {
                console.error(
                    `[job ${id}] failed to update final job status in database`,
                    updateError,
                );
            }
        }
    })();

    return res.status(202).json({ id });
}

export { clipVideo };
