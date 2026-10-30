"use client";

import { useState } from "react";
import { api, ApiError, Study, StudyMember, StudyVisibility } from "@/lib/api";

/**
 * Who can see this study, and who can write in it.
 *
 * Two separate questions, and the panel keeps them apart because the server
 * does. Visibility is about reading and travels with the link. Contributors is
 * about writing and is a list of accounts — a person you sent the link to is a
 * reader, and adding them here is a deliberate second act.
 */

const OPTIONS: { value: StudyVisibility; label: string; blurb: string }[] = [
  { value: "private", label: "Private", blurb: "Only you and your contributors." },
  {
    value: "unlisted",
    label: "Anyone with the link",
    blurb: "Not listed anywhere. The link is the key — treat it like one.",
  },
  { value: "public", label: "Public", blurb: "Readable by anyone, and listable." },
];

interface Props {
  study: Study;
  members: StudyMember[];
  onStudy: (study: Study) => void;
  onMembers: (members: StudyMember[]) => void;
}

export default function StudyShare({ study, members, onStudy, onMembers }: Props) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const ref = String(study.id);
  const link =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/study/view/?s=${study.slug}`;

  async function setVisibility(visibility: StudyVisibility) {
    const previous = study.visibility;
    if (visibility === previous) return;

    // Move the radio now. The panel below it (link, reset) keys off
    // visibility, so waiting on the round trip meant clicking "Anyone with the
    // link" and then watching nothing happen for as long as the request took.
    onStudy({ ...study, visibility });
    setNote(null);
    try {
      onStudy(await api.updateStudy(ref, { visibility }));
    } catch (err) {
      onStudy({ ...study, visibility: previous });
      setNote(
        (err instanceof ApiError ? err.message : "Could not change that") +
          ` — still ${previous}.`
      );
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setNote("Copying was blocked — select the link and copy it by hand.");
    }
  }

  async function reshare() {
    if (
      !confirm(
        "Everyone holding the current link loses access immediately. Make a new link?"
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      onStudy(await api.reshareStudy(ref));
      setNote("New link minted. The old one no longer opens this study.");
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Could not reset the link");
    } finally {
      setBusy(false);
    }
  }

  async function addMember() {
    const address = email.trim();
    if (!address) return;
    setBusy(true);
    setNote(null);
    try {
      const next = await api.addStudyMember(ref, address);
      onMembers(next);
      setEmail("");
      // The server will not say whether an address has an account behind it —
      // that would make this box an oracle for who is registered here — so the
      // honest thing to report is what actually came back.
      if (!next.some((m) => m.email.toLowerCase() === address.toLowerCase())) {
        setNote(`Nothing changed. ${address} may not have a ChessRabbit account.`);
      }
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Could not add them");
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(userId: number) {
    const previous = members;
    const gone = members.find((m) => m.user_id === userId);

    onMembers(members.filter((m) => m.user_id !== userId));
    setNote(null);
    try {
      onMembers(await api.removeStudyMember(ref, userId));
    } catch (err) {
      // Put the row back where it was. Silently dropping somebody from a
      // contributor list while they still have write access is the one failure
      // mode worth being loud about.
      onMembers(previous);
      setNote(
        (err instanceof ApiError ? err.message : "Could not remove them") +
          ` — ${gone?.display_name ?? "they"} still have access.`
      );
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="eyebrow mb-1.5">Who can read it</p>
        <div className="space-y-1">
          {OPTIONS.map((o) => (
            <label
              key={o.value}
              className={`flex cursor-pointer gap-2 rounded-xl border px-2.5 py-2 transition-colors ${
                study.visibility === o.value
                  ? "border-brass/50 bg-brass/10"
                  : "border-ivory/10 hover:bg-ivory/[0.05]"
              }`}
            >
              <input
                type="radio"
                name="visibility"
                className="mt-1 shrink-0"
                checked={study.visibility === o.value}
                disabled={busy}
                onChange={() => setVisibility(o.value)}
              />
              <span className="min-w-0">
                <span className="block text-xs font-medium">{o.label}</span>
                <span className="block text-[11px] leading-relaxed text-muted">{o.blurb}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {study.visibility !== "private" && (
        <div>
          <p className="eyebrow mb-1.5">Link</p>
          <div className="flex gap-1.5">
            <input readOnly value={link} className="input h-8 flex-1 py-0 font-mono text-[11px]" />
            <button onClick={copy} className="btn shrink-0 px-2 text-xs">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <button
            onClick={reshare}
            disabled={busy}
            className="mt-1.5 text-[11px] text-muted underline hover:text-bad disabled:opacity-40"
          >
            Reset the link
          </button>
        </div>
      )}

      <div>
        <p className="eyebrow mb-1.5">Who can write in it</p>
        <div className="flex gap-1.5">
          <input
            className="input h-8 flex-1 py-0 text-xs"
            type="email"
            placeholder="their@email.com"
            value={email}
            disabled={busy}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addMember()}
          />
          <button
            onClick={addMember}
            disabled={busy || !email.trim()}
            className="btn shrink-0 px-2 text-xs disabled:opacity-40"
          >
            Add
          </button>
        </div>

        {members.length > 0 && (
          <ul className="mt-2 space-y-1">
            {members.map((m) => (
              <li key={m.user_id} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate">
                  {m.display_name}
                  <span className="ml-1.5 text-muted">{m.email}</span>
                </span>
                <button
                  onClick={() => removeMember(m.user_id)}
                  disabled={busy}
                  title={`Remove ${m.display_name}`}
                  className="shrink-0 rounded-md px-1.5 text-muted hover:bg-bad/20 hover:text-bad
                             disabled:opacity-40"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {note && <p className="text-[11px] leading-relaxed text-muted">{note}</p>}
    </div>
  );
}
