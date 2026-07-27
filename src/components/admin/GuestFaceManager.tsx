"use client";

/**
 * Guest manager (/admin/faces).
 *
 * Rachel's job here is doing 24+ face picks in one sitting, so the flow is
 * tuned for a run: the to-do list (guests with no face) sorts first, a
 * progress line tracks the run, "Save face & next" jumps straight to the
 * next faceless guest, and every step works from the keyboard (arrows move
 * the crop, +/- resize it, Enter saves, Escape backs out).
 *
 * Crops are pure geometry: a normalized square (x, y as fractions of the
 * photo's width/height, size as a fraction of its shorter axis) stored in
 * rachandzach_person_overrides and rendered by CSS-cropping the signed
 * preview -- nothing is written to disk at runtime.
 *
 * "Add" creates a real catalog person (taggable from the Catalog screen)
 * plus the override row that marks them as added here. "Remove" soft-hides
 * anyone something references and hard-deletes an added person only while
 * nothing durable references them (no photo tags and no guest favorites
 * saved under their name, decided atomically server-side); the confirm
 * dialog states which will happen. "Revert" clears the hand-picked crop.
 * Photo tags are never edited from this screen.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowLeft, Check, Minus, Plus, Search, X } from "lucide-react";

import type {
  AdminRoster,
  AdminRosterPerson,
} from "@/lib/admin/people";
import { slugifyPersonName } from "@/lib/admin/people";
import type {
  ClientGalleryPage,
  ClientPhoto,
} from "@/lib/gallery/client-types";
import {
  faceCropCss,
  normalizeFaceCrop,
  type FaceCrop,
} from "@/lib/people/face-types";

type RosterFilter = "todo" | "all" | "hidden" | "added";

const FILTER_LABELS: { value: RosterFilter; label: string }[] = [
  { value: "todo", label: "Needs a face" },
  { value: "all", label: "Everyone" },
  { value: "hidden", label: "Hidden" },
  { value: "added", label: "Added" },
];

const DEFAULT_CROP: FaceCrop = { x: 0.5, y: 0.5, size: 0.5 };

export interface GuestFaceManagerProps {
  initialRoster: AdminRoster;
}

export function GuestFaceManager({ initialRoster }: GuestFaceManagerProps) {
  const [people, setPeople] = useState<AdminRosterPerson[]>(
    initialRoster.people,
  );
  const [filter, setFilter] = useState<RosterFilter>(() =>
    initialRoster.people.some(
      (person) => !person.hidden && person.faceKind === "none",
    )
      ? "todo"
      : "all",
  );
  const [query, setQuery] = useState("");
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const surfaced = useMemo(
    () => people.filter((person) => !person.hidden),
    [people],
  );
  const withFace = useMemo(
    () => surfaced.filter((person) => person.faceKind !== "none"),
    [surfaced],
  );
  const todo = useMemo(
    () => surfaced.filter((person) => person.faceKind === "none"),
    [surfaced],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return people.filter((person) => {
      if (filter === "todo" && (person.hidden || person.faceKind !== "none")) {
        return false;
      }
      if (filter === "hidden" && !person.hidden) return false;
      if (filter === "added" && !person.added) return false;
      if (filter === "all" && person.hidden) return false;
      if (!needle) return true;
      return (
        person.displayName.toLowerCase().includes(needle) ||
        person.slug.includes(needle)
      );
    });
  }, [people, filter, query]);

  const updatePerson = useCallback(
    (slug: string, patch: Partial<AdminRosterPerson>) => {
      setPeople((current) =>
        current.map((person) =>
          person.slug === slug ? { ...person, ...patch } : person,
        ),
      );
    },
    [],
  );

  const editing = editingSlug
    ? people.find((person) => person.slug === editingSlug) ?? null
    : null;

  /** The run: after a save, jump to the next guest still without a face. */
  const nextTodoAfter = useCallback(
    (slug: string): string | null => {
      const pending = people.filter(
        (person) =>
          !person.hidden &&
          person.faceKind === "none" &&
          person.slug !== slug,
      );
      return pending[0]?.slug ?? null;
    },
    [people],
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1
            className="text-2xl font-semibold"
            style={{ color: "var(--color-ink)", fontFamily: "var(--font-display)" }}
          >
            Guests &amp; faces
          </h1>
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            The Find me picker shows exactly what you see here. Pick a photo,
            frame the face, save.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="border px-4 py-2 text-sm font-medium"
          style={{
            borderColor: "var(--color-ink)",
            backgroundColor: "var(--color-ink)",
            color: "var(--color-cream)",
            borderRadius: "var(--radius-card)",
          }}
        >
          Add a person
        </button>
      </header>

      <section
        aria-label="Progress"
        className="flex flex-col gap-2 border px-5 py-4"
        style={{
          borderColor: "var(--color-sand)",
          backgroundColor: "var(--color-white)",
          borderRadius: "var(--radius-card)",
        }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm" style={{ color: "var(--color-ink)" }}>
            <strong style={{ fontFamily: "var(--font-archive)" }}>
              {withFace.length}
            </strong>{" "}
            of{" "}
            <strong style={{ fontFamily: "var(--font-archive)" }}>
              {surfaced.length}
            </strong>{" "}
            guests have a face
          </p>
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            {todo.length === 0
              ? "All done — every guest has a face."
              : `${todo.length} still need one`}
          </p>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={surfaced.length}
          aria-valuenow={withFace.length}
          aria-label="Guests with a face"
          className="h-1.5 w-full overflow-hidden"
          style={{ backgroundColor: "var(--color-sand)", borderRadius: "999px" }}
        >
          <div
            className="h-full"
            style={{
              width: `${surfaced.length > 0 ? (withFace.length / surfaced.length) * 100 : 0}%`,
              backgroundColor: "var(--color-coral)",
              borderRadius: "999px",
            }}
          />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Filter guests"
          className="flex flex-wrap gap-1 border p-1"
          style={{
            borderColor: "var(--color-sand)",
            backgroundColor: "var(--color-white)",
            borderRadius: "var(--radius-card)",
          }}
        >
          {FILTER_LABELS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
              className="px-3 py-1.5 text-sm"
              style={{
                borderRadius: "var(--radius-card)",
                backgroundColor:
                  filter === option.value ? "var(--color-ink)" : "transparent",
                color:
                  filter === option.value
                    ? "var(--color-cream)"
                    : "var(--color-ink)",
              }}
            >
              {option.label}
              <span
                className="ml-2 text-xs"
                style={{
                  fontFamily: "var(--font-archive)",
                  color:
                    filter === option.value
                      ? "var(--color-wheat)"
                      : "var(--color-muted)",
                }}
              >
                {countFor(option.value, people)}
              </span>
            </button>
          ))}
        </div>

        <label
          className="flex min-w-52 flex-1 items-center gap-2 border px-3 py-2 sm:max-w-xs"
          style={{
            borderColor: "var(--color-sand)",
            backgroundColor: "var(--color-white)",
            borderRadius: "var(--radius-card)",
          }}
        >
          <Search aria-hidden="true" size={15} strokeWidth={1.6} />
          <span className="sr-only">Search guests</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search guests"
            className="w-full bg-transparent text-sm outline-none"
            style={{ color: "var(--color-ink)" }}
          />
        </label>
      </div>

      {visible.length === 0 ? (
        <p
          className="border px-5 py-8 text-center text-sm"
          style={{
            borderColor: "var(--color-sand)",
            backgroundColor: "var(--color-white)",
            color: "var(--color-muted)",
            borderRadius: "var(--radius-card)",
          }}
        >
          {filter === "todo" && !query
            ? "Every surfaced guest has a face. Switch to Everyone to fine-tune."
            : "No guests match."}
        </p>
      ) : (
        <ul
          className="grid list-none grid-cols-3 gap-x-3 gap-y-6 p-0 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8"
          aria-label="Guests"
        >
          {visible.map((person) => (
            <li key={person.slug}>
              <PersonTile
                person={person}
                onOpen={() => setEditingSlug(person.slug)}
              />
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <PersonEditor
          key={editing.slug}
          person={editing}
          onClose={() => setEditingSlug(null)}
          onUpdated={updatePerson}
          onRemoved={(slug, outcome) => {
            if (outcome === "deleted") {
              setPeople((current) =>
                current.filter((person) => person.slug !== slug),
              );
            } else {
              updatePerson(slug, { hidden: true });
            }
            setEditingSlug(null);
          }}
          onSavedNext={(slug) => {
            const next = nextTodoAfter(slug);
            setEditingSlug(next);
            if (!next) setFilter("all");
          }}
        />
      ) : null}

      {adding ? (
        <AddPersonDialog
          existingSlugs={people.map((person) => person.slug)}
          onClose={() => setAdding(false)}
          onAdded={(person) => {
            setPeople((current) => [person, ...current]);
            setAdding(false);
            setEditingSlug(person.slug);
          }}
        />
      ) : null}
    </div>
  );
}

function countFor(
  filter: RosterFilter,
  people: readonly AdminRosterPerson[],
): number {
  switch (filter) {
    case "todo":
      return people.filter((p) => !p.hidden && p.faceKind === "none").length;
    case "hidden":
      return people.filter((p) => p.hidden).length;
    case "added":
      return people.filter((p) => p.added).length;
    default:
      return people.filter((p) => !p.hidden).length;
  }
}

// ---------------------------------------------------------------------------
// Face disc: exactly what the guest picker renders, plus admin fallbacks.
// ---------------------------------------------------------------------------

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("");
}

