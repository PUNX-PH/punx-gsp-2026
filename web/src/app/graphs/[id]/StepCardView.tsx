// What a step's card looks like, drawn from the numbers in StepData (see lib/canvas/cardView.ts). Everything except the
// connection handles lives here, so the card renders without a React Flow around it; StepCard supplies the handles.
import { type ReactNode, useState } from "react";
import { cx } from "@/app/graphs/[id]/cx";
import styles from "@/app/graphs/[id]/editor.module.css";
import { CrossIcon, Icon, PlusIcon, StatusIcon } from "@/app/graphs/[id]/icons";
import type { PortView, ResultView, StepData } from "@/lib/canvas/cardView";

export interface StepCardViewProps {
  data: StepData;
  selected: boolean;
  /** The "+" on an output that has no wire. */
  onAddFrom?: (port: string) => void;
  onRemove?: () => void;
  onOpenGame?: () => void;
  /** Draws a connection handle; React Flow's, from StepCard. Left out when rendering without a flow. */
  renderHandle?: (port: PortView, side: "input" | "output") => ReactNode;
}

const HEX = /^#[0-9a-f]{6}$/i;

function Result({ result, onOpenGame }: { result: ResultView; onOpenGame?: () => void }) {
  switch (result.kind) {
    case "image":
      return (
        <div className={styles.result}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a small authenticated thumbnail from our own API */}
          <img className={styles.thumb} src={result.thumbUrl} alt="" />
          <span className={styles.fileInfo}>
            <span className={styles.fileName}>{result.name}</span>
          </span>
        </div>
      );
    case "model":
      return (
        <div className={styles.result}>
          <span className={styles.fileInfo}>
            <span className={styles.fileName}>{result.name}</span>
            <span className={styles.fileMeta}>{result.size}</span>
          </span>
        </div>
      );
    case "palette":
      return (
        <ul className={cx(styles.result, styles.swatches)}>
          {result.colors
            .filter((color) => HEX.test(color))
            .map((color, i) => (
              <li key={`${color}-${i}`} className={styles.swatch} style={{ background: color }} title={color} />
            ))}
        </ul>
      );
    case "text":
      return (
        <div className={styles.result}>
          <span className={styles.chip}>{result.text}</span>
        </div>
      );
    case "described":
      return (
        <div className={cx(styles.result, styles.described)}>
          <ul className={cx(styles.swatches)}>
            {result.colors
              .filter((color) => HEX.test(color))
              .map((color, i) => (
                <li key={`${color}-${i}`} className={styles.swatch} style={{ background: color }} title={color} />
              ))}
          </ul>
          <span className={styles.chip}>{result.numbers}</span>
          <p className={styles.summary}>{result.summary}</p>
          {result.reused && <p className={styles.reusedNote}>Reused your earlier answer</p>}
        </div>
      );
    case "made":
      return (
        <div className={cx(styles.result, styles.described)}>
          {result.swatch !== null && HEX.test(result.swatch) && (
            <ul className={styles.swatches}>
              <li className={styles.swatch} style={{ background: result.swatch }} title={result.swatch} />
            </ul>
          )}
          <span className={styles.chip}>{result.line}</span>
          {result.reused && <p className={styles.reusedNote}>Reused your earlier result</p>}
        </div>
      );
    case "built":
      return (
        <div className={cx(styles.result, styles.described)}>
          {result.quality !== undefined && <span className={styles.chip}>{result.quality}</span>}
          <span className={styles.chip}>{result.line}</span>
          <p className={styles.hint}>{result.clips}</p>
          <p className={styles.summary}>{result.summary}</p>
          {result.skipped !== null && <p className={styles.hint}>{result.skipped}</p>}
          {result.reused && <p className={styles.reusedNote}>Reused your earlier result</p>}
        </div>
      );
    case "environment":
      return (
        <div className={cx(styles.result, styles.described)}>
          <ul className={styles.swatches}>
            {result.colors
              .filter((color) => HEX.test(color))
              .map((color, i) => (
                <li key={`${color}-${i}`} className={styles.swatch} style={{ background: color }} title={color} />
              ))}
          </ul>
          {result.quality !== undefined && <span className={styles.chip}>{result.quality}</span>}
          <span className={styles.chip}>{result.scenery}</span>
          {result.numbers !== undefined && <span className={styles.chip}>{result.numbers}</span>}
          {result.reused && <p className={styles.reusedNote}>Reused your earlier result</p>}
        </div>
      );
    case "open-game":
      return (
        <div className={styles.result}>
          {onOpenGame ? (
            <button
              type="button"
              className={cx(styles.chip, styles.openGame, "nodrag")}
              onClick={(event) => {
                event.stopPropagation(); // or the click also selects the card, which switches the panel back to Settings
                onOpenGame();
              }}
            >
              Open game
            </button>
          ) : (
            <span className={styles.chip}>Open game</span>
          )}
        </div>
      );
    default:
      return null;
  }
}

