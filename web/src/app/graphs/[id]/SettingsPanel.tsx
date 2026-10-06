"use client";

// The settings of the selected step, in plain words: a file picker for the steps that take a file, three sliders for the
// Game Template (with a live line when the combination cannot be played), and a short explanation for the others.
import { useId, useState } from "react";
import { cx } from "@/app/graphs/[id]/cx";
import styles from "@/app/graphs/[id]/editor.module.css";
import { Icon } from "@/app/graphs/[id]/icons";
import type { ResultView, StepData } from "@/lib/canvas/cardView";
import { SHAPES, SHAPE_NAMES, TRIANGLES } from "@/lib/blender/types";
import { KIND_NAMES, MODEL_KINDS } from "@/lib/builder/kinds";
import { TUNING_FIELDS, tuningProblem } from "@/lib/canvas/tuning";
import { SAMPLE_PALETTE } from "@/lib/graph/palette";
import { MAX_DESCRIPTION_CHARACTERS, MAX_MOTION_CHARACTERS, MAX_PROMPT_CHARACTERS } from "@/lib/graph/registry";
import { type Assets, type GraphNode, ROLE_FILES, type Role, type Tuning } from "@/lib/graph/types";

export interface SettingsPanelProps {
  node: GraphNode | null;
  data: StepData | null;
  assets: Assets;
  graphId: string;
  uploading: boolean;
  error: string | null;
  onChooseFile: (nodeId: string, file: File) => void;
  onTune: (nodeId: string, tuning: Tuning) => void;
  onPrompt: (nodeId: string, prompt: string) => void;
  /** Changes some of a step's settings (the Blender steps: triangles, color, shape). */
  onSettings: (nodeId: string, patch: Record<string, unknown>) => void;
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
  if (port.type === "environment") return "Without an environment, the plain ground and sky are used.";
  return `Without ${article(port.label)} ${port.label}, a built-in shape is used.`;
}

// Prepare Model's triangle budget. What is typed is kept as typed until it is a whole number in range; only then does it reach the
// graph (a number outside the range could not be saved, and then no later edit could be either). Leaving the box shows the last good one.
function TrianglesBox({ nodeId, triangles, onSettings }: { nodeId: string; triangles: number; onSettings: SettingsPanelProps["onSettings"] }) {
  const id = useId();
  const [draft, setDraft] = useState(String(triangles));
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.fieldLabel}>
        Triangles
      </label>
      <input
        id={id}
        className={styles.numberInput}
        type="number"
        min={TRIANGLES.min}
        max={TRIANGLES.max}
        step={100}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          const typed = Number(event.target.value);
          if (event.target.value.trim() !== "" && Number.isInteger(typed) && typed >= TRIANGLES.min && typed <= TRIANGLES.max) onSettings(nodeId, { triangles: typed });
        }}
        onBlur={() => setDraft(String(triangles))}
      />
      <p className={styles.hint}>{`Fewer triangles make a smaller, faster model (${TRIANGLES.min} to ${TRIANGLES.max}).`}</p>
    </div>
  );
}

// The color a Blender step paints with: one of the five palette swatches (the wired palette's, or the sample palette's), and for
// Prepare Model also the model's own colors. A swatch that is not a #rrggbb color is never put in a style: the sample's takes its place.
function ColorChoice(props: { nodeId: string; color: unknown; swatches: string[] | undefined; withOriginal: boolean; onSettings: SettingsPanelProps["onSettings"] }) {
  const id = useId();
  const shown = SAMPLE_PALETTE.map((sample, i) => (HEX.test(props.swatches?.[i] ?? "") ? props.swatches![i] : sample));
  return (
    <div className={styles.field} role="group" aria-labelledby={id}>
      <span id={id} className={styles.fieldLabel}>
        Color
      </span>
      {props.withOriginal && (
        <button
          type="button"
          className={cx(styles.choice, props.color === "original" && styles.choiceOn)}
          aria-pressed={props.color === "original"}
          onClick={() => props.onSettings(props.nodeId, { color: "original" })}
        >
          {"Keep the model's colors"}
        </button>
      )}
      <ul className={styles.choiceRow}>
        {shown.map((hex, i) => (
          <li key={i}>
            <button
              type="button"
              className={cx(styles.swatchButton, props.color === i + 1 && styles.choiceOn)}
              aria-pressed={props.color === i + 1}
              aria-label={`Swatch ${i + 1}, ${hex}`}
              style={{ background: hex }}
              onClick={() => props.onSettings(props.nodeId, { color: i + 1 })}
            />
          </li>
        ))}
      </ul>
      <p className={styles.hint}>Textures are dropped: the model is painted in flat colors.</p>
    </div>
  );
}

