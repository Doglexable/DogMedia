import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBars,
  faChartSimple,
  faFolder,
  faFolderOpen,
  faGear,
  faHeart,
  faHouse,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { ThemeToggle } from "../App";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api";

const LibraryContext = createContext({ categories: [], categoriesLoading: true });

export function useLibrary() {
  return useContext(LibraryContext);
}

function SidebarLink({ active, children, icon, onClick, style, to }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className={`global-sidebar-link${active ? " global-sidebar-link--active" : ""}`}
      style={style}
    >
      <FontAwesomeIcon icon={icon} className="global-sidebar-link-icon" />
      <span className="truncate">{children}</span>
    </Link>
  );
}

/** Bottom nav tab used only on mobile (≤640px) */
function BottomNavTab({ active, children, icon, onClick, to }) {
  const content = (
    <>
      <FontAwesomeIcon icon={icon} className="mobile-nav-tab-icon" />
      <span className="mobile-nav-tab-label">{children}</span>
    </>
  );
  if (onClick && !to) {
    return (
      <button
        type="button"
        className={`mobile-nav-tab${active ? " mobile-nav-tab--active" : ""}`}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }
  return (
    <Link
      to={to}
      className={`mobile-nav-tab${active ? " mobile-nav-tab--active" : ""}`}
      onClick={onClick}
    >
      {content}
    </Link>
  );
}

function GlobalSidebar({ categories, categoriesLoading, tier }) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const params = new URLSearchParams(location.search);
  const selectedCategory = params.get("category");
  const liked = location.pathname === "/" && params.get("view") === "liked";
  const close = () => setOpen(false);
  const closeCategories = () => setCategoriesOpen(false);

  // Close sidebar and sheet on navigation
  useEffect(() => {
    setOpen(false);
    setCategoriesOpen(false);
  }, [location.pathname, location.search]);

  return (
    <>
      {/* ── Hamburger toggle (tablet 641–900px only, hidden on mobile) ── */}
      <button
        type="button"
        className="global-sidebar-toggle"
        aria-label={open ? "Close navigation" : "Open navigation"}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <FontAwesomeIcon icon={open ? faXmark : faBars} />
      </button>

      {/* ── Backdrop ── */}
      {(open || categoriesOpen) && (
        <button
          type="button"
          className="global-sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => {
            close();
            closeCategories();
          }}
        />
      )}

      {/* ── Main sidebar (desktop always visible, tablet slide-out) ── */}
      <aside className={`global-sidebar${open ? " global-sidebar--open" : ""}`} aria-label="Library navigation">
        <Link to="/" className="global-sidebar-brand" onClick={close}>
          <img
            src="/android-chrome-192x192.png"
            alt=""
            className="global-sidebar-brand-mark"
            width="42"
            height="42"
            aria-hidden="true"
          />
          <span className="min-w-0">
            <strong>DogMedia</strong>
            <small>Media library</small>
          </span>
        </Link>

        <nav className="global-sidebar-nav" aria-label="Main navigation">
          <SidebarLink to="/" icon={faHouse} active={location.pathname === "/" && !liked && !selectedCategory} onClick={close}>All media</SidebarLink>
          <SidebarLink to="/?view=liked" icon={faHeart} active={liked} onClick={close}>Liked music</SidebarLink>
          <SidebarLink to="/wrapped" icon={faChartSimple} active={location.pathname === "/wrapped"} onClick={close}>Wrapped</SidebarLink>
          {tier >= 100 && <SidebarLink to="/admin" icon={faGear} active={location.pathname === "/admin"} onClick={close}>Admin</SidebarLink>}
        </nav>

        <div className="global-sidebar-section">
          <div className="global-sidebar-heading">Categories</div>
          <nav className="global-sidebar-categories" aria-label="Media categories">
            {categoriesLoading ? (
              Array.from({ length: 5 }, (_, index) => <span key={index} className="global-sidebar-category-skeleton skeleton-shimmer" />)
            ) : categories.length > 0 ? (
              categories.map((category) => (
                <SidebarLink
                  key={category.id}
                  to={`/?category=${category.id}`}
                  icon={faFolder}
                  active={String(category.id) === selectedCategory}
                  onClick={close}
                  style={{ paddingLeft: 12 + Math.min(Number(category.depth) || 0, 4) * 14 }}
                >
                  {category.name}
                </SidebarLink>
              ))
            ) : (
              <p className="global-sidebar-empty">No categories available.</p>
            )}
          </nav>
        </div>

        {/* Sidebar footer: theme toggle */}
        <div className="global-sidebar-footer">
          <ThemeToggle className="global-sidebar-theme-btn" />
        </div>
      </aside>

      {/* ── Mobile bottom navigation bar (≤640px) ── */}
      <nav className="mobile-nav-bar" aria-label="Mobile navigation">
        <BottomNavTab to="/" icon={faHouse} active={location.pathname === "/" && !liked && !selectedCategory}>Home</BottomNavTab>
        <BottomNavTab to="/?view=liked" icon={faHeart} active={liked}>Liked</BottomNavTab>
        <BottomNavTab to="/wrapped" icon={faChartSimple} active={location.pathname === "/wrapped"}>Wrapped</BottomNavTab>

        {/* Categories sheet trigger */}
        <BottomNavTab
          icon={categoriesOpen ? faFolderOpen : faFolder}
          active={!!selectedCategory || categoriesOpen}
          onClick={() => setCategoriesOpen((v) => !v)}
        >
          Browse
        </BottomNavTab>

        {tier >= 100 && (
          <BottomNavTab to="/admin" icon={faGear} active={location.pathname === "/admin"}>Admin</BottomNavTab>
        )}

        {/* Theme toggle as last tab on mobile */}
        <ThemeToggle className="mobile-nav-tab mobile-nav-theme-tab" />
      </nav>

      {/* ── Categories bottom sheet (mobile only) ── */}
      <div
        className={`mobile-categories-sheet${categoriesOpen ? " mobile-categories-sheet--open" : ""}`}
        aria-label="Browse categories"
        aria-hidden={!categoriesOpen}
      >
        <div className="mobile-categories-sheet-handle" />
        <div className="mobile-categories-sheet-header">
          <span className="mobile-categories-sheet-title">Browse Categories</span>
          <button
            type="button"
            className="mobile-categories-sheet-close"
            aria-label="Close categories"
            onClick={closeCategories}
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
        <nav className="mobile-categories-sheet-body" aria-label="Media categories">
          {categoriesLoading ? (
            Array.from({ length: 6 }, (_, index) => (
              <span key={index} className="global-sidebar-category-skeleton skeleton-shimmer" style={{ margin: "4px 0", borderRadius: 10, height: 40 }} />
            ))
          ) : categories.length > 0 ? (
            categories.map((category) => (
              <SidebarLink
                key={category.id}
                to={`/?category=${category.id}`}
                icon={faFolder}
                active={String(category.id) === selectedCategory}
                onClick={closeCategories}
                style={{ paddingLeft: 12 + Math.min(Number(category.depth) || 0, 4) * 14 }}
              >
                {category.name}
              </SidebarLink>
            ))
          ) : (
            <p className="global-sidebar-empty">No categories available.</p>
          )}
        </nav>
      </div>
    </>
  );
}

export function LibraryShell({ children, tier }) {
  const [categories, setCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);

  const loadCategories = useCallback(() => {
    setCategoriesLoading(true);
    return api("/api/categories")
      .then((response) => response.json())
      .then(setCategories)
      .catch(() => setCategories([]))
      .finally(() => setCategoriesLoading(false));
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  return (
    <LibraryContext.Provider value={{ categories, categoriesLoading, refreshCategories: loadCategories }}>
      <div className="global-app-shell">
        <GlobalSidebar categories={categories} categoriesLoading={categoriesLoading} tier={tier} />
        <div className="global-app-content">{children}</div>
      </div>
    </LibraryContext.Provider>
  );
}
