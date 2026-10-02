// Matching the files a person chose to the names their settings file asks for, and checking their size, before
// anything is sent, so a run is never created for an upload that cannot finish.

export type UploadPlan = { ok: true; uploads: { name: string; file: File }[] } | { ok: false; error: string };

export function planUploads(needed: string[], chosen: File[], maxBytes = Infinity): UploadPlan {
  const uploads: { name: string; file: File }[] = [];
  const missing: string[] = [];
  for (const name of needed) {
    const file = chosen.find((candidate) => candidate.name === name);
    if (file) uploads.push({ name, file });
    else missing.push(name);
  }
  if (missing.length > 0) return { ok: false, error: `Choose ${missing.join(", ")}` };

  const tooBig = uploads.find((upload) => upload.file.size > maxBytes);
  if (tooBig) return { ok: false, error: `${tooBig.name}: larger than ${Math.round(maxBytes / (1024 * 1024))} MB` };
  return { ok: true, uploads };
}