// Make Shape's seven shapes, by name.
function ShapeChoice({ nodeId, shape, onSettings }: { nodeId: string; shape: unknown; onSettings: SettingsPanelProps["onSettings"] }) {
  const id = useId();
  return (
    <div className={styles.field} role="group" aria-labelledby={id}>
      <span id={id} className={styles.fieldLabel}>
        Shape
      </span>
      <ul className={styles.choiceRow}>
        {SHAPES.map((name) => (
          <li key={name}>
            <button type="button" className={cx(styles.choice, shape === name && styles.choiceOn)} aria-pressed={shape === name} onClick={() => onSettings(nodeId, { shape: name })}>
              {SHAPE_NAMES[name]}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// The prompt of a Describe Game: what the person wants, in their own words. The notice is there so nobody is surprised
// that the words (and the picture) leave the studio.
function PromptBox({ nodeId, prompt, onPrompt }: { nodeId: string; prompt: string; onPrompt: SettingsPanelProps["onPrompt"] }) {
  const id = useId();
  const left = MAX_PROMPT_CHARACTERS - Array.from(prompt).length;
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.fieldLabel}>
        Describe your game
      </label>
      <textarea id={id} className={styles.promptBox} rows={5} maxLength={MAX_PROMPT_CHARACTERS} value={prompt} onChange={(event) => onPrompt(nodeId, event.target.value)} />
      <p className={styles.hint}>{`${left} characters left`}</p>
      <p className={styles.hint}>{"Your description and picture are sent to Anthropic's Claude to make this."}</p>
    </div>
  );
}

const ROLE_NAMES: Record<Role, string> = { hero: "Hero", obstacle: "Obstacle", collectible: "Collectible" };
const ROLES = Object.keys(ROLE_FILES) as Role[];

// A group of buttons of which one is pressed; picking one changes one setting.
function ChoiceGroup(props: { label: string; choices: { value: string; name: string }[]; current: unknown; onPick: (value: string) => void }) {
  const id = useId();
  return (
    <div className={styles.field} role="group" aria-labelledby={id}>
      <span id={id} className={styles.fieldLabel}>
        {props.label}
      </span>
      <ul className={styles.choiceRow}>
        {props.choices.map((choice) => (
          <li key={choice.value}>
            <button type="button" className={cx(styles.choice, props.current === choice.value && styles.choiceOn)} aria-pressed={props.current === choice.value} onClick={() => props.onPick(choice.value)}>
              {choice.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WordsBox(props: { label: string; value: string; max: number; rows: number; counter: boolean; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.fieldLabel}>
        {props.label}
      </label>
      <textarea id={id} className={styles.promptBox} rows={props.rows} maxLength={props.max} value={props.value} onChange={(event) => props.onChange(event.target.value)} />
      {props.counter && <p className={styles.hint}>{`${props.max - Array.from(props.value).length} characters left`}</p>}
    </div>
  );
}

// Build Model: what it is for (role), what it is (kind, or Auto to let the AI choose), and the person's own words for the model and its
// motions. A hero has a Run and a Jump box; an obstacle or a collectible has a Loop box.
function BuildModelPanel({ node, onSettings }: { node: GraphNode; onSettings: SettingsPanelProps["onSettings"] }) {
  const text = (key: string) => (typeof node.params[key] === "string" ? (node.params[key] as string) : "");
  const hero = node.params.role === "hero";
  return (
    <>
      <ChoiceGroup label="Role" choices={ROLES.map((value) => ({ value, name: ROLE_NAMES[value] }))} current={node.params.role} onPick={(role) => onSettings(node.id, { role })} />
      <ChoiceGroup
        label="Kind"
        choices={[{ value: "auto", name: "Auto" }, ...MODEL_KINDS.map((value) => ({ value, name: KIND_NAMES[value] }))]}
        current={node.params.kind}
        onPick={(kind) => onSettings(node.id, { kind })}
      />
      <WordsBox label="What is it?" value={text("description")} max={MAX_DESCRIPTION_CHARACTERS} rows={4} counter onChange={(description) => onSettings(node.id, { description })} />
      {hero ? (
        <>
          <WordsBox label="Run" value={text("run")} max={MAX_MOTION_CHARACTERS} rows={2} counter={false} onChange={(run) => onSettings(node.id, { run })} />
          <WordsBox label="Jump" value={text("jump")} max={MAX_MOTION_CHARACTERS} rows={2} counter={false} onChange={(jump) => onSettings(node.id, { jump })} />
        </>
      ) : (
        <WordsBox label="Loop" value={text("loop")} max={MAX_MOTION_CHARACTERS} rows={2} counter={false} onChange={(loop) => onSettings(node.id, { loop })} />
      )}
      <p className={styles.hint}>Leave a box empty for the usual motion.</p>
      <p className={styles.hint}>{"Your words and picture are sent to Anthropic's Claude to design this; with every box empty, nothing is sent."}</p>
    </>
  );
}

function TuningSliders({ node, data, onTune }: { node: GraphNode; data: StepData; onTune: SettingsPanelProps["onTune"] }) {
  const id = useId();
  const tuning = node.params.tuning as Tuning;
  // While a feel is wired in, the numbers are Describe Game's: the sliders show what the last run used (or the saved ones
  // before a run) and cannot be moved. Unplugging the feel gives them back.
  const locked = data.tuningLocked;
  const shown = locked ? (data.liveTuning ?? tuning) : tuning;
  const problem = locked ? null : tuningProblem(tuning);
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
              value={shown[field.key]}
              disabled={locked}
              onChange={(event) => onTune(node.id, { ...tuning, [field.key]: Number(event.target.value) })}
            />
            <output className={styles.value}>
              {`${shown[field.key]} ${field.unit}`}
            </output>
          </div>
        </div>
      ))}
      {locked && <p className={styles.hint}>Set by Describe Game</p>}
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

export function SettingsPanel({ node, data, uploading, error, onChooseFile, onTune, onPrompt, onSettings }: SettingsPanelProps) {
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
          accept=".glb,.fbx,.obj"
          note="A GLB, FBX or OBJ file, up to 4 MB. An FBX or OBJ needs a Prepare Model step before the game."
          uploading={uploading}
          error={error}
          result={data.result}
          onPick={(file) => onChooseFile(node.id, file)}
        />
      )}
      {node.type === "prepare-model" && (
        <>
          <TrianglesBox key={node.id} nodeId={node.id} triangles={typeof node.params.triangles === "number" ? node.params.triangles : TRIANGLES.default} onSettings={onSettings} />
          <ColorChoice nodeId={node.id} color={node.params.color} swatches={data.swatches} withOriginal onSettings={onSettings} />
        </>
      )}
      {node.type === "make-shape" && (
        <>
          <ShapeChoice nodeId={node.id} shape={node.params.shape} onSettings={onSettings} />
          <ColorChoice nodeId={node.id} color={node.params.color} swatches={data.swatches} withOriginal={false} onSettings={onSettings} />
        </>
      )}
      {node.type === "build-model" && <BuildModelPanel node={node} onSettings={onSettings} />}
      {node.type === "describe-game" && <PromptBox nodeId={node.id} prompt={typeof node.params.prompt === "string" ? node.params.prompt : ""} onPrompt={onPrompt} />}
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
