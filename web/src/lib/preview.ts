// Choosing which Unity build to show, and where it should load the run from.

export type Template = "runner-mobile" | "runner-desktop";

/** The mobile build (ASTC textures) for a touch screen, the desktop build (DXT) otherwise. */
export function pickTemplate(coarsePointer: boolean): Template {
  return coarsePointer ? "runner-mobile" : "runner-desktop";
}

/** The template page, told to load the run's settings from this same site (so every request is same-origin). */
export function previewUrl(runId: string, template: Template): string {
  return `/templates/${template}/index.html?settings=/api/runs/${encodeURIComponent(runId)}/settings.json`;
}
