use dioxus_native::prelude::*;

use super::super::*;

#[component]
pub(crate) fn SettingsDialog(app: Signal<NativeApp>) -> Element {
    let snapshot = app.read();
    let can_close = snapshot.settings.configured && !snapshot.settings_connecting;
    let url_changed = snapshot.settings_url.trim().trim_end_matches('/')
        != snapshot.settings.server_url.as_str().trim_end_matches('/');
    let save_label = if snapshot.settings_connecting {
        "Connecting…".to_owned()
    } else if url_changed || !snapshot.settings.configured {
        "Save and connect".to_owned()
    } else {
        "Save".to_owned()
    };

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
                    label { class: "field",
                        span { "Server URL" }
                        Input {
                            input_type: "url".to_owned(),
                            value: snapshot.settings_url.clone(),
                            placeholder: "http://127.0.0.1:3001/".to_owned(),
                            oninput: move |event: FormEvent| {
                                app.write().settings_url = event.value();
                                app.write().settings_error = None;
                            }
                        }
                        small { "Dogmedia backend origin (e.g. http://127.0.0.1:3001/ or https://stream.example.com/)." }
                    }
                    label { class: "check-row",
                        input {
                            r#type: "checkbox",
                            checked: snapshot.allow_http,
                            onchange: move |event| {
                                app.write().allow_http = event.checked();
                                app.write().settings_error = None;
                            }
                        }
                        span {
                            strong { "Trust plain HTTP for a remote server" }
                            small { "Private LAN and loopback addresses are recognized automatically. Enable this only for a public host you control." }
                        }
                    }
                    div { class: "field",
                        span { "Appearance" }
                        ThemeToggle {
                            value: snapshot.settings.color_scheme,
                            onchange: move |scheme| set_color_scheme(app, scheme)
                        }
                        small { "Use your desktop preference or choose a fixed theme." }
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
