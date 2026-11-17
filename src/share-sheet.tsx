import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Journey } from "../convex/lib/journeys";
import { mark } from "./perf";
import { drawShareImage, renderShareImage } from "./share-image";
import { shareText } from "./share-text";

const FILE_NAME = "nahfahrt-verbindung.png";

const base64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

async function sendNative(image: Blob | undefined, text: string | undefined): Promise<void> {
  let files: string[] | undefined;
  if (image) {
    // Always the same file in the cache, so old pictures don't pile up.
    const { uri } = await Filesystem.writeFile({
      path: FILE_NAME,
      data: await base64(image),
      directory: Directory.Cache,
    });
    files = [uri];
  }
  await Share.share({ text, files, dialogTitle: "Verbindung teilen" });
}

async function sendWeb(image: Blob | undefined, text: string | undefined): Promise<void> {
  const files = image ? [new File([image], FILE_NAME, { type: "image/png" })] : undefined;
  if (navigator.share) await navigator.share({ text, files });
  else if (text) await navigator.clipboard.writeText(text);
}

export function ShareSheet(props: {
  from: string;
  to: string;
  journey: Journey;
  onClose: () => void;
  onDone: (message?: string) => void;
}) {
  const [withImage, setWithImage] = useState(true);
  const [withText, setWithText] = useState(true);
  const [text, setText] = useState(() => shareText(props.from, props.to, props.journey));
  const [image, setImage] = useState(false);
  const [sending, setSending] = useState(false);
  const preview = useRef<HTMLCanvasElement>(null);
  // One moment for preview and file, so both show the same "Stand".
  const [takenAt] = useState(Date.now);

  // The sheet appears first; the preview is drawn right after, at screen resolution.
  useEffect(() => {
    let cancelled = false;
    const frame = requestAnimationFrame(() =>
      setTimeout(() => {
        if (cancelled || !preview.current) return;
        try {
          drawShareImage(preview.current, props.from, props.to, props.journey, devicePixelRatio || 1, takenAt);
          setImage(true);
          mark("share-image-ready");
        } catch {
          // Without a picture, text still works.
          setWithImage(false);
        }
      }),
    );
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [props.from, props.to, props.journey, takenAt]);

  const canSend = (withImage && image) || (withText && !!text.trim());

  const send = async () => {
    setSending(true);
    const shownText = withText && text.trim() ? text.trim() : undefined;
    try {
      // The full-resolution file is only made when it is really shared.
      const shownImage = withImage && image
        ? await renderShareImage(props.from, props.to, props.journey, takenAt)
        : undefined;
      await (Capacitor.isNativePlatform() ? sendNative : sendWeb)(shownImage, shownText);
      props.onDone();
    } catch (failure) {
      const cancelled = /cancel|abort/i.test(failure instanceof Error ? failure.message : String(failure));
      props.onDone(cancelled ? undefined : "Das Teilen hat nicht geklappt.");
    }
  };

  return (
    <div
      class="overlay overlay-bottom"
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div class="sheet share-sheet" role="dialog" aria-modal="true" aria-label="Verbindung teilen">
        <h2 class="sheet-title">Verbindung teilen</h2>
        <div class="toggle-chips" role="group" aria-label="Was geteilt wird">
          <button
            type="button"
            class={withImage ? "toggle-chip toggle-chip-on" : "toggle-chip"}
            aria-pressed={withImage}
            disabled={!image}
            onClick={() => setWithImage(!withImage)}
          >
            Bild
          </button>
          <button
            type="button"
            class={withText ? "toggle-chip toggle-chip-on" : "toggle-chip"}
            aria-pressed={withText}
            onClick={() => setWithText(!withText)}
          >
            Text
          </button>
        </div>
        <div class="share-scroll">
          <canvas
            ref={preview}
            class="share-image"
            hidden={!image || !withImage}
            role="img"
            aria-label="Vorschau des Bildes dieser Verbindung"
          />
          {withText && (
            <textarea
              class="share-text"
              rows={Math.min(14, text.split("\n").length + 1)}
              aria-label="Text zum Teilen"
              value={text}
              onInput={(event) => setText(event.currentTarget.value)}
            />
          )}
        </div>
        <div class="dialog-actions">
          <button type="button" class="text-button" onClick={props.onClose}>
            Abbrechen
          </button>
          <button
            type="button"
            class="primary small"
            disabled={!canSend || sending}
            onClick={() => void send()}
          >
            Teilen
          </button>
        </div>
      </div>
    </div>
  );
}