/** A card with more inputs than this (the Assemble Game has fourteen) shows only the ones that are required or wired, until it is selected or opened. */
const COLLAPSE_ABOVE = 6;

export function StepCardView({ data, selected, onAddFrom, onRemove, onOpenGame, renderHandle }: StepCardViewProps) {
  const manyInputs = data.inputs.length > 1;
  const [opened, setOpened] = useState(false);
  const collapsible = data.inputs.length > COLLAPSE_ABOVE;
  const showAll = !collapsible || opened || selected === true;
  const shown = showAll ? data.inputs : data.inputs.filter((port) => port.required || port.wired);
  const hidden = data.inputs.length - shown.length;

  return (
    <div className={cx(styles.card, selected && styles.selected)} data-status={data.status} role="group" aria-label={data.label}>
      {data.number !== null && (
        <span className={styles.badge}>
          <span aria-hidden="true">{data.number}</span>
          <span className={styles.visuallyHidden}>{`Step ${data.number}`}</span>
        </span>
      )}

      <header className={styles.header}>
        <span className={styles.icon}>
          <Icon type={data.type} />
        </span>
        <h3 className={styles.name}>{data.label}</h3>
        {selected && onRemove && (
          <button type="button" className={cx(styles.remove, "nodrag")} aria-label={`Delete ${data.label}`} onClick={onRemove}>
            <CrossIcon />
          </button>
        )}
      </header>

      <p className={styles.help}>{data.help}</p>

      {data.inputs.length === 1 && renderHandle?.(data.inputs[0], "input")}
      {manyInputs && (
        <ul className={styles.ports}>
          {shown.map((port) => (
            <li key={port.name} className={styles.portRow}>
              {renderHandle?.(port, "input")}
              <span className={styles.portLabel}>{port.label}</span>
              {!port.required && !port.wired && <span className={styles.optional}>optional</span>}
            </li>
          ))}
          {collapsible && !selected && (
            <li className={styles.portMore}>
              <button type="button" className={cx(styles.moreInputs, "nodrag")} aria-expanded={opened} onClick={() => setOpened(!opened)}>
                {opened ? "Show fewer inputs" : `${hidden} more inputs`}
              </button>
            </li>
          )}
        </ul>
      )}

      <Result result={data.result} onOpenGame={onOpenGame} />

      {data.status !== "idle" && (
        <p className={styles.status} data-tone={data.status}>
          <StatusIcon status={data.status} spinnerClassName={styles.spinner} />
          <span>{data.statusText}</span>
        </p>
      )}

      {data.outputs.map((port) => (
        <span key={port.name}>
          {renderHandle?.(port, "output")}
          {!port.wired && onAddFrom && (
            <button type="button" className={cx(styles.plus, "nodrag")} aria-label={`Add a step after ${data.label}`} onClick={() => onAddFrom(port.name)}>
              <PlusIcon />
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
