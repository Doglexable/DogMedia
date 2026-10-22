import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfileModal } from "./profile-modal";

describe("ProfileModal", () => {
  it("renders nothing when isOpen is false", () => {
    const markup = renderToStaticMarkup(
      <ProfileModal isOpen={false} onClose={() => {}} access={{ username: "tester", tier: 0 }} />
    );
    expect(markup).toBe("");
  });

  it("renders the profile modal dialog with user info, collapsible sections, and actions when isOpen is true", () => {
    const markup = renderToStaticMarkup(
      <ProfileModal
        isOpen={true}
        onClose={() => {}}
        access={{ username: "alice", tier: 100, profile_picture: "fine" }}
      />
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("Profile</h2>");
    expect(markup).toContain("alice</strong>");
    expect(markup).toContain("Administrator</span>");
    expect(markup).toContain('class="profile-modal-avatar-preview-img"');
    expect(markup).toContain('src="/api/profile-pictures/fine?size=l"');
    expect(markup).toContain('id="profile-username"');
    expect(markup).toContain('value="alice"');
    expect(markup).toContain("Profile Picture &amp; Credits</strong>");
    expect(markup).toContain("Active: fine");
    expect(markup).toContain("Change Password</strong>");
    expect(markup).toContain(">Update user</button>");
    expect(markup).toContain(">Batal</button>");
    expect(markup).toContain("profile-modal-logout-section");
    expect(markup).toContain(">Log out</span></button>");
  });

  it("shows Standard User badge for tier < 100 and uses custom avatar when provided", () => {
    const markup = renderToStaticMarkup(
      <ProfileModal
        isOpen={true}
        onClose={() => {}}
        access={{ username: "bob", tier: 0, profile_picture: "scared" }}
      />
    );

    expect(markup).toContain("bob</strong>");
    expect(markup).toContain("Standard User</span>");
    expect(markup).toContain('src="/api/profile-pictures/scared?size=l"');
    expect(markup).toContain("Active: scared");
  });
});
