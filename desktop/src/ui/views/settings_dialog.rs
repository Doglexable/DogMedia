use dioxus_native::prelude::*;

use super::super::*;

#[component]
pub(crate) fn SettingsDialog(app: Signal<NativeApp>) -> Element {
    let snapshot = app.read().clone();
    let url_changed = snapshot.settings_url.trim().trim_end_matches('/')
        != snapshot.settings.server_url.as_str().trim_end_matches('/');
    let save_label = if snapshot.settings_connecting {
        "Connecting…".to_owned()
    } else if url_changed || !snapshot.settings.configured {
        "Save and connect".to_owned()
    } else {
        "Save".to_owned()
    };

    let can_close = snapshot.settings.configured && !snapshot.settings_connecting;

    rsx! {
        DialogContent {
            class: "settings-dialog".to_string(),
            show_close_button: false,
            close_on_backdrop_click: can_close,
            close_on_escape: can_close,
            onclose: move |_| {
                if can_close {
                    app.write().settings_open = false;
                    app.write().settings_error = None;
                }
            },
            DialogHeader {
                class: "panel-header settings-header".to_string(),
                div {
                    p { class: "eyebrow", "Desktop client" }
                    DialogTitle { id: "settings-title".to_string(), "Settings" }
                    DialogDescription { "Connection and appearance" }
                }
                if can_close {
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
            DialogBody {
                class: "settings-content".to_string(),
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
            DialogFooter {
                class: "dialog-actions".to_string(),
                DialogClose {
                    disabled: !can_close,
                    onclick: move |_| {
                        app.write().settings_open = false;
                        app.write().settings_error = None;
                    },
                    "Cancel"
                }
                DialogAction {
                    disabled: snapshot.settings_connecting,
                    onclick: move |_| save_settings(app),
                    "{save_label}"
                }
            }
        }
    }
}
