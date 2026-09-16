export const MEDIA_TYPE_OPTIONS = [
  { id: "all", label: "All" },
  { id: "audio", label: "Music" },
  { id: "video", label: "Video" },
  { id: "photo", label: "Photo" },
];

export function MediaTypePills({ value = "all", onChange }) {
  const current = value || "all";

  const handleSelect = (id) => {
    if (current === id && id !== "all") {
      onChange?.("all");
    } else {
      onChange?.(id);
    }
  };

  return (
    <div
      className="media-type-pills"
      role="tablist"
      aria-label="Filter media by type"
    >
      {MEDIA_TYPE_OPTIONS.map((option) => {
        const active = current === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`media-type-pill${active ? " media-type-pill--active" : ""}`}
            onClick={() => handleSelect(option.id)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export default MediaTypePills;
