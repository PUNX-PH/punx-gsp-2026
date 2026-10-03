"use client";

// The settings of the selected step, in plain words: a file picker for the steps that take a file, three sliders for the
// Game Template (with a live line when the combination cannot be played), and a short explanation for the others.
import { useId } from "react";
import { cx } from "@/app/graphs/[id]/cx";
import styles from "@/app/graphs/[id]/editor.module.css";
import { Icon } from "@/app/graphs/[id]/icons";
import type { ResultView, StepData } from "@/lib/canvas/cardView";
import { TUNING_FIELDS, tuningProblem } from "@/lib/canvas/tuning";
import type { Assets, GraphNode, Tuning } from "@/lib/graph/types";

export interface SettingsPanelProps {
  node: GraphNode | null;
  data: StepData | null;
  assets: Assets;
  graphId: string;
  uploading: boolean;
  error: string | null;
  onChooseFile: (nodeId: string, file: File) => void;
  onTune: (nodeId: string, tuning: Tuning) => void;
}

const HEX = /^#[0-9a-f]{6}$/i;

function ChosenFile({ result }: { result: ResultView }) {
  if (result.kind === "image") {
    return (
      <div className={styles.result}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a small authenticated thumbnail from our own API */}
        <img className={styles.thumb} src={result.thumbUrl} alt="" />
        <span className={styles.fileInfo}>
          <span className={styles.fileName}>{result.name}</span>
        </span>
      </div>
    );
  }
  if (result.kind === "model") {
    return (
      <div className={styles.result}>
        <span className={styles.fileInfo}>
          <span className={styles.fileName}>{result.name}</span>
          <span className={styles.fileMeta}>{result.size}</span>
        </span>
      </div>
    );
  }
  return null;
}

function FilePicker(props: { what: string; accept: string; note: string; uploading: boolean; error: string | null; result: ResultView; onPick: (file: File) => void }) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.fieldLabel}>
        Choose a {props.what}
      </label>
      <input
        id={id}
        className={styles.fileInput}
        type="file"
        accept={props.accept}
        disabled={props.uploading}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) props.onPick(file);
          event.target.value = ""; // so the same file can be chosen again
        }}
      />
      <p className={styles.hint}>{props.note}</p>
      <ChosenFile result={props.result} />
      {props.uploading && <p role="status" className={styles.hint}>Uploading…</p>}
      {props.error && (
        <p role="alert" className={styles.errorText}>
          {props.error}
        </p>
      )}
    </div>
  );
}

const article = (label: string) => (/^[aeiou]/i.test(label) ? "an" : "a");

// What happens when an optional input has no wire.
function missingInputLine(port: { label: string; type: string }): string {
  if (port.type === "palette") return "Without a palette, a sample palette is used.";
  return `Without ${article(port.label)} ${port.label}, a built-in shape is used.`;
}

function TuningSliders({ node, data, onTune }: { node: GraphNode; data: StepData; onTune: SettingsPanelProps["onTune"] }) {
  const id = useId();
  const tuning = node.params.tuning as Tuning;
  const problem = tuningProblem(tuning);
  return (
    <>
      {TUNING_FIELDS.map((field) => (
        <div key={field.key} className={styles.field}>
          <label htmlFor={`${id}-${field.key}`} className={styles.fieldLabel}>
            {field.label}
          </label>
          <div className={styles.rangeRow}>
            <input
              id={`${id}-${field.key}`}
              type="range"
              min={field.min}
              max={field.max}
              step={field.step}
              value={tuning[field.key]}
              onChange={(event) => onTune(node.id, { ...tuning, [field.key]: Number(event.target.value) })}
            />
            <output className={styles.value}>
              {tuning[field.key]} {field.unit}
            </output>
          </div>
        </div>
      ))}
      {problem && (
        <p role="status" className={styles.live}>
          {problem}
        </p>
      )}
      <ul className={styles.notes}>
        {data.inputs
          .filter((port) => !port.required && !port.wired)
          .map((port) => (
            <li key={port.name}>{missingInputLine(port)}</li>
          ))}
      </ul>
    </>
  );
}

export function SettingsPanel({ node, data, uploading, error, onChooseFile, onTune }: SettingsPanelProps) {
  if (!node || !data) {
    return (
      <div className={styles.panel}>
        <p className={styles.hint}>Select a step to see its settings.</p>
      </div>
    );
  }

  const colors = data.result.kind === "palette" ? data.result.colors.filter((c) => HEX.test(c)) : [];

  return (
    <div className={styles.panel}>
      <header className={styles.panelHeader}>
        <span className={styles.icon}>
          <Icon type={node.type} />
        </span>
        <h2 className={styles.panelTitle}>{data.label}</h2>
      </header>
      <p className={styles.help}>{data.help}</p>

      {node.type === "reference-image" && (
        <FilePicker
          what="picture"
          accept=".png,.jpg,.jpeg,image/png,image/jpeg"
          note="PNG or JPEG, up to 4 MB."
          uploading={uploading}
          error={error}
          result={data.result}
          onPick={(file) => onChooseFile(node.id, file)}
        />
      )}
      {node.type === "model" && (
        <FilePicker
          what="model"
          accept=".glb,model/gltf-binary"
          note="A GLB file, up to 4 MB."
          uploading={uploading}
          error={error}
          result={data.result}
          onPick={(file) => onChooseFile(node.id, file)}
        />
      )}
      {node.type === "game-template" && <TuningSliders node={node} data={data} onTune={onTune} />}
      {node.type === "palette-from-image" && colors.length > 0 && (
        <ul className={cx(styles.swatches, styles.panelSwatches)}>
          {colors.map((color, i) => (
            <li key={`${color}-${i}`} className={styles.swatch} style={{ background: color }} title={color} />
          ))}
        </ul>
      )}
      {node.type === "preview" && <p className={styles.hint}>Press Play to make the game, then play it in the Game tab.</p>}
    </div>
  );
}
