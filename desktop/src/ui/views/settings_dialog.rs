use dioxus_native::prelude::*;

use super::super::*;

#[component]
pub(crate) fn SettingsDialog(app: Signal<NativeApp>) -> Element {
    let snapshot = app.read().clone();
    rsx! {
        div { class: "dialog-backdrop",
            section { class: "settings-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "settings-title",
                header { class: "panel-header",
                    div {
                        p { class: "eyebrow", "Desktop client" }
                        h2 { id: "settings-title", "Settings" }
                        span { "Connection and appearance" }
                    }
                    if snapshot.settings.configured {
                        IconButton { label: "Close settings".to_owned(), icon: IconName::Close, onclick: move |_| app.write().settings_open = false }
                    }
                }
                div { class: "settings-content",
                    label { class: "field",
                        span { "Server URL" }
                        Input {
                            input_type: "url".to_owned(),
                            value: snapshot.settings_url.clone(),
                            placeholder: "http://127.0.0.1:3001/".to_owned(),
                            oninput: move |event: FormEvent| app.write().settings_url = event.value()
                        }
                        small { "The Dogmedia server this desktop connects to." }
                    }
                    label { class: "check-row",
                        input {
                            r#type: "checkbox",
                            checked: snapshot.allow_http,
                            onchange: move |event| app.write().allow_http = event.checked()
                        }
                        span {
                            strong { "Trust plain HTTP on this LAN" }
                            small { "Enable only for a server you control on the local network." }
                        }
                    }
                    label { class: "field",
                        span { "Appearance" }
                        ThemeToggle {
                            value: snapshot.settings.color_scheme,
                            onchange: move |scheme| app.write().settings.color_scheme = scheme
                        }
                        small { "Use your desktop preference or choose a fixed theme." }
                    }
                }
                footer { class: "dialog-actions",
                    Button {
                        label: "Cancel".to_owned(),
                        class: "secondary".to_owned(),
                        disabled: !snapshot.settings.configured,
                        onclick: move |_| app.write().settings_open = false
                    }
                    Button { label: "Save and connect".to_owned(), class: "primary".to_owned(), onclick: move |_| save_settings(app) }
                }
            }
        }
    }
}
