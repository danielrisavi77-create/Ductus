"use client";

import { useEffect, useMemo, useState } from "react";

import { messagesHr as t } from "@/lib/i18n/messages.hr";

import { buildFrames, clampStep, parseEdit } from "./replay";
import styles from "./Wow.module.css";

const l = t.landing.replay;

const stepOf = (step: number, last: number) =>
  l.stepOf.replace("{step}", String(step)).replace("{last}", String(last));

/** Fixed step interval of the demo playback; not derived from any writing. */
const PLAY_STEP_MS = 650;

/**
 * Replay of how an invented paragraph came to be, step by step (PRODUCT §5
 * rule 7: the mentor of the task and the student see the same replay). The
 * visitor scrubs a step slider or plays through the steps. Nothing is read from
 * the visitor and nothing is sent; there is no timing of any kind in the data.
 */
export default function Replay() {
  const frames = useMemo(() => buildFrames(l.edits.map(parseEdit)), []);
  const last = frames.length - 1;
  const [step, setStep] = useState(last);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setStep((current) => {
        if (current >= last - 1) setPlaying(false);
        return clampStep(current + 1, frames.length);
      });
    }, PLAY_STEP_MS);
    const stop = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener("visibilitychange", stop);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", stop);
    };
  }, [playing, last, frames.length]);

  const toggle = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (step >= last) setStep(0);
    setPlaying(true);
  };

  const label = step === 0 ? l.start : step === last ? l.end : l.during;
  const text = frames[step] ?? "";

  return (
    <section className={styles.block} aria-labelledby="replay-title">
      <p className={styles.eyebrow}>{l.eyebrow}</p>
      <h2 id="replay-title" className={styles.blockTitle}>
        {l.title}
      </h2>
      <p className={styles.lead}>{l.lead}</p>
      <div className={styles.replayBox}>
        <p className={styles.replayText} aria-live="off">
          {text === "" ? <span className={styles.replayEmpty}>{l.empty}</span> : text}
        </p>
        <div className={styles.replayControls}>
          <button type="button" className={styles.replayButton} onClick={toggle}>
            {playing ? l.pause : l.play}
          </button>
          <input
            type="range"
            className={styles.replayRange}
            min={0}
            max={last}
            step={1}
            value={step}
            aria-label={l.sliderLabel}
            aria-valuetext={stepOf(step, last)}
            onChange={(event) => {
              setPlaying(false);
              setStep(clampStep(Number(event.target.value), frames.length));
            }}
          />
          <span className={styles.replayStatus}>
            {label} · {stepOf(step, last)}
          </span>
        </div>
      </div>
      <p className={styles.small}>{l.note}</p>
    </section>
  );
}
