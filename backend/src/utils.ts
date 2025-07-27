import fs from "fs";

function createJobId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function timeToSeconds(timeStr: string): number {
    const parts = timeStr.split(":");
    return (
        parseInt(parts[0]) * 3600 +
        parseInt(parts[1]) * 60 +
        parseFloat(parts[2])
    );
}

function secondsToTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toFixed(3).padStart(6, "0")}`;
}

async function adjustSubtitleTimestamps(
    inputPath: string,
    outputPath: string,
    startTime: string,
): Promise<void> {
    const startSeconds = timeToSeconds(startTime);
    const content = await fs.promises.readFile(inputPath, "utf-8");

    const timestampRegex =
        /(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})/g;

    const adjustedContent = content.replace(
        timestampRegex,
        (match, start, end) => {
            const startSec = timeToSeconds(start) - startSeconds;
            const endSec = timeToSeconds(end) - startSeconds;

            if (startSec < 0) return match;

            return `${secondsToTime(startSec)} --> ${secondsToTime(endSec)}`;
        },
    );
    await fs.promises.writeFile(outputPath, adjustedContent, "utf-8");
}
export { createJobId, timeToSeconds, secondsToTime, adjustSubtitleTimestamps };
