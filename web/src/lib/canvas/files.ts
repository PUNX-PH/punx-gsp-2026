// Whether an uploaded file is the kind a step takes. The server stores any PNG, JPEG or GLB; a picture chosen on a 3D
// Model step would be refused when the graph is saved, and then no later edit could be saved either. So it is caught here,
// before the choice reaches the graph.
const WANTS: Record<string, { kind: "image" | "model"; says: string }> = {
  "reference-image": { kind: "image", says: "a picture (a PNG or JPEG)" },
  model: { kind: "model", says: "a 3D model (a GLB file)" },
};
const NAMES = { image: "a picture", model: "a 3D model" } as const;

/** Why this file cannot be chosen for this kind of step, or null when it can (or the step takes no file). */
export function fileProblem(nodeType: string, kind: "image" | "model"): string | null {
  if (!Object.hasOwn(WANTS, nodeType)) return null;
  const wanted = WANTS[nodeType];
  return wanted.kind === kind ? null : `This step needs ${wanted.says}, not ${NAMES[kind]}.`;
}
