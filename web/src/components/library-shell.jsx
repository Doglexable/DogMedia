import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBars } from "@fortawesome/free-solid-svg-icons/faBars";
import { faChartSimple } from "@fortawesome/free-solid-svg-icons/faChartSimple";
import { faDownload } from "@fortawesome/free-solid-svg-icons/faDownload";
import { faChevronDown } from "@fortawesome/free-solid-svg-icons/faChevronDown";
import { faEllipsis } from "@fortawesome/free-solid-svg-icons/faEllipsis";
import { faFolder } from "@fortawesome/free-solid-svg-icons/faFolder";
import { faFolderOpen } from "@fortawesome/free-solid-svg-icons/faFolderOpen";
import { faGear } from "@fortawesome/free-solid-svg-icons/faGear";
import { faUsers } from "@fortawesome/free-solid-svg-icons/faUsers";
import { faClapperboard } from "@fortawesome/free-solid-svg-icons/faClapperboard";
import { faPaperPlane } from "@fortawesome/free-solid-svg-icons/faPaperPlane";
import { faMobileScreenButton } from "@fortawesome/free-solid-svg-icons/faMobileScreenButton";
import { faBookmark } from "@fortawesome/free-solid-svg-icons/faBookmark";
import { faHeart } from "@fortawesome/free-solid-svg-icons/faHeart";
import { faHouse } from "@fortawesome/free-solid-svg-icons/faHouse";
import { faList } from "@fortawesome/free-solid-svg-icons/faList";
import { faPlay } from "@fortawesome/free-solid-svg-icons/faPlay";
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";
import { faCircleUser } from "@fortawesome/free-solid-svg-icons/faCircleUser";
import { ProfileModal } from "./profile-modal";
import { ThemeToggle } from "./theme-toggle";
import { Link, useLocation } from "react-router-dom";
import { api, apiUrl, categoryThumbnailUrl, profilePictureUrl, readJsonArray } from "../api";
import { SiteFooter } from "./site-footer";
import { DesktopDownload } from "./desktop-download";
import { APP_VERSION_LABEL } from "../version";
import { animateCollectionAdd, captureCollectionOrigin } from "./collection-flight";
import { NewLogoMark } from "./new-logo-mark";

const LibraryContext = createContext({ categories: [], categoriesLoading: true });
const ANDROID_APK_URL = import.meta.env.VITE_ANDROID_APK_URL || apiUrl("/api/mobile-release/download");

export function useLibrary() {
  return useContext(LibraryContext);
}

function SidebarLink({ active, children, icon, leading, onClick, onContextMenu, style, to }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      onContextMenu={onContextMenu || ((event) => event.preventDefault())}
      className={`global-sidebar-link${active ? " global-sidebar-link--active" : ""}`}
      style={style}
    >
      {leading || (icon ? <FontAwesomeIcon icon={icon} className="global-sidebar-link-icon" /> : null)}
      <span className="truncate min-w-0 flex-1">{children}</span>
    </Link>
  );
}

