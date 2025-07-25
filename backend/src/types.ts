export interface Job {
    id: string;
    status: "processing" | "ready" | "error";
    filePath?: string;
    storagePath?: string;
    publicUrl?: string;
    error?: string;
}
