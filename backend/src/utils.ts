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


export { createJobId, timeToSeconds, secondsToTime, adjustSubtitleTimestamps };
