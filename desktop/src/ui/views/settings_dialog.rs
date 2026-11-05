use dioxus_native::prelude::*;

use super::super::*;
use super::EqualizerPanel;
use crate::playback::PlaybackEngine;
use crate::store::EqSettings;

#[cfg(test)]
thread_local! {
    static TEST_SETTINGS_TAB: std::cell::Cell<Option<Signal<u8>>> = const { std::cell::Cell::new(None) };
}

#[component]
pub(crate) fn SettingsDialog(
    app: Signal<NativeApp>,
    #[props(default)] engine: Option<Signal<Option<PlaybackEngine>>>,
) -> Element {
    let snapshot = app.read();
    let can_close = snapshot.settings.configured && !snapshot.settings_connecting;
    let url_changed = snapshot.settings_url.trim().trim_end_matches('/')
        != snapshot.settings.server_url.as_str().trim_end_matches('/')
        || !snapshot.settings_password.is_empty()
        || snapshot.settings_username != snapshot.settings.username;
    let save_label = if snapshot.settings_connecting {
        "Connecting…".to_owned()
    } else if url_changed || !snapshot.settings.configured {
        "Save and connect".to_owned()
    } else {
        "Save".to_owned()
    };
    let env_urls = snapshot.server_environments.clone();
    let active_env = env_urls.match_environment(&snapshot.settings_url);
    let mut show_password = use_signal(|| false);
    let mut current_tab = use_signal(|| 0_u8);
    #[cfg(test)]
    TEST_SETTINGS_TAB.with(|tab| tab.set(Some(current_tab)));
    let active_tab = *current_tab.read();

    // Keep each pane mounted when changing tabs. Remounting the EQ pane has
    // triggered a Blitz `invalid key` panic during template cloning.

    rsx! {
        div { class: "dialog-backdrop",
            section {
                class: "settings-dialog",
                role: "dialog",
                "aria-modal": "true",
                "aria-labelledby": "settings-title",
                tabindex: "0",
                autofocus: true,
                onkeydown: move |event: KeyboardEvent| {
                    if event.key() == Key::Escape && can_close {
                        event.stop_propagation();
                        app.write().settings_open = false;
                        app.write().settings_error = None;
                    }
                },
                header { class: "panel-header settings-header",
                    div {
                        p { class: "eyebrow", "Desktop client" }
                        h2 { id: "settings-title", "Settings" }
                        span { "Connection and appearance" }
                    }
                    if snapshot.settings.configured && !snapshot.settings_connecting {
                        IconButton {
                            label: "Close settings".to_owned(),
                            icon: IconName::Close,
                            class: "settings-close".to_owned(),
                            onclick: move |_| {
                                app.write().settings_open = false;
                                app.write().settings_error = None;
                            }
                        }
                    }
                }
                div { class: "settings-tabs", role: "tablist",
                    for (tab_id, label, icon) in [
                        (0_u8, "Account", IconName::User),
                        (1_u8, "Appearance", IconName::Sun),
                        (2_u8, "EQ", IconName::Sliders),
                    ] {
                        button {
                            key: "{tab_id}",
                            r#type: "button",
                            role: "tab",
                            class: if active_tab == tab_id { "settings-tab-btn active" } else { "settings-tab-btn" },
                            "aria-selected": "{active_tab == tab_id}",
                            onclick: move |_| current_tab.set(tab_id),
                            Icon { name: icon }
                            span { class: "settings-tab-label", "{label}" }
                        }
                    }
                }
                div { class: "settings-content",
                    if let Some(err) = snapshot.settings_error.as_ref() {
                        div { class: "settings-error-callout", role: "alert",
                            Icon { name: IconName::Close, class: "settings-error-icon".to_owned() }
                            div { class: "settings-error-text",
                                strong { "Server Connection Failed" }
                                span { "{err}" }
                            }
                        }
                    }
                    div { class: if active_tab == 0 { "settings-pane active" } else { "settings-pane" },
                        div { class: "field",
                            span { "Server URL" }
                            EnvironmentToggle {
                                value: active_env,
                                urls: env_urls,
                                onchange: move |env| {
                                    let url = app.read().server_environments.url_for(env).to_owned();
                                    app.write().settings_url = url;
                                    app.write().settings_error = None;
                                }
                            }
                        }
                        label { class: "field",
                            span { "Username" }
                            Input {
                                input_type: "text".to_owned(),
                                value: snapshot.settings_username.clone(),
                                placeholder: "Account username".to_owned(),
                                oninput: move |event: FormEvent| {
                                    app.write().settings_username = event.value();
                                    app.write().settings_error = None;
                                }
                            }
                        }
                        div { class: "field",
                            div { class: "field-header",
                                span { "Password" }
                                button {
                                    class: "password-toggle-btn",
                                    r#type: "button",
                                    title: if *show_password.read() { "Hide password" } else { "Show password" },
                                    onclick: move |_| {
                                        let current = *show_password.read();
                                        show_password.set(!current);
                                    },
                                    Icon {
                                        name: if *show_password.read() { IconName::EyeOff } else { IconName::Eye },
                                        class: "password-toggle-icon".to_owned(),
                                    }
                                    span {
                                        if *show_password.read() { "Hide" } else { "Show" }
                                    }
                                }
                            }
                            Input {
                                input_type: if *show_password.read() { "text".to_owned() } else { "password".to_owned() },
                                value: snapshot.settings_password.clone(),
                                placeholder: "Enter account password".to_owned(),
                                oninput: move |event: FormEvent| {
                                    app.write().settings_password = event.value();
                                    app.write().settings_error = None;
                                }
                            }
                            small { "Enter a password to log in, or leave it blank to reuse this device's session." }
                        }
                    }
                    div { class: if active_tab == 1 { "settings-pane active" } else { "settings-pane" },
                        div { class: "field",
                            span { "Appearance" }
                            ThemeToggle {
                                value: snapshot.settings.color_scheme,
                                onchange: move |scheme| set_color_scheme(app, scheme)
                            }
                            small { "Use your desktop preference or choose a fixed theme." }
                        }
                    }
                    div { class: if active_tab == 2 { "settings-pane active" } else { "settings-pane" },
                        EqualizerPanel {
                            eq: snapshot.settings.eq.clone(),
                            onchange: move |eq: EqSettings| {
                                let (store, settings) = {
                                    let mut state = app.write();
                                    state.settings.eq = eq.clone();
                                    (state.store.clone(), state.settings.clone())
                                };
                                let _ = store.save(&settings);
                                if let Some(engine_sig) = engine {
                                    if let Some(eng) = engine_sig.read().as_ref() {
                                        eng.set_eq(&eq);
                                    }
                                }
                            }
                        }
                    }
                }
                footer { class: "dialog-actions",
                    Button {
                        label: "Cancel".to_owned(),
                        class: "secondary".to_owned(),
                        disabled: !snapshot.settings.configured || snapshot.settings_connecting,
                        onclick: move |_| {
                            app.write().settings_open = false;
                            app.write().settings_error = None;
                        }
                    }
                    Button {
                        label: save_label,
                        class: "primary".to_owned(),
                        disabled: snapshot.settings_connecting,
                        onclick: move |_| save_settings(app)
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use blitz_dom::Document;

    #[test]
    fn settings_tabs_mount_eq_before_login_without_invalid_nodes() {
        fn harness() -> Element {
            let app = use_signal(|| {
                let mut state = NativeApp::boot();
                state.settings.configured = false;
                state.client = None;
                state.library.access = AccessView::FirstRun;
                state
            });
            rsx! { SettingsDialog { app } }
        }

        let vdom = dioxus_core::VirtualDom::new(harness);
        let mut document = dioxus_native::DioxusDocument::new(vdom, Default::default());
        document.initial_build();

        for target in [2_u8, 1, 0, 2, 0] {
            TEST_SETTINGS_TAB.with(|tab| tab.get().expect("settings tab signal").set(target));
            assert!(document.poll(None), "tab {target} did not render");

            let mut active_panes = 0;
            let mut total_panes = 0;
            let mut active_text = String::new();
            document.inner.visit(|_, node| {
                let Some(element) = node.element_data() else {
                    return;
                };
                if let Some(class) = element.attrs.iter().find(|attribute| {
                    attribute.name.local.as_ref() == "class"
                        && attribute.value.starts_with("settings-pane")
                }) {
                    total_panes += 1;
                    if class.value == "settings-pane active" {
                        active_panes += 1;
                        active_text = node.text_content();
                    }
                }
            });
            assert_eq!(total_panes, 3, "all settings panes must stay mounted");
            assert_eq!(active_panes, 1, "tab {target} must have one active pane");
            let expected = match target {
                0 => "Server URL",
                1 => "Appearance",
                2 => "Audio Equalizer",
                _ => unreachable!(),
            };
            assert!(
                active_text.contains(expected),
                "tab {target} is not visible"
            );
        }
        TEST_SETTINGS_TAB.with(|tab| tab.set(None));
    }
}

#[component]
pub(crate) fn ConnectionErrorDialog(
    app: Signal<NativeApp>,
    server_url: String,
    error: String,
) -> Element {
    rsx! {
        div { class: "dialog-backdrop",
            section {
                class: "settings-dialog connection-error-dialog",
                role: "alertdialog",
                "aria-modal": "true",
                "aria-labelledby": "connection-error-title",
                "aria-describedby": "connection-error-description",
                tabindex: "0",
                autofocus: true,
                header { class: "panel-header settings-header",
                    div {
                        p { class: "eyebrow", "Desktop client" }
                        h2 { id: "connection-error-title", "Cannot Connect to Server" }
                        span { "Connection failed" }
                    }
                }
                div { class: "settings-content",
                    div { class: "settings-error-callout", role: "alert",
                        Icon { name: IconName::Close, class: "settings-error-icon".to_owned() }
                        div { class: "settings-error-text",
                            strong { "Unable to reach server" }
                            span {
                                id: "connection-error-description",
                                "Unable to reach server at '{server_url}': {error}. Make sure the server is running, the host and port are correct, and network access is available."
                            }
                        }
                    }
                }
                footer { class: "dialog-actions",
                    Button {
                        label: "Edit Server in Settings".to_owned(),
                        class: "secondary".to_owned(),
                        onclick: move |_| {
                            let current_url = app.read().settings.server_url.to_string();
                            app.write().settings_url = current_url;
                            app.write().settings_error = None;
                            app.write().settings_open = true;
                        }
                    }
                    Button {
                        label: "Retry Connection".to_owned(),
                        class: "primary".to_owned(),
                        onclick: move |_| refresh(app)
                    }
                }
            }
        }
    }
}
