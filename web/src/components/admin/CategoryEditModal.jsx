import { useEffect, useState } from "react";

const modalStyles = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 600,
    background: "var(--modal-overlay)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  modal: {
    width: "100%",
    maxWidth: 720,
    background: "var(--modal-bg)",
    color: "var(--modal-text)",
    borderRadius: 18,
    border: "1px solid var(--card-border)",
    boxShadow: "var(--modal-shadow)",
    overflow: "hidden",
    maxHeight: "92vh",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    padding: "18px 20px",
    borderBottom: "1px solid var(--card-border)",
  },
  title: { margin: 0, fontSize: 18, fontWeight: 800 },
  subtitle: { margin: "4px 0 0", fontSize: 12, color: "var(--muted)" },
  close: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid var(--card-border)",
    background: "var(--bg)",
    color: "var(--text)",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 13,
    fontFamily: "inherit",
  },
  body: { padding: 18, overflowY: "auto" },
  fieldGroup: { marginBottom: 14 },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    color: "var(--muted)",
    marginBottom: 6,
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid var(--card-border)",
    borderRadius: 10,
    background: "var(--bg)",
    color: "var(--text)",
    fontSize: 14,
    boxSizing: "border-box",
    outline: "none",
    fontFamily: "inherit",
  },
  textarea: {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid var(--card-border)",
    borderRadius: 10,
    background: "var(--bg)",
    color: "var(--text)",
    fontSize: 14,
    boxSizing: "border-box",
    outline: "none",
    resize: "vertical",
    minHeight: 84,
    fontFamily: "inherit",
  },
  select: {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid var(--card-border)",
    borderRadius: 10,
    background: "var(--bg)",
    color: "var(--text)",
    fontSize: 14,
    boxSizing: "border-box",
    outline: "none",
    cursor: "pointer",
    fontFamily: "inherit",
  },
  fileInput: {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid var(--card-border)",
    borderRadius: 10,
    background: "var(--bg)",
    color: "var(--text)",
    fontSize: 14,
    boxSizing: "border-box",
    cursor: "pointer",
    fontFamily: "inherit",
  },
  helpText: { marginTop: 6, fontSize: 11, color: "var(--muted)", lineHeight: 1.4 },
  actions: { display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 },
  button: (variant = "primary", disabled = false) => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "10px 14px",
    borderRadius: 10,
    background: variant === "primary" ? (disabled ? "var(--card-border)" : "var(--primary)") : (disabled ? "var(--bg)" : "var(--card-bg)"),
    color: variant === "primary" ? (disabled ? "var(--muted)" : "#fff") : (disabled ? "var(--muted)" : "var(--text)"),
    border: variant === "primary" ? "1px solid transparent" : "1px solid var(--card-border)",
    fontWeight: 700,
    fontSize: "var(--fs-sm)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.7 : 1,
    fontFamily: "inherit",
  }),
  error: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid var(--warning-border)",
    background: "var(--warning-bg)",
    color: "var(--warning-text)",
    fontSize: 13,
    marginBottom: 14,
  },
  spinner: {
    width: 14,
    height: 14,
    border: "2px solid rgba(255,255,255,0.4)",
    borderTopColor: "#fff",
    borderRadius: "50%",
    animation: "spin 0.7s linear infinite",
    display: "inline-block",
  },
};

