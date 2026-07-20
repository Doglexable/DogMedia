import { faMagnifyingGlass, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

export function MediaSearch({ onChange, onClear, placeholder, value }) {
  return (
    <div className="relative w-full" role="search">
      <label htmlFor="media-search" className="sr-only">Search media</label>
      <FontAwesomeIcon
        icon={faMagnifyingGlass}
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted"
      />
      <input
        id="media-search"
        type="search"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) onClear();
        }}
        className="h-10 w-full rounded-xl border border-card-border bg-surface py-2 pl-10 pr-10 text-sm text-content outline-none transition-colors placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear media search"
          title="Clear search"
          onClick={onClear}
          className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg border-0 bg-transparent text-muted transition-colors hover:bg-card hover:text-content focus-visible:outline-2 focus-visible:outline-primary"
        >
          <FontAwesomeIcon icon={faXmark} />
        </button>
      )}
    </div>
  );
}