function FaceDisc({
  person,
  sizeClass = "w-full",
}: {
  person: AdminRosterPerson;
  sizeClass?: string;
}) {
  // The committed crop lives at /faces/{slug}.webp behind the guest gate;
  // an admin without a guest cookie falls back to initials rather than a
  // broken image.
  const [committedFailed, setCommittedFailed] = useState(false);
  const [overrideFailed, setOverrideFailed] = useState(false);
  const showOverride =
    person.faceKind === "override" && person.face != null && !overrideFailed;
  // Same degrade chain as the guest picker's FaceTile. A curation session can
  // easily outlive the signed-preview TTL -- switch filters an hour in and
  // newly mounted tiles request a dead URL -- and this is the screen whose
  // whole job is showing which faces are right, so a broken image here is
  // worse than anywhere else. An override that fails still tries the
  // committed crop underneath it before falling to initials.
  const showCommitted =
    !showOverride &&
    !committedFailed &&
    (person.faceKind === "committed" || person.faceKind === "override");

  return (
    <span
      aria-hidden="true"
      className={`relative block overflow-hidden ${sizeClass}`}
      style={{
        aspectRatio: "1",
        borderRadius: "50%",
        backgroundColor: "var(--color-wheat)",
        boxShadow: "0 0 0 1px color-mix(in srgb, var(--color-tan) 40%, transparent)",
      }}
    >
      {showOverride && person.face ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={person.face.url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setOverrideFailed(true)}
          style={{
            position: "absolute",
            maxWidth: "none",
            ...faceCropCss(person.face.crop, person.face.aspectRatio),
          }}
        />
      ) : showCommitted ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          // Not /faces/: that path is gated on a GUEST session, and an admin
          // may hold no guest cookie, which made every committed thumbnail
          // fall back to initials here. This route re-checks requireAdmin().
          src={`/api/admin/faces/${person.slug}`}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setCommittedFailed(true)}
        />
      ) : (
        <span
          className="absolute inset-0 grid place-items-center text-sm font-semibold"
          style={{ color: "var(--rz-tan-text, var(--color-ink))" }}
        >
          {initialsOf(person.displayName)}
        </span>
      )}
    </span>
  );
}