export default function CategoryEditModal({ isOpen, category = null, categories = [], onClose, onSave }) {
  const isEditing = Boolean(category && category.id && !category.isChild && !category.isNew);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parentId, setParentId] = useState("");
  const [minAccessTier, setMinAccessTier] = useState("0");
  const [coverFile, setCoverFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;

    if (isEditing) {
      setName(category.name || "");
      setDescription(category.description || "");
      setParentId(category.parent_id == null ? "" : String(category.parent_id));
      setMinAccessTier(category.min_access_tier != null ? String(category.min_access_tier) : "0");
    } else {
      const initialParentId = category?.parentId != null
        ? String(category.parentId)
        : category?.parent_id != null
          ? String(category.parent_id)
          : category?.id != null && category.isChild
            ? String(category.id)
            : "";
      const parent = initialParentId
        ? categories.find((c) => String(c.id) === String(initialParentId))
        : null;

      setName("");
      setDescription("");
      setParentId(initialParentId);
      setMinAccessTier(parent?.min_access_tier != null ? String(parent.min_access_tier) : "0");
    }

    setCoverFile(null);
    setError(null);
    setSaving(false);
  }, [category, categories, isEditing, isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, saving]);

  if (!isOpen) return null;

  const parentCategory = parentId
    ? categories.find((c) => String(c.id) === String(parentId))
    : null;

  const handleParentChange = (nextParentId) => {
    setParentId(nextParentId);
    const parent = nextParentId
      ? categories.find((c) => String(c.id) === String(nextParentId))
      : null;
    if (parent) {
      setMinAccessTier(String(parent.min_access_tier ?? 0));
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("Category name is required.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave({
        id: isEditing ? category.id : null,
        name: name.trim(),
        description: description.trim(),
        parentId: parentId ? Number.parseInt(parentId, 10) : null,
        minAccessTier: Number.parseInt(minAccessTier, 10) || 0,
        coverFile,
      });
      onClose();
    } catch (err) {
      setError(err.message || "Failed to save category");
    } finally {
      setSaving(false);
    }
  };

  const title = isEditing
    ? "Edit Category"
    : parentId
      ? "Add Child Category"
      : "Add Category";

  const subtitle = isEditing
    ? `Update settings for ${category?.name || "the category"}.`
    : parentCategory
      ? `Create a nested category beneath ${parentCategory.path || parentCategory.name}.`
      : "Create a new root category for the tree.";

  return (
    <div className="admin-modal-overlay premium-modal-overlay" style={modalStyles.overlay} onClick={saving ? undefined : onClose}>
      <div
        className="admin-modal premium-modal"
        style={modalStyles.modal}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admin-modal-header" style={modalStyles.header}>
          <div>
            <h2 style={modalStyles.title}>{title}</h2>
            <p style={modalStyles.subtitle}>{subtitle}</p>
          </div>
          <button type="button" style={modalStyles.close} disabled={saving} onClick={onClose}>
            Close
          </button>
        </div>

        <div className="admin-modal-body" style={modalStyles.body}>
          {error && <div style={modalStyles.error}>{error}</div>}

          <form onSubmit={handleSubmit}>
            <div style={modalStyles.fieldGroup}>
              <label style={modalStyles.label}>Name</label>
              <input
                style={modalStyles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Music"
                disabled={saving}
              />
            </div>

            <div style={modalStyles.fieldGroup}>
              <label style={modalStyles.label}>
                Description <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span>
              </label>
              <textarea
                style={modalStyles.textarea}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A short description for this branch..."
                disabled={saving}
              />
            </div>

            <div style={modalStyles.fieldGroup}>
              <label style={modalStyles.label}>Parent Category</label>
              <select
                style={modalStyles.select}
                value={parentId}
                onChange={(e) => handleParentChange(e.target.value)}
                disabled={saving}
              >
                <option value="">No parent (root)</option>
                {categories
                  .filter((c) => !isEditing || String(c.id) !== String(category?.id))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.path || c.name}
                    </option>
                  ))}
              </select>
            </div>

            <div style={modalStyles.fieldGroup}>
              <label style={modalStyles.label}>Minimum Access Tier</label>
              {parentId ? (
                <div
                  style={{
                    ...modalStyles.input,
                    minHeight: 42,
                    display: "flex",
                    alignItems: "center",
                    background: "var(--card-bg)",
                    color: "var(--muted)",
                  }}
                >
                  Tier {minAccessTier}
                </div>
              ) : (
                <input
                  type="number"
                  min="0"
                  style={modalStyles.input}
                  value={minAccessTier}
                  onChange={(e) => setMinAccessTier(e.target.value)}
                  disabled={saving}
                />
              )}
              <p style={modalStyles.helpText}>
                {parentId
                  ? "Child categories always inherit the minimum access tier from their parent."
                  : "Only users at this tier or higher can see the branch below this category."}
              </p>
            </div>

            <div style={modalStyles.fieldGroup}>
              <label style={modalStyles.label}>
                Folder Artwork <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span>
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setCoverFile(e.target.files[0] || null)}
                style={modalStyles.fileInput}
                disabled={saving}
              />
              <p style={modalStyles.helpText}>Optionally attach artwork for this folder.</p>
            </div>

            <div style={modalStyles.actions}>
              <button
                type="button"
                style={modalStyles.button("secondary", saving)}
                disabled={saving}
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                style={modalStyles.button("primary", saving)}
              >
                {saving && <span style={modalStyles.spinner} />}
                {saving ? "Saving..." : isEditing ? "Save Changes" : "Create Category"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