function CategoryContextMenu({ category, favoriteStatus, favoriteStatusLoading, menu, onAddToQueue, onClose, onFavorite, onPlay }) {
  useEffect(() => {
    if (!menu) return undefined;
    const closeOnEscape = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("click", onClose);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", onClose);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menu, onClose]);

  if (!menu || !category) return null;

  return createPortal(
    <div
      className="global-sidebar-context-menu"
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
      aria-label={`${category.name} actions`}
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="global-sidebar-context-title" title={category.path || category.name}>
        {category.name}
      </div>
      <button type="button" role="menuitem" onClick={() => onPlay(category)}>
        <FontAwesomeIcon icon={faPlay} />
        Play {category.name}
      </button>
      <button type="button" role="menuitem" onClick={(event) => onAddToQueue(category, event.currentTarget)}>
        <FontAwesomeIcon icon={faList} />
        Queue {category.name}
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={favoriteStatusLoading || !favoriteStatus || favoriteStatus.totalAudioCount === 0}
        onClick={(event) => onFavorite(category, event.currentTarget)}
      >
        <FontAwesomeIcon icon={faHeart} />
        {favoriteStatusLoading
          ? "Checking favorites…"
          : favoriteStatus?.fullyLiked
            ? `Remove ${category.name} from favorites`
            : favoriteStatus?.totalAudioCount === 0
              ? "No audio to favorite"
              : favoriteStatus
                ? `Add ${category.name} to favorites`
                : "Favorites unavailable"}
      </button>
    </div>,
    document.body
  );
}

export function CategoryIcon({ category }) {
  const [failed, setFailed] = useState(false);
  const coverPath = category?.cover_path;
  const coverUrl = coverPath ? categoryThumbnailUrl(category) : "";

  useEffect(() => {
    setFailed(false);
  }, [coverUrl]);

  return (
    <span className="global-sidebar-category-icon-slot" aria-hidden="true">
      {coverUrl && !failed ? (
        <img
          src={coverUrl}
          alt=""
          className="global-sidebar-category-thumb"
          loading="lazy"
          decoding="async"
          draggable={false}
          onContextMenu={(event) => event.preventDefault()}
          onError={() => setFailed(true)}
        />
      ) : (
        <FontAwesomeIcon icon={faFolder} className="global-sidebar-link-icon" />
      )}
    </span>
  );
}

export function CategorySidebarItem({ active, category, close, hasMedia, onOpenMenu }) {
  const paddingLeft = 12 + Math.min(Number(category.depth) || 0, 4) * 14;
  const canQueue = hasMedia ?? Number(category.media_count) > 0;
  return (
    <div
      className="global-sidebar-category-row"
      onContextMenu={(event) => {
        if (canQueue) onOpenMenu(event, category);
        else event.preventDefault();
      }}
    >
      <SidebarLink
        to={`/?category=${category.id}`}
        leading={<CategoryIcon category={category} />}
        active={active}
        onClick={close}
        style={{ paddingLeft }}
      >
        {category.name}
      </SidebarLink>
      {canQueue && (
        <button
          type="button"
          className="global-sidebar-category-actions"
          aria-label={`Open actions for ${category.name}`}
          aria-haspopup="menu"
          onClick={(event) => onOpenMenu(event, category, true)}
        >
          <FontAwesomeIcon icon={faEllipsis} />
        </button>
      )}
    </div>
  );
}

/** Bottom nav tab used only on mobile (≤640px) */
export function BottomNavTab({ active, avatarUrl, children, icon, onClick, to }) {
  const content = (
    <>
      {avatarUrl ? (
        <span className="mobile-nav-tab-avatar-wrap">
          <img
            src={avatarUrl}
            alt=""
            className="mobile-nav-tab-avatar"
            onError={(e) => {
              e.currentTarget.style.display = "none";
              if (e.currentTarget.nextSibling) e.currentTarget.nextSibling.style.display = "inline-block";
            }}
          />
          <FontAwesomeIcon icon={icon} className="mobile-nav-tab-icon" style={{ display: "none" }} />
        </span>
      ) : (
        <FontAwesomeIcon icon={icon} className="mobile-nav-tab-icon" />
      )}
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

function AndroidDownloadLink({ mobile = false }) {
  return (
    <a
      className={mobile ? "mobile-android-download" : "global-sidebar-android-download"}
      href={ANDROID_APK_URL}
      download
    >
      <span className="android-download-icon"><FontAwesomeIcon icon={faDownload} /></span>
      <span className="android-download-copy">
        <strong>Get the Android app</strong>
        <small>Downloads and offline listening</small>
      </span>
    </a>
  );
}

function AppDownloads({ mobile = false }) {
  return (
    <details className={`sidebar-app-downloads${mobile ? " sidebar-app-downloads--mobile" : ""}`}>
      <summary className="sidebar-app-downloads-toggle">
        <span className="sidebar-app-downloads-icon" aria-hidden="true"><FontAwesomeIcon icon={faDownload} /></span>
        <span className="sidebar-app-downloads-label"><strong>Get the apps</strong><small>Desktop · Android</small></span>
        <FontAwesomeIcon icon={faChevronDown} className="sidebar-app-downloads-chevron" aria-hidden="true" />
      </summary>
      <div className="sidebar-app-downloads-content">
        <DesktopDownload mobile={mobile} />
        <AndroidDownloadLink mobile={mobile} />
      </div>
    </details>
  );
}

function GlobalSidebar({ access, categories, categoriesLoading }) {
  const location = useLocation();
  const tier = access?.tier ?? 0;
  const [open, setOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [masterOpen, setMasterOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [wrappedAvailable, setWrappedAvailable] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem("wrapped_available") === "true";
    } catch {
      return false;
    }
  });
  const [categoryMenu, setCategoryMenu] = useState(null);
  const [queueNotice, setQueueNotice] = useState("");
  const [categoryFavoriteStatus, setCategoryFavoriteStatus] = useState(null);
  const favoriteStatusGeneration = useRef(0);
  const params = new URLSearchParams(location.search);
  const selectedCategory = params.get("category");
  const liked = location.pathname === "/" && params.get("view") === "liked";
  const showWrapped = wrappedAvailable || location.pathname === "/wrapped";
  const close = () => setOpen(false);
  const closeCategories = () => setCategoriesOpen(false);
  const closeMaster = () => setMasterOpen(false);
  const closeCategoryMenu = useCallback(() => setCategoryMenu(null), []);
  const allCategories = Array.isArray(categories) ? categories : [];
  const categoriesById = new Map(allCategories.map((category) => [Number(category.id), category]));
  const visibleCategoryIds = new Set();
  for (const category of allCategories) {
    if (Number(category.media_count) <= 0) continue;
    let current = category;
    while (current && !visibleCategoryIds.has(Number(current.id))) {
      visibleCategoryIds.add(Number(current.id));
      current = categoriesById.get(Number(current.parent_id));
    }
  }
  const mediaCategories = allCategories.filter((category) => visibleCategoryIds.has(Number(category.id)));

  // Close sidebar and sheet on navigation
  useEffect(() => {
    setOpen(false);
    setCategoriesOpen(false);
    setMasterOpen(false);
    setCategoryMenu(null);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!queueNotice) return undefined;
    const timeout = window.setTimeout(() => setQueueNotice(""), 3000);
    return () => window.clearTimeout(timeout);
  }, [queueNotice]);

  const refreshCategoryFavoriteStatus = useCallback(() => {
    const generation = ++favoriteStatusGeneration.current;
    return api("/api/likes/category-status")
      .then((response) => readJsonArray(response, "Could not load folder favorites"))
      .then((statuses) => {
        if (favoriteStatusGeneration.current === generation) {
          setCategoryFavoriteStatus(new Map(statuses.map((status) => [Number(status.categoryId), status])));
        }
      })
      .catch(() => {
        if (favoriteStatusGeneration.current === generation) setCategoryFavoriteStatus(new Map());
      });
  }, []);

  useEffect(() => {
    refreshCategoryFavoriteStatus();
    window.addEventListener("favorites-changed", refreshCategoryFavoriteStatus);
    return () => {
      favoriteStatusGeneration.current += 1;
      window.removeEventListener("favorites-changed", refreshCategoryFavoriteStatus);
    };
  }, [categories, refreshCategoryFavoriteStatus]);

  const openCategoryMenu = (event, category, anchorToButton = false) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const rawX = anchorToButton ? rect.right : event.clientX;
    const rawY = anchorToButton ? rect.bottom + 4 : event.clientY;
    setCategoryMenu({
      category,
      x: Math.max(8, Math.min(rawX, window.innerWidth - 210)),
      y: Math.max(8, Math.min(rawY, window.innerHeight - 156)),
    });
  };

  const addCategoryToQueue = (category, sourceElement) => {
    const origin = captureCollectionOrigin(sourceElement);
    closeCategoryMenu();
    api(`/api/queue/items/category/${Number(category.id)}`, { method: "POST" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not add folder to queue");
        window.dispatchEvent(new CustomEvent("queue-changed", { detail: data }));
        const count = Number(data?.addedCount) || 0;
        if (count > 0) animateCollectionAdd("queue", origin, category, { category: true });
        setQueueNotice(count > 0
          ? `${count} track${count === 1 ? "" : "s"} from “${category.name}” added to queue.`
          : `All tracks from “${category.name}” are already in the queue.`);
        return data;
      })
      .catch((error) => setQueueNotice(error.message || "Could not add folder to queue."));
  };

  const favoriteCategory = (category, sourceElement) => {
    const origin = captureCollectionOrigin(sourceElement);
    const isFavorite = categoryFavoriteStatus?.get(Number(category.id))?.fullyLiked === true;
    closeCategoryMenu();
    api(`/api/likes/category/${Number(category.id)}`, { method: isFavorite ? "DELETE" : "PUT" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || (isFavorite ? "Could not remove folder from favorites" : "Could not favorite folder"));
        window.dispatchEvent(new CustomEvent("favorites-changed", { detail: data }));
        if (isFavorite) {
          const removed = Number(data?.removedCount) || 0;
          setQueueNotice(removed > 0
            ? `${removed} track${removed === 1 ? "" : "s"} from “${category.name}” removed from favorites.`
            : `No tracks from “${category.name}” were in favorites.`);
          return data;
        }
        const added = Number(data?.addedCount) || 0;
        const total = Number(data?.totalCount) || 0;
        if (added > 0) animateCollectionAdd("favorites", origin, category, { category: true });
        setQueueNotice(added > 0
          ? `${added} track${added === 1 ? "" : "s"} from “${category.name}” added to favorites.`
          : `All ${total} tracks from “${category.name}” are already in favorites.`);
        return data;
      })
      .catch((error) => setQueueNotice(error.message || "Could not update folder favorites."));
  };

  const playCategory = (category) => {
    closeCategoryMenu();
    api(`/api/queue/auto/${Number(category.id)}?compact=1`, { method: "POST" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not play folder");
        const mediaId = Number(data?.currentMediaId);
        if (!Number.isFinite(mediaId) || mediaId < 1) {
          throw new Error("No playable media in this folder");
        }
        window.dispatchEvent(new CustomEvent("queue-changed", { detail: data }));
        window.dispatchEvent(new CustomEvent("play-folder-media", {
          detail: { mediaId, categoryId: Number(category.id) },
        }));
        setQueueNotice(`Playing “${category.name}”.`);
        return data;
      })
      .catch((error) => setQueueNotice(error.message || "Could not play folder."));
  };

  const loadWrappedAccess = useCallback(() => {
    return api("/api/wrapped/access")
      .then((response) => {
        if (!response.ok) throw new Error("Wrapped access request failed");
        return response.json();
      })
      .then((status) => {
        const available = status?.available !== false;
        try {
          sessionStorage.setItem("wrapped_available", String(available));
        } catch {
          // ignore storage failure
        }
        setWrappedAvailable(available);
      })
      .catch(() => setWrappedAvailable(false));
  }, []);

  useEffect(() => {
    loadWrappedAccess();
    window.addEventListener("wrapped-access-changed", loadWrappedAccess);
    return () => window.removeEventListener("wrapped-access-changed", loadWrappedAccess);
  }, [loadWrappedAccess]);

  return (
    <>
      {/* ── Hamburger toggle (tablet 641–900px only, hidden on mobile) ── */}
      {!open && (
        <button
          type="button"
          className="global-sidebar-toggle"
          aria-label="Open navigation"
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          <FontAwesomeIcon icon={faBars} />
        </button>
      )}

      {/* ── Backdrop ── */}
      {(open || categoriesOpen || masterOpen) && (
        <button
          type="button"
          className="global-sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => {
            close();
            closeCategories();
            closeMaster();
          }}
        />
      )}

      {/* ── Main sidebar (desktop always visible, tablet slide-out) ── */}
      <aside className={`global-sidebar${open ? " global-sidebar--open" : ""}`} aria-label="Library navigation">
        <div className="global-sidebar-header">
          <Link to="/" className="global-sidebar-brand" onClick={close}>
            <span className="min-w-0">
              <NewLogoMark className="global-sidebar-brand-logo" />
              <small title="Your media. Your space. Your story. Your rhythm.">Your media. Your space. Your story. Your rhythm.</small>
            </span>
          </Link>
          <button
            type="button"
            className="global-sidebar-close"
            aria-label="Close navigation"
            onClick={close}
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <nav className="global-sidebar-nav" aria-label="Main navigation">
          <SidebarLink to="/" icon={faHouse} active={location.pathname === "/" && !liked && !selectedCategory} onClick={close}>All media</SidebarLink>
          <SidebarLink to="/?view=liked" icon={faBookmark} active={liked} onClick={close}>Favorites</SidebarLink>
          {showWrapped && <SidebarLink to="/wrapped" icon={faChartSimple} active={location.pathname === "/wrapped"} onClick={close}>Wrapped</SidebarLink>}
          {tier < 100 && <SidebarLink to="/request-media" icon={faPaperPlane} active={location.pathname === "/request-media"} onClick={close}>Request Media</SidebarLink>}
        </nav>

        {tier >= 100 && <div className="global-sidebar-master">
          <div className="global-sidebar-heading">Master</div>
          <nav aria-label="Master navigation">
            <SidebarLink to="/admin/users" icon={faUsers} active={location.pathname === "/admin/users"} onClick={close}>Users</SidebarLink>
            <SidebarLink to="/admin/media" icon={faClapperboard} active={location.pathname === "/admin/media" || location.pathname === "/admin"} onClick={close}>Medias</SidebarLink>
            <SidebarLink to="/request-media" icon={faPaperPlane} active={location.pathname === "/request-media"} onClick={close}>Request Media</SidebarLink>
          </nav>
          <nav aria-label="App distribution">
            <SidebarLink to="/admin/android-upload" icon={faMobileScreenButton} active={location.pathname === "/admin/android-upload"} onClick={close}>Upload Android</SidebarLink>
          </nav>
        </div>}

        <div className="global-sidebar-section">
          <div className="global-sidebar-heading">Categories</div>
          <nav className="global-sidebar-categories" aria-label="Media categories">
            {categoriesLoading ? (
              Array.from({ length: 5 }, (_, index) => <span key={index} className="global-sidebar-category-skeleton skeleton-shimmer" />)
            ) : mediaCategories.length > 0 ? (
              mediaCategories.map((category) => (
                <CategorySidebarItem
                  key={category.id}
                  category={category}
                  hasMedia
                  active={String(category.id) === selectedCategory}
                  close={close}
                  onOpenMenu={openCategoryMenu}
                />
              ))
            ) : (
              <p className="global-sidebar-empty">No media categories available.</p>
            )}
          </nav>
        </div>

        {/* Sidebar footer: profile & theme */}
        <div className="global-sidebar-footer">
          <AppDownloads />
          <button
            type="button"
            className="global-sidebar-profile-btn"
            onClick={() => {
              close();
              setProfileOpen(true);
            }}
            aria-label="Open profile modal"
          >
            <span className="global-sidebar-profile-avatar">
              <img
                src={profilePictureUrl(access?.profile_picture || access?.user?.profile_picture || "fine", "s")}
                alt=""
                className="global-sidebar-profile-avatar-img"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                  if (e.currentTarget.nextSibling) e.currentTarget.nextSibling.style.display = "inline-block";
                }}
              />
              <FontAwesomeIcon icon={faCircleUser} style={{ display: "none" }} />
            </span>
            <span className="global-sidebar-profile-info">
              <strong className="global-sidebar-profile-name">{access?.username || "Account"}</strong>
              <small className="global-sidebar-profile-tier">{access?.description || (tier >= 100 ? "Administrator" : "Standard User")}</small>
            </span>
          </button>
          <ThemeToggle className="global-sidebar-theme-btn" />
          <div className="global-sidebar-version" title={`Dogmedia Web ${APP_VERSION_LABEL}`}>
            <span>Web Client</span>
            <span className="global-sidebar-version-badge">{APP_VERSION_LABEL}</span>
          </div>
        </div>
      </aside>

      {/* ── Mobile bottom navigation bar (≤640px) ── */}
      <nav className="mobile-nav-bar" aria-label="Mobile navigation">
        <BottomNavTab to="/" icon={faHouse} active={location.pathname === "/" && !liked && !selectedCategory}>Home</BottomNavTab>
        <BottomNavTab to="/?view=liked" icon={faBookmark} active={liked}>Favorites</BottomNavTab>
        {showWrapped && <BottomNavTab to="/wrapped" icon={faChartSimple} active={location.pathname === "/wrapped"}>Wrapped</BottomNavTab>}

        {/* Categories sheet trigger */}
        <BottomNavTab
          icon={categoriesOpen ? faFolderOpen : faFolder}
          active={!!selectedCategory || categoriesOpen}
          onClick={() => { closeMaster(); setCategoriesOpen((v) => !v); }}
        >
          Browse
        </BottomNavTab>

        {tier >= 100 ? <BottomNavTab icon={faGear} active={masterOpen || location.pathname.startsWith("/admin") || location.pathname === "/request-media"} onClick={() => { closeCategories(); setMasterOpen((value) => !value); }}>Master</BottomNavTab>
          : <BottomNavTab to="/request-media" icon={faPaperPlane} active={location.pathname === "/request-media"}>Request</BottomNavTab>}

        <BottomNavTab
          avatarUrl={profilePictureUrl(access?.profile_picture || access?.user?.profile_picture || "fine", "s")}
          icon={faCircleUser}
          active={profileOpen}
          onClick={() => {
            closeCategories();
            closeMaster();
            setProfileOpen(true);
          }}
        >
          Profile
        </BottomNavTab>

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
          <AppDownloads mobile />
          {categoriesLoading ? (
            Array.from({ length: 6 }, (_, index) => (
              <span key={index} className="global-sidebar-category-skeleton skeleton-shimmer" style={{ margin: "4px 0", borderRadius: 10, height: 40 }} />
            ))
          ) : mediaCategories.length > 0 ? (
            mediaCategories.map((category) => (
              <CategorySidebarItem
                key={category.id}
                category={category}
                hasMedia
                active={String(category.id) === selectedCategory}
                close={closeCategories}
                onOpenMenu={openCategoryMenu}
              />
            ))
          ) : (
            <p className="global-sidebar-empty">No media categories available.</p>
          )}
          <div className="mobile-categories-version" title={`Dogmedia Web ${APP_VERSION_LABEL}`}>
            <span>Dogmedia Web</span>
            <span className="global-sidebar-version-badge">{APP_VERSION_LABEL}</span>
          </div>
        </nav>
      </div>
      {tier >= 100 && <div className={`mobile-categories-sheet${masterOpen ? " mobile-categories-sheet--open" : ""}`} aria-label="Master menu" aria-hidden={!masterOpen}>
        <div className="mobile-categories-sheet-handle" />
        <div className="mobile-categories-sheet-header"><span className="mobile-categories-sheet-title">Master</span><button type="button" className="mobile-categories-sheet-close" aria-label="Close master menu" onClick={closeMaster}><FontAwesomeIcon icon={faXmark} /></button></div>
        <nav className="mobile-categories-sheet-body" aria-label="Master navigation">
          <SidebarLink to="/admin/users" icon={faUsers} active={location.pathname === "/admin/users"} onClick={closeMaster}>Users</SidebarLink>
          <SidebarLink to="/admin/media" icon={faClapperboard} active={location.pathname === "/admin/media"} onClick={closeMaster}>Medias</SidebarLink>
          <SidebarLink to="/request-media" icon={faPaperPlane} active={location.pathname === "/request-media"} onClick={closeMaster}>Request Media</SidebarLink>
          <div className="mobile-master-links"><div className="global-sidebar-heading">App distribution</div><SidebarLink to="/admin/android-upload" icon={faMobileScreenButton} active={location.pathname === "/admin/android-upload"} onClick={closeMaster}>Upload Android</SidebarLink></div>
        </nav>
      </div>}
      <CategoryContextMenu
        category={categoryMenu?.category}
        favoriteStatus={categoryFavoriteStatus?.get(Number(categoryMenu?.category?.id))}
        favoriteStatusLoading={categoryFavoriteStatus === null}
        menu={categoryMenu}
        onAddToQueue={addCategoryToQueue}
        onClose={closeCategoryMenu}
        onFavorite={favoriteCategory}
        onPlay={playCategory}
      />
      <ProfileModal
        isOpen={profileOpen}
        onClose={() => setProfileOpen(false)}
        access={access}
      />
      {queueNotice && <div className="global-sidebar-queue-notice" role="status">{queueNotice}</div>}
    </>
  );
}

export function LibraryShell({ access, children }) {
  const location = useLocation();
  const [categories, setCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const isFullPlayerRoute = /^\/media\/[^/]+$/.test(location.pathname);
  const isImmersiveRoute = isFullPlayerRoute || location.pathname === "/wrapped";

  const loadCategories = useCallback(() => {
    setCategoriesLoading(true);
    return api("/api/categories")
      .then((response) => readJsonArray(response, "Could not load categories"))
      .then((nextCategories) => {
        setCategories(nextCategories);
        return nextCategories;
      })
      .catch(() => {
        setCategories([]);
        return null;
      })
      .finally(() => setCategoriesLoading(false));
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  return (
    <LibraryContext.Provider value={{ categories, categoriesLoading, refreshCategories: loadCategories }}>
      <div className={isImmersiveRoute ? "global-app-shell global-app-shell--fullscreen-player" : "global-app-shell"}>
        {!isImmersiveRoute && <GlobalSidebar access={access} categories={categories} categoriesLoading={categoriesLoading} />}
        <div className="global-app-content">
          <div className="global-app-main-area">
            {children}
          </div>
          {!isImmersiveRoute && <SiteFooter access={access} />}
        </div>
      </div>
    </LibraryContext.Provider>
  );
}