function PersonTile({
  person,
  onOpen,
}: {
  person: AdminRosterPerson;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid w-full justify-items-center gap-2 border-0 bg-transparent p-0 text-center"
      style={{ color: "var(--color-ink)", opacity: person.hidden ? 0.55 : 1 }}
      aria-label={`Edit ${person.displayName}`}
    >
      <FaceDisc person={person} />
      <span className="flex flex-col items-center gap-0.5">
        <span className="text-xs leading-tight">{person.displayName}</span>
        <span
          className="text-[10px]"
          style={{
            fontFamily: "var(--font-archive)",
            color: "var(--color-muted)",
          }}
        >
          {person.count} {person.count === 1 ? "photo" : "photos"}
        </span>
        {badgeFor(person) ? (
          <span
            className="px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
            style={{
              backgroundColor: "var(--color-sand)",
              color: "var(--color-ink)",
              borderRadius: "999px",
            }}
          >
            {badgeFor(person)}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function badgeFor(person: AdminRosterPerson): string | null {
  if (person.hidden) return "Hidden";
  if (person.added) return "Added";
  if (person.faceKind === "override") return "Hand-picked";
  if (person.faceKind === "none") return "Needs a face";
  return null;
}

// ---------------------------------------------------------------------------
// Editor overlay
// ---------------------------------------------------------------------------

interface PersonEditorProps {
  person: AdminRosterPerson;
  onClose: () => void;
  onUpdated: (slug: string, patch: Partial<AdminRosterPerson>) => void;
  onRemoved: (slug: string, outcome: "deleted" | "hidden") => void;
  /** Save landed and the admin asked for the next guest without a face. */
  onSavedNext: (slug: string) => void;
}

type CandidateScope = "tagged" | "all";

function PersonEditor({
  person,
  onClose,
  onUpdated,
  onRemoved,
  onSavedNext,
}: PersonEditorProps) {
  const [scope, setScope] = useState<CandidateScope>(
    person.count > 0 ? "tagged" : "all",
  );
  const [searchAll, setSearchAll] = useState("");
  const [candidates, setCandidates] = useState<ClientPhoto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [photo, setPhoto] = useState<ClientPhoto | null>(null);
  const [crop, setCrop] = useState<FaceCrop>(person.face?.crop ?? DEFAULT_CROP);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState(person.displayName);

  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Load candidate photos for the active scope/search.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const params = new URLSearchParams({ scope });
        if (scope === "all" && searchAll) params.set("q", searchAll);
        const res = await fetch(
          `/api/admin/people/${encodeURIComponent(person.slug)}/photos?${params}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body: ClientGalleryPage = await res.json();
        if (cancelled) return;
        setCandidates(body.photos);
        setNextCursor(body.nextCursor);
        const savedId = person.face?.photoId ?? null;
        let existing = savedId
          ? (body.photos.find((p) => p.id === savedId) ?? null)
          : null;
        // The saved photo need not be on this first page at all: it may have
        // come from a later "Load more", or from "Browse all photos" while the
        // editor reopens in the tagged scope. Matching only what happened to
        // load left the admin back at the picker hunting for their own frame,
        // so ask for it by id.
        if (savedId && !existing) {
          try {
            const byId = await fetch(
              `/api/admin/people/${encodeURIComponent(person.slug)}/photos?ids=${encodeURIComponent(savedId)}`,
              { cache: "no-store" },
            );
            if (byId.ok) {
              const page: ClientGalleryPage = await byId.json();
              existing = page.photos.find((p) => p.id === savedId) ?? null;
            }
          } catch {
            // Reopening on the saved frame is a convenience; failing to fetch
            // it must not take the editor down. The picker is the fallback.
          }
        }
        if (cancelled) return;
        setPhoto((current) => current ?? existing);
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [person.slug, person.face, scope, searchAll]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    try {
      const params = new URLSearchParams({ scope, cursor: nextCursor });
      if (scope === "all" && searchAll) params.set("q", searchAll);
      const res = await fetch(
        `/api/admin/people/${encodeURIComponent(person.slug)}/photos?${params}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body: ClientGalleryPage = await res.json();
      setCandidates((current) => {
        const seen = new Set(current.map((p) => p.id));
        return [...current, ...body.photos.filter((p) => !seen.has(p.id))];
      });
      setNextCursor(body.nextCursor);
    } catch {
      setLoadError(true);
    }
  }, [nextCursor, person.slug, scope, searchAll]);

  // Escape backs out one level: crop stage -> picker -> close.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (photo) setPhoto(null);
      else onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [photo, onClose]);

  const pickPhoto = useCallback(
    (candidate: ClientPhoto) => {
      setPhoto(candidate);
      setCrop(
        // Same stable-id rule as reopening: picking the photo the existing
        // face came from restores that crop rather than resetting to centre.
        person.face && candidate.id === person.face.photoId
          ? person.face.crop
          : centeredCrop(candidate.aspectRatio),
      );
      setActionError(null);
    },
    [person.face],
  );

  const saveFace = useCallback(
    async (advance: boolean) => {
      if (!photo) return;
      setSaving(true);
      setActionError(null);
      try {
        const normalized =
          normalizeFaceCrop(crop, photo.aspectRatio) ?? DEFAULT_CROP;
        const res = await fetch(
          `/api/admin/people/${encodeURIComponent(person.slug)}/face`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ photoId: photo.id, crop: normalized }),
          },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(body?.error ?? "Could not save that face.");
        }
        const preview = stagePreview(photo);
        onUpdated(person.slug, {
          faceKind: "override",
          face: preview
            ? {
                photoId: photo.id,
                url: preview.url,
                aspectRatio: photo.aspectRatio,
                crop: normalized,
              }
            : undefined,
          updatedAt: new Date().toISOString(),
        });
        if (advance) onSavedNext(person.slug);
        else onClose();
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Could not save that face.",
        );
      } finally {
        setSaving(false);
      }
    },
    [photo, crop, person.slug, onUpdated, onSavedNext, onClose],
  );

  const revertFace = useCallback(async () => {
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/admin/people/${encodeURIComponent(person.slug)}/face`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Could not revert.");
      onUpdated(person.slug, {
        faceKind: committedLikely(person) ? "committed" : "none",
        face: undefined,
        updatedAt: new Date().toISOString(),
      });
      setPhoto(null);
      setCrop(DEFAULT_CROP);
    } catch {
      setActionError("Could not revert to the automatic crop.");
    } finally {
      setSaving(false);
    }
  }, [person, onUpdated]);

  const saveName = useCallback(async () => {
    const trimmed = nameDraft.trim().replace(/\s+/g, " ");
    if (!trimmed || trimmed === person.displayName) {
      setNameDraft(person.displayName);
      return;
    }
    setActionError(null);
    try {
      // Setting the name back to the catalog spelling clears the rename.
      const payload =
        !person.added && person.catalogName === trimmed
          ? { displayName: null }
          : { displayName: trimmed };
      const res = await fetch(
        `/api/admin/people/${encodeURIComponent(person.slug)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Could not rename.");
      }
      onUpdated(person.slug, { displayName: trimmed });
    } catch (error) {
      setNameDraft(person.displayName);
      setActionError(
        error instanceof Error ? error.message : "Could not rename.",
      );
    }
  }, [nameDraft, person, onUpdated]);

  const toggleHidden = useCallback(async () => {
    setActionError(null);
    try {
      const res = await fetch(
        `/api/admin/people/${encodeURIComponent(person.slug)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hidden: !person.hidden }),
        },
      );
      if (!res.ok) throw new Error();
      onUpdated(person.slug, { hidden: !person.hidden });
    } catch {
      setActionError("Could not change visibility.");
    }
  }, [person, onUpdated]);

  const remove = useCallback(async () => {
    // Added people are real catalog identities now, so the consequence
    // depends on whether anything references them. The server makes that
    // call atomically (tags AND guest favorites, checked inside the delete
    // itself), so a delete can quietly become a hide if a reference exists
    // or lands meanwhile -- never the other way around. The zero-count copy
    // below states both outcomes because this client only knows the tag
    // count; favorites live server-side.
    const confirmMessage = !person.added
      ? `Remove ${person.displayName} from the Find me picker? Their photos and tags stay untouched, and you can undo this from the Hidden filter.`
      : person.count > 0
        ? `Remove ${person.displayName}? They are tagged in ${person.count} ${person.count === 1 ? "photo" : "photos"}, so they will be hidden from the Find me picker instead of deleted: their photos, tags, and personal page stay. To delete them entirely, untag those photos in the Catalog first. Undo from the Hidden filter.`
        : `Remove ${person.displayName}? No photos are tagged with them, so they will be deleted entirely, unless a guest has saved favorites under their name, in which case they are hidden instead so that shortlist keeps working. Either way, no photographs are affected and you can undo a hide from the Hidden filter.`;
    if (!window.confirm(confirmMessage)) {
      return;
    }
    setActionError(null);
    try {
      const res = await fetch(
        `/api/admin/people/${encodeURIComponent(person.slug)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { outcome: "deleted" | "hidden" };
      onRemoved(person.slug, body.outcome);
    } catch {
      setActionError("Could not remove that person.");
    }
  }, [person, onRemoved]);

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto p-4 sm:p-8"
      style={{ backgroundColor: "color-mix(in srgb, var(--color-ink) 42%, transparent)" }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${person.displayName}`}
        className="mx-auto flex w-full max-w-4xl flex-col gap-5 border p-5 sm:p-7"
        style={{
          borderColor: "var(--color-sand)",
          backgroundColor: "var(--color-cream)",
          borderRadius: "var(--radius-card)",
          boxShadow: "var(--shadow-soft)",
        }}
      >
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <FaceDisc person={person} sizeClass="w-12" />
            <div className="flex flex-col">
              <label className="sr-only" htmlFor="person-name">
                Display name
              </label>
              <input
                id="person-name"
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={() => void saveName()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                className="border-b bg-transparent text-lg font-semibold outline-none"
                style={{
                  color: "var(--color-ink)",
                  fontFamily: "var(--font-display)",
                  borderColor: "var(--color-wheat)",
                }}
              />
              <span
                className="text-xs"
                style={{
                  fontFamily: "var(--font-archive)",
                  color: "var(--color-muted)",
                }}
              >
                /{person.slug} · {person.count}{" "}
                {person.count === 1 ? "photo" : "photos"}
                {person.added ? " · added here" : ""}
                {person.catalogName && person.catalogName !== nameDraft.trim()
                  ? ` · catalog: ${person.catalogName}`
                  : ""}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {person.faceKind === "override" ? (
              <button
                type="button"
                onClick={() => void revertFace()}
                disabled={saving}
                className="border px-3 py-1.5 text-sm"
                style={editorButtonStyle}
              >
                Revert to automatic
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void toggleHidden()}
              className="border px-3 py-1.5 text-sm"
              style={editorButtonStyle}
            >
              {person.hidden ? "Show in Find me" : "Hide from Find me"}
            </button>
            <button
              type="button"
              onClick={() => void remove()}
              className="border px-3 py-1.5 text-sm"
              style={{ ...editorButtonStyle, color: "var(--color-coral)" }}
            >
              Remove
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="border p-1.5"
              style={editorButtonStyle}
            >
              <X aria-hidden="true" size={16} strokeWidth={1.7} />
            </button>
          </div>
        </header>

        {actionError ? (
          <p role="alert" className="text-sm" style={{ color: "var(--color-coral)" }}>
            {actionError}
          </p>
        ) : null}

        {photo ? (
          <CropStep
            photo={photo}
            crop={crop}
            onCropChange={setCrop}
            personName={nameDraft}
            saving={saving}
            onBack={() => setPhoto(null)}
            onSave={() => void saveFace(false)}
            onSaveNext={() => void saveFace(true)}
          />
        ) : (
          <CandidateStep
            person={person}
            scope={scope}
            onScopeChange={(next) => {
              setScope(next);
              setCandidates([]);
            }}
            searchAll={searchAll}
            onSearchAll={setSearchAll}
            candidates={candidates}
            loading={loading}
            loadError={loadError}
            nextCursor={nextCursor}
            onLoadMore={() => void loadMore()}
            onPick={pickPhoto}
          />
        )}
      </div>
    </div>
  );
}

const editorButtonStyle: React.CSSProperties = {
  borderColor: "var(--color-sand)",
  backgroundColor: "var(--color-white)",
  color: "var(--color-ink)",
  borderRadius: "var(--radius-card)",
};

function committedLikely(person: AdminRosterPerson): boolean {
  // The server carries the fact, so do not infer it. Guessing from the photo
  // count ("catalog person with photos probably has a crop") was wrong for
  // exactly the guests this screen exists to fix: the unresolved group has
  // photos and no committed crop, so reverting them dropped them out of
  // "Needs a face" and bumped the progress bar while the disc fell back to
  // initials, until a full reload undid the lie.
  return person.hasCommittedFace;
}


function centeredCrop(aspectRatio: number): FaceCrop {
  // Centered square over 60% of the shorter axis, nudged up: faces usually
  // sit above the geometric center of a photograph.
  const size = 0.6;
  const a = aspectRatio > 0 ? aspectRatio : 1;
  const sideOfWidth = a >= 1 ? size / a : size;
  const sideOfHeight = a >= 1 ? size : size * a;
  return (
    normalizeFaceCrop(
      {
        x: (1 - sideOfWidth) / 2,
        y: Math.max(0, (1 - sideOfHeight) / 2 - 0.06),
        size,
      },
      a,
    ) ?? DEFAULT_CROP
  );
}

// ---------------------------------------------------------------------------
// Step 1: pick the photo
// ---------------------------------------------------------------------------

function CandidateStep({
  person,
  scope,
  onScopeChange,
  searchAll,
  onSearchAll,
  candidates,
  loading,
  loadError,
  nextCursor,
  onLoadMore,
  onPick,
}: {
  person: AdminRosterPerson;
  scope: CandidateScope;
  onScopeChange: (scope: CandidateScope) => void;
  searchAll: string;
  onSearchAll: (q: string) => void;
  candidates: ClientPhoto[];
  loading: boolean;
  loadError: boolean;
  nextCursor: string | null;
  onLoadMore: () => void;
  onPick: (photo: ClientPhoto) => void;
}) {
  const [searchDraft, setSearchDraft] = useState(searchAll);

  return (
    <section aria-label="Choose a photo" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
          1. Choose the photo
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={scope === "tagged"}
            onClick={() => onScopeChange("tagged")}
            className="border px-3 py-1 text-xs"
            style={scopeButtonStyle(scope === "tagged")}
          >
            Their photos ({person.count})
          </button>
          <button
            type="button"
            aria-pressed={scope === "all"}
            onClick={() => onScopeChange("all")}
            className="border px-3 py-1 text-xs"
            style={scopeButtonStyle(scope === "all")}
          >
            All photos
          </button>
        </div>
      </div>

      {scope === "all" ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onSearchAll(searchDraft.trim());
          }}
        >
          <label
            className="flex flex-1 items-center gap-2 border px-3 py-1.5"
            style={{
              borderColor: "var(--color-sand)",
              backgroundColor: "var(--color-white)",
              borderRadius: "var(--radius-card)",
            }}
          >
            <Search aria-hidden="true" size={14} strokeWidth={1.6} />
            <span className="sr-only">Search all photos</span>
            <input
              type="search"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Search events, names, tags"
              className="w-full bg-transparent text-sm outline-none"
              style={{ color: "var(--color-ink)" }}
            />
          </label>
          <button
            type="submit"
            className="border px-3 py-1.5 text-sm"
            style={editorButtonStyle}
          >
            Search
          </button>
        </form>
      ) : null}

      {loading ? (
        <p className="py-8 text-center text-sm" style={{ color: "var(--color-muted)" }}>
          Loading photos…
        </p>
      ) : loadError ? (
        <p role="alert" className="py-8 text-center text-sm" style={{ color: "var(--color-coral)" }}>
          Could not load photos. Close and reopen to retry.
        </p>
      ) : candidates.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            {scope === "tagged"
              ? `No photos are tagged with ${person.displayName} yet.`
              : "No photos match that search."}
          </p>
          {scope === "tagged" ? (
            <button
              type="button"
              onClick={() => onScopeChange("all")}
              className="border px-3 py-1.5 text-sm"
              style={editorButtonStyle}
            >
              Browse all photos instead
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <ul
            className="grid max-h-[46vh] list-none grid-cols-3 gap-2 overflow-y-auto p-0 sm:grid-cols-5 md:grid-cols-6"
            aria-label="Candidate photos"
          >
            {candidates.map((candidate) => {
              const preview = smallestPreview(candidate);
              if (!preview) return null;
              return (
                <li key={candidate.id}>
                  <button
                    type="button"
                    onClick={() => onPick(candidate)}
                    className="block w-full overflow-hidden border-0 p-0"
                    style={{ borderRadius: "var(--radius-card)" }}
                    aria-label={`Crop a face from this ${candidate.eventName} photo`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={preview.url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="block aspect-square w-full object-cover"
                      style={{ backgroundColor: "var(--color-sand)" }}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
          {nextCursor ? (
            <button
              type="button"
              onClick={onLoadMore}
              className="self-center border px-4 py-1.5 text-sm"
              style={editorButtonStyle}
            >
              Load more
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

function scopeButtonStyle(active: boolean): React.CSSProperties {
  return {
    borderColor: active ? "var(--color-ink)" : "var(--color-sand)",
    backgroundColor: active ? "var(--color-ink)" : "var(--color-white)",
    color: active ? "var(--color-cream)" : "var(--color-ink)",
    borderRadius: "var(--radius-card)",
  };
}

function smallestPreview(photo: ClientPhoto) {
  return photo.previews[0] ?? null;
}

function stagePreview(photo: ClientPhoto) {
  // Previews are ordered small -> large; the stage wants a mid size.
  return (
    photo.previews.find((preview) => preview.width >= 960) ??
    photo.previews[photo.previews.length - 1] ??
    null
  );
}

// ---------------------------------------------------------------------------
// Step 2: frame the face
// ---------------------------------------------------------------------------

const KEY_STEP = 0.01;
const KEY_STEP_LARGE = 0.05;

/** The crop stage may take up at most this much of the viewport's height. */
export const STAGE_MAX_VIEWPORT_HEIGHT_FRACTION = 0.52;

/**
 * Sizes the crop stage so the box IS the painted photo. Every pointer
 * handler, the crop rect, the dim cutout, and the saved normalized crop all
 * compute fractions of the stage box, so any letterbox between the box and
 * the object-contain image silently skews the face that gets saved.
 *
 * A block box with `aspect-ratio` + `max-height` broke that guarantee on
 * portrait photos and short viewports: block layout stretches the width to
 * the container, and whether the max-height clamp transfers back to the
 * width is engine-dependent (Chromium shrinks the width to match; WebKit
 * keeps it stretched, leaving the photo letterboxed inside a wider box and
 * the saved crop offset from the face the admin framed).
 * Deriving the WIDTH from the same viewport cap instead -- never wider than
 * the container, never wider than the cap allows at this aspect ratio --
 * lets `aspect-ratio` produce the height, so both dimensions agree with the
 * photo by construction. Exported for the geometry regression test.
 */
export function stageBoxStyle(aspectRatio: number): React.CSSProperties {
  const a = aspectRatio > 0 ? aspectRatio : 1;
  return {
    aspectRatio: `${a}`,
    width: `min(100%, ${STAGE_MAX_VIEWPORT_HEIGHT_FRACTION * 100}vh * ${a})`,
  };
}

function CropStep({
  photo,
  crop,
  onCropChange,
  personName,
  saving,
  onBack,
  onSave,
  onSaveNext,
}: {
  photo: ClientPhoto;
  crop: FaceCrop;
  onCropChange: (crop: FaceCrop) => void;
  personName: string;
  saving: boolean;
  onBack: () => void;
  onSave: () => void;
  onSaveNext: () => void;
}) {
  const preview = stagePreview(photo);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    mode: "move" | "resize";
    startX: number;
    startY: number;
    startCrop: FaceCrop;
  } | null>(null);

  const a = photo.aspectRatio > 0 ? photo.aspectRatio : 1;
  const sideOfWidth = (size: number) => (a >= 1 ? size / a : size);
  const sideOfHeight = (size: number) => (a >= 1 ? size : size * a);

  const applyCrop = useCallback(
    (next: { x: number; y: number; size: number }) => {
      const normalized = normalizeFaceCrop(next, a);
      if (normalized) onCropChange(normalized);
    },
    [a, onCropChange],
  );

  const nudge = useCallback(
    (dx: number, dy: number) => {
      applyCrop({ x: crop.x + dx, y: crop.y + dy, size: crop.size });
    },
    [applyCrop, crop],
  );

  const resize = useCallback(
    (delta: number) => {
      // Keep the crop centered while resizing.
      const nextSize = Math.min(1, Math.max(0.05, crop.size + delta));
      const cx = crop.x + sideOfWidth(crop.size) / 2;
      const cy = crop.y + sideOfHeight(crop.size) / 2;
      applyCrop({
        x: cx - sideOfWidth(nextSize) / 2,
        y: cy - sideOfHeight(nextSize) / 2,
        size: nextSize,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applyCrop, crop, a],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>, mode: "move" | "resize",
      startCrop?: FaceCrop,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      dragRef.current = {
        pointerId: event.pointerId,
        mode,
        startX: event.clientX,
        startY: event.clientY,
        // startCrop may be pinned by the caller: a press outside the square
        // recenters it first, and `crop` in this closure is still the value
        // from before that recentre.
        startCrop: startCrop ?? crop,
      };
      stageRef.current?.setPointerCapture?.(event.pointerId);
    },
    [crop],
  );

  const onStagePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Clicking outside the crop recenters it under the pointer, then drags.
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      const fx = (event.clientX - rect.left) / rect.width;
      const fy = (event.clientY - rect.top) / rect.height;
      // Normalize here rather than relying on the state applyCrop schedules:
      // that has not committed yet when the drag starts, so the first pointer
      // move would otherwise be measured from the pre-recentre position and
      // snap the square back.
      const recentered = normalizeFaceCrop(
        {
          x: fx - sideOfWidth(crop.size) / 2,
          y: fy - sideOfHeight(crop.size) / 2,
          size: crop.size,
        },
        a,
      );
      if (recentered) onCropChange(recentered);
      onPointerDown(event, "move", recentered ?? crop);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applyCrop, crop, onPointerDown, a],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      const rect = stageRef.current?.getBoundingClientRect();
      if (!drag || drag.pointerId !== event.pointerId || !rect) return;
      const dxFrac = (event.clientX - drag.startX) / rect.width;
      const dyFrac = (event.clientY - drag.startY) / rect.height;
      if (drag.mode === "move") {
        applyCrop({
          x: drag.startCrop.x + dxFrac,
          y: drag.startCrop.y + dyFrac,
          size: drag.startCrop.size,
        });
      } else {
        // Resize from the bottom-right handle; the dominant axis wins.
        const startSideW = sideOfWidth(drag.startCrop.size);
        const growW = (dxFrac / startSideW) * drag.startCrop.size;
        const startSideH = sideOfHeight(drag.startCrop.size);
        const growH = (dyFrac / startSideH) * drag.startCrop.size;
        const nextSize = Math.min(
          1,
          Math.max(
            0.05,
            drag.startCrop.size + Math.max(growW, growH),
          ),
        );
        applyCrop({
          x: drag.startCrop.x,
          y: drag.startCrop.y,
          size: nextSize,
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applyCrop, a],
  );

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }, []);

  const onCropKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
      switch (event.key) {
        case "ArrowLeft":
          nudge(-step, 0);
          break;
        case "ArrowRight":
          nudge(step, 0);
          break;
        case "ArrowUp":
          nudge(0, -step);
          break;
        case "ArrowDown":
          nudge(0, step);
          break;
        case "+":
        case "=":
        case "]":
          resize(step);
          break;
        case "-":
        case "[":
          resize(-step);
          break;
        case "Enter":
          onSave();
          break;
        default:
          return;
      }
      event.preventDefault();
    },
    [nudge, resize, onSave],
  );

  if (!preview) {
    return (
      <p role="alert" className="text-sm" style={{ color: "var(--color-coral)" }}>
        This photo has no preview available. Pick another one.
      </p>
    );
  }

  const rectStyle: React.CSSProperties = {
    position: "absolute",
    left: `${crop.x * 100}%`,
    top: `${crop.y * 100}%`,
    width: `${sideOfWidth(crop.size) * 100}%`,
    height: `${sideOfHeight(crop.size) * 100}%`,
  };

  return (
    <section aria-label="Frame the face" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 border px-3 py-1.5 text-sm"
            style={editorButtonStyle}
          >
            <ArrowLeft aria-hidden="true" size={14} strokeWidth={1.7} />
            Different photo
          </button>
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
            2. Frame the face
          </h2>
        </div>
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
          Drag to move · corner to resize · arrows nudge · +/− resize · Enter
          saves
        </p>
      </div>

      <div className="flex flex-col items-start gap-5 md:flex-row">
        <div
          className="relative w-full min-w-0 flex-1 select-none"
          style={{ touchAction: "none" }}
        >
          <div
            ref={stageRef}
            className="relative mx-auto overflow-hidden"
            style={{
              ...stageBoxStyle(a),
              borderRadius: "var(--radius-card)",
              backgroundColor: "var(--color-sand)",
            }}
            onPointerDown={onStagePointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview.url}
              alt={`Photo from ${photo.eventName}`}
              draggable={false}
              className="block h-full w-full object-contain"
            />
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                background:
                  "color-mix(in srgb, var(--color-ink) 35%, transparent)",
                clipPath: cropCutout(crop, sideOfWidth, sideOfHeight),
              }}
            />
            <div
              role="application"
              tabIndex={0}
              aria-label={`Face crop for ${personName}. Use arrow keys to move, plus and minus to resize, Enter to save.`}
              onKeyDown={onCropKeyDown}
              onPointerDown={(event) => onPointerDown(event, "move")}
              className="cursor-move outline-offset-2 focus-visible:outline focus-visible:outline-2"
              style={{
                ...rectStyle,
                boxShadow: "0 0 0 2px var(--color-cream), 0 0 0 3px var(--color-ink)",
                borderRadius: "2px",
                outlineColor: "var(--color-coral)",
              }}
            >
              <span
                aria-hidden="true"
                onPointerDown={(event) => onPointerDown(event, "resize")}
                className="absolute -bottom-2 -right-2 block h-4 w-4 cursor-nwse-resize"
                style={{
                  backgroundColor: "var(--color-coral)",
                  border: "2px solid var(--color-cream)",
                  borderRadius: "50%",
                }}
              />
            </div>
          </div>
        </div>

        <div className="flex w-full flex-col items-center gap-3 md:w-56">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-muted)" }}>
            Find me preview
          </p>
          <span
            className="relative block w-32 overflow-hidden"
            style={{
              aspectRatio: "1",
              borderRadius: "50%",
              backgroundColor: "var(--color-wheat)",
              boxShadow: "0 0 0 1px color-mix(in srgb, var(--color-tan) 40%, transparent)",
            }}
            aria-hidden="true"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview.url}
              alt=""
              style={{
                position: "absolute",
                maxWidth: "none",
                ...faceCropCss(crop, a),
              }}
            />
          </span>
          <p className="text-xs" style={{ color: "var(--color-ink)" }}>
            {personName}
          </p>

          <div className="flex w-full items-center gap-2">
            <button
              type="button"
              onClick={() => resize(-0.05)}
              aria-label="Smaller crop"
              className="border p-1.5"
              style={editorButtonStyle}
            >
              <Minus aria-hidden="true" size={14} strokeWidth={1.7} />
            </button>
            <label className="flex-1">
              <span className="sr-only">Crop size</span>
              <input
                type="range"
                min={5}
                max={100}
                value={Math.round(crop.size * 100)}
                onChange={(event) =>
                  resize(Number(event.target.value) / 100 - crop.size)
                }
                className="w-full"
              />
            </label>
            <button
              type="button"
              onClick={() => resize(0.05)}
              aria-label="Larger crop"
              className="border p-1.5"
              style={editorButtonStyle}
            >
              <Plus aria-hidden="true" size={14} strokeWidth={1.7} />
            </button>
          </div>

          <div className="flex w-full flex-col gap-2">
            <button
              type="button"
              onClick={onSaveNext}
              disabled={saving}
              className="flex items-center justify-center gap-2 border px-4 py-2 text-sm font-medium disabled:opacity-50"
              style={{
                borderColor: "var(--color-ink)",
                backgroundColor: "var(--color-ink)",
                color: "var(--color-cream)",
                borderRadius: "var(--radius-card)",
              }}
            >
              <Check aria-hidden="true" size={15} strokeWidth={1.8} />
              {saving ? "Saving…" : "Save face & next"}
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="border px-4 py-2 text-sm disabled:opacity-50"
              style={editorButtonStyle}
            >
              Save face &amp; close
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Dim everything except the crop: an even-odd polygon that covers the stage
 * with the crop square subtracted.
 */
function cropCutout(
  crop: FaceCrop,
  sideOfWidth: (size: number) => number,
  sideOfHeight: (size: number) => number,
): string {
  const left = (crop.x * 100).toFixed(2);
  const top = (crop.y * 100).toFixed(2);
  const right = ((crop.x + sideOfWidth(crop.size)) * 100).toFixed(2);
  const bottom = ((crop.y + sideOfHeight(crop.size)) * 100).toFixed(2);
  return `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${left}% ${top}%, ${left}% ${bottom}%, ${right}% ${bottom}%, ${right}% ${top}%, ${left}% ${top}%)`;
}

// ---------------------------------------------------------------------------
// Add-person dialog
// ---------------------------------------------------------------------------

function AddPersonDialog({
  existingSlugs,
  onClose,
  onAdded,
}: {
  existingSlugs: readonly string[];
  onClose: () => void;
  onAdded: (person: AdminRosterPerson) => void;
}) {
  const [name, setName] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const effectiveSlug = slugEdited ? slug : slugifyPersonName(name);
  const collision = existingSlugs.includes(effectiveSlug);

  const submit = useCallback(async () => {
    const trimmed = name.trim().replace(/\s+/g, " ");
    if (!trimmed) {
      setError("Give them a name.");
      return;
    }
    if (!effectiveSlug) {
      setError("That name needs at least one letter or number.");
      return;
    }
    if (collision) {
      setError("Someone already uses that slug.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/people", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: trimmed, slug: effectiveSlug }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Could not add that person.");
      }
      onAdded({
        slug: effectiveSlug,
        displayName: trimmed,
        // Adding creates a real catalog row carrying this name.
        catalogName: trimmed,
        // A person who did not exist a moment ago has no committed crop.
        hasCommittedFace: false,
        count: 0,
        hidden: false,
        added: true,
        faceKind: "none",
        updatedAt: new Date().toISOString(),
      });
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not add that person.",
      );
      setBusy(false);
    }
  }, [name, effectiveSlug, collision, onAdded]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ backgroundColor: "color-mix(in srgb, var(--color-ink) 42%, transparent)" }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Add a person"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="flex w-full max-w-sm flex-col gap-4 border p-6"
        style={{
          borderColor: "var(--color-sand)",
          backgroundColor: "var(--color-cream)",
          borderRadius: "var(--radius-card)",
          boxShadow: "var(--shadow-soft)",
        }}
      >
        <div className="flex items-center justify-between">
          <h2
            className="text-lg font-semibold"
            style={{ color: "var(--color-ink)", fontFamily: "var(--font-display)" }}
          >
            Add a person
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="border p-1.5"
            style={editorButtonStyle}
          >
            <X aria-hidden="true" size={15} strokeWidth={1.7} />
          </button>
        </div>
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
          For a guest the photo pipeline never matched. They become a real
          catalog person: they appear in the Find me picker right away, and
          you can tag them into photos from the Catalog screen. Give them a
          face right after.
        </p>
        <label className="flex flex-col gap-1 text-sm" style={{ color: "var(--color-ink)" }}>
          Name
          <input
            ref={inputRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="border px-3 py-2 text-sm outline-none"
            style={{
              borderColor: "var(--color-sand)",
              backgroundColor: "var(--color-white)",
              borderRadius: "var(--radius-card)",
              color: "var(--color-ink)",
            }}
            placeholder="First Last"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm" style={{ color: "var(--color-ink)" }}>
          Slug
          <input
            value={effectiveSlug}
            onChange={(event) => {
              setSlugEdited(true);
              setSlug(slugifyPersonName(event.target.value));
            }}
            className="border px-3 py-2 text-sm outline-none"
            style={{
              borderColor: collision ? "var(--color-coral)" : "var(--color-sand)",
              backgroundColor: "var(--color-white)",
              borderRadius: "var(--radius-card)",
              color: "var(--color-ink)",
              fontFamily: "var(--font-archive)",
            }}
          />
        </label>
        {collision ? (
          <p role="alert" className="text-xs" style={{ color: "var(--color-coral)" }}>
            Someone already uses /{effectiveSlug}.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs" style={{ color: "var(--color-coral)" }}>
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="border px-4 py-2 text-sm font-medium disabled:opacity-50"
          style={{
            borderColor: "var(--color-ink)",
            backgroundColor: "var(--color-ink)",
            color: "var(--color-cream)",
            borderRadius: "var(--radius-card)",
          }}
        >
          {busy ? "Adding…" : "Add person"}
        </button>
      </form>
    </div>
  );
}
