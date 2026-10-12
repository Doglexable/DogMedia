use dioxus_native::prelude::*;

use super::kit::{Icon, IconName};

/* ========================================================== */
/*                     CONTEXTS                               */
/* ========================================================== */

#[derive(Clone, Copy)]
pub struct MenubarContext {
    pub active_menu: Signal<Option<String>>,
}

#[derive(Clone)]
pub struct MenubarMenuContext {
    pub menu_id: String,
}

#[derive(Clone)]
struct MenubarRadioContext<T: Clone + PartialEq + 'static> {
    current: T,
    onchange: EventHandler<T>,
}

#[derive(Clone, Copy)]
struct MenubarSubContext {
    is_sub_open: Signal<bool>,
}

/* ========================================================== */
/*                     MENUBAR ROOT                           */
/* ========================================================== */

#[component]
pub fn Menubar(
    #[props(default)] class: String,
    children: Element,
) -> Element {
    let mut active_menu = use_signal(|| None::<String>);
    provide_context(MenubarContext { active_menu });

    let is_any_open = active_menu.read().is_some();

    rsx! {
        div {
            class: "menubar {class}",
            "data-name": "Menubar",
            role: "menubar",
            {children}
            if is_any_open {
                div {
                    class: "menubar-backdrop",
                    "aria-hidden": "true",
                    onclick: move |event: MouseEvent| {
                        event.stop_propagation();
                        active_menu.set(None);
                    },
                }
            }
        }
    }
}

/* ========================================================== */
/*                     MENUBAR MENU                           */
/* ========================================================== */

#[component]
pub fn MenubarMenu(
    #[props(default)] id: Option<String>,
    #[props(default)] class: String,
    children: Element,
) -> Element {
    let menu_id = use_hook(|| {
        id.unwrap_or_else(|| {
            static COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(1);
            format!("menubar-menu-{}", COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed))
        })
    });

    provide_context(MenubarMenuContext { menu_id });

    rsx! {
        div {
            class: "menubar-menu {class}",
            "data-name": "MenubarMenu",
            role: "none",
            {children}
        }
    }
}

/* ========================================================== */
/*                     MENUBAR TRIGGER                        */
/* ========================================================== */

#[component]
pub fn MenubarTrigger(
    #[props(default)] class: String,
    children: Element,
) -> Element {
    let menubar_ctx = use_context::<MenubarContext>();
    let menu_ctx = use_context::<MenubarMenuContext>();
    let mut active_menu = menubar_ctx.active_menu;
    let menu_id = menu_ctx.menu_id.clone();
    let is_open = active_menu.read().as_ref() == Some(&menu_id);

    let id_for_click = menu_id.clone();
    let id_for_hover = menu_id.clone();

    rsx! {
        button {
            class: if is_open { "menubar-trigger active {class}" } else { "menubar-trigger {class}" },
            "data-name": "MenubarTrigger",
            r#type: "button",
            role: "menuitem",
            "aria-haspopup": "menu",
            "aria-expanded": is_open,
            onclick: move |event: MouseEvent| {
                event.stop_propagation();
                if is_open {
                    active_menu.set(None);
                } else {
                    active_menu.set(Some(id_for_click.clone()));
                }
            },
            onmouseenter: move |_| {
                if active_menu.read().is_some() {
                    active_menu.set(Some(id_for_hover.clone()));
                }
            },
            {children}
        }
    }
}

/* ========================================================== */
/*                     MENUBAR CONTENT                        */
/* ========================================================== */

#[component]
pub fn MenubarContent(
    #[props(default)] class: String,
    children: Element,
) -> Element {
    let menubar_ctx = use_context::<MenubarContext>();
    let menu_ctx = use_context::<MenubarMenuContext>();
    let is_open = menubar_ctx.active_menu.read().as_ref() == Some(&menu_ctx.menu_id);

    if !is_open {
        return rsx! {};
    }

    rsx! {
        div {
            class: "menubar-content {class}",
            "data-name": "MenubarContent",
            role: "menu",
            onclick: move |event: MouseEvent| event.stop_propagation(),
            {children}
        }
    }
}

/* ========================================================== */
/*                     MENUBAR GROUP                          */
/* ========================================================== */

#[component]
pub fn MenubarGroup(
    #[props(default)] class: String,
    children: Element,
) -> Element {
    rsx! {
        div {
            class: "menubar-group {class}",
            "data-name": "MenubarGroup",
            role: "group",
            {children}
        }
    }
}

/* ========================================================== */
/*                     MENUBAR ITEM                           */
/* ========================================================== */

#[component]
pub fn MenubarItem(
    #[props(default)] class: String,
    #[props(default)] disabled: bool,
    #[props(default)] onclick: Option<EventHandler<MouseEvent>>,
    children: Element,
) -> Element {
    let menubar_ctx = use_context::<MenubarContext>();
    let mut active_menu = menubar_ctx.active_menu;

    rsx! {
        button {
            class: if disabled { "menubar-item disabled {class}" } else { "menubar-item {class}" },
            "data-name": "MenubarItem",
            r#type: "button",
            role: "menuitem",
            disabled,
            onclick: move |event: MouseEvent| {
                event.stop_propagation();
                if !disabled {
                    active_menu.set(None);
                    if let Some(ref handler) = onclick {
                        handler.call(event);
                    }
                }
            },
            {children}
        }
    }
}

/* ========================================================== */
/*                     MENUBAR SHORTCUT                       */
/* ========================================================== */

#[component]
pub fn MenubarShortcut(
    #[props(default)] class: String,
    children: Element,
) -> Element {
    rsx! {
        span {
            class: "menubar-shortcut {class}",
            "data-slot": "menubar-shortcut",
            "aria-hidden": "true",
            {children}
        }
    }
}

/* ========================================================== */
/*                     MENUBAR SEPARATOR                      */
/* ========================================================== */

#[component]
pub fn MenubarSeparator(
    #[props(default)] class: String,
) -> Element {
    rsx! {
        div {
            class: "menubar-separator {class}",
            role: "separator",
        }
    }
}

/* ========================================================== */
/*                     MENUBAR LABEL                          */
/* ========================================================== */

#[component]
pub fn MenubarLabel(
    #[props(default)] class: String,
    children: Element,
) -> Element {
    rsx! {
        div {
            class: "menubar-label {class}",
            "data-name": "MenubarLabel",
            {children}
        }
    }
}

/* ========================================================== */
/*                     CHECKBOX ITEM                          */
/* ========================================================== */

#[component]
pub fn MenubarCheckboxItem(
    #[props(default)] class: String,
    #[props(default)] disabled: bool,
    checked: bool,
    #[props(default)] onchange: Option<EventHandler<bool>>,
    children: Element,
) -> Element {
    let menubar_ctx = use_context::<MenubarContext>();
    let mut active_menu = menubar_ctx.active_menu;

    rsx! {
        button {
            class: if disabled { "menubar-checkbox-item disabled {class}" } else { "menubar-checkbox-item {class}" },
            "data-name": "MenubarCheckboxItem",
            r#type: "button",
            role: "menuitemcheckbox",
            "aria-checked": checked,
            disabled,
            onclick: move |event: MouseEvent| {
                event.stop_propagation();
                if !disabled {
                    let next = !checked;
                    active_menu.set(None);
                    if let Some(ref handler) = onchange {
                        handler.call(next);
                    }
                }
            },
            span {
                class: "menubar-indicator",
                "aria-hidden": "true",
                if checked {
                    Icon { name: IconName::Check, class: "indicator-icon".to_owned() }
                }
            }
            {children}
        }
    }
}

/* ========================================================== */
/*                     RADIO GROUP & ITEM                     */
/* ========================================================== */

#[component]
pub fn MenubarRadioGroup<T: Clone + PartialEq + 'static>(
    value: T,
    onchange: EventHandler<T>,
    children: Element,
) -> Element {
    provide_context(MenubarRadioContext { current: value, onchange });

    rsx! {
        div {
            class: "menubar-radio-group",
            "data-name": "MenubarRadioGroup",
            role: "group",
            {children}
        }
    }
}

#[component]
pub fn MenubarRadioItem<T: Clone + PartialEq + 'static>(
    value: T,
    #[props(default)] class: String,
    #[props(default)] disabled: bool,
    children: Element,
) -> Element {
    let ctx = use_context::<MenubarRadioContext<T>>();
    let menubar_ctx = use_context::<MenubarContext>();
    let mut active_menu = menubar_ctx.active_menu;
    let is_selected = ctx.current == value;
    let target = value.clone();
    let onchange = ctx.onchange;

    rsx! {
        button {
            class: if disabled { "menubar-radio-item disabled {class}" } else { "menubar-radio-item {class}" },
            "data-name": "MenubarRadioItem",
            r#type: "button",
            role: "menuitemradio",
            "aria-checked": is_selected,
            disabled,
            onclick: move |event: MouseEvent| {
                event.stop_propagation();
                if !disabled {
                    active_menu.set(None);
                    onchange.call(target.clone());
                }
            },
            span {
                class: "menubar-indicator",
                "aria-hidden": "true",
                if is_selected {
                    Icon { name: IconName::Check, class: "indicator-icon".to_owned() }
                }
            }
            {children}
        }
    }
}

/* ========================================================== */
/*                     SUBMENU                                */
/* ========================================================== */

#[component]
pub fn MenubarSub(
    #[props(default)] class: String,
    children: Element,
) -> Element {
    let mut is_sub_open = use_signal(|| false);
    provide_context(MenubarSubContext { is_sub_open });

    rsx! {
        div {
            class: "menubar-sub {class}",
            "data-name": "MenubarSub",
            onmouseleave: move |_| is_sub_open.set(false),
            {children}
        }
    }
}

#[component]
pub fn MenubarSubTrigger(
    #[props(default)] class: String,
    children: Element,
) -> Element {
    let mut sub_ctx = use_context::<MenubarSubContext>();
    let is_open = *sub_ctx.is_sub_open.read();

    rsx! {
        button {
            class: if is_open { "menubar-sub-trigger active {class}" } else { "menubar-sub-trigger {class}" },
            "data-name": "MenubarSubTrigger",
            r#type: "button",
            role: "menuitem",
            "aria-haspopup": "menu",
            "aria-expanded": is_open,
            onclick: move |event: MouseEvent| {
                event.stop_propagation();
                sub_ctx.is_sub_open.set(!is_open);
            },
            onmouseenter: move |_| {
                sub_ctx.is_sub_open.set(true);
            },
            span { class: "menubar-sub-trigger-label", {children} }
            Icon { name: IconName::ChevronRight, class: "menubar-sub-chevron".to_owned() }
        }
    }
}

#[component]
pub fn MenubarSubContent(
    #[props(default)] class: String,
    children: Element,
) -> Element {
    let sub_ctx = use_context::<MenubarSubContext>();
    let is_open = *sub_ctx.is_sub_open.read();

    if !is_open {
        return rsx! {};
    }

    rsx! {
        div {
            class: "menubar-sub-content {class}",
            "data-name": "MenubarSubContent",
            role: "menu",
            onclick: move |event: MouseEvent| event.stop_propagation(),
            {children}
        }
    }
}

#[component]
pub fn MenubarSubItem(
    #[props(default)] class: String,
    #[props(default)] disabled: bool,
    #[props(default)] onclick: Option<EventHandler<MouseEvent>>,
    children: Element,
) -> Element {
    let menubar_ctx = use_context::<MenubarContext>();
    let mut sub_ctx = use_context::<MenubarSubContext>();
    let mut active_menu = menubar_ctx.active_menu;

    rsx! {
        button {
            class: if disabled { "menubar-sub-item disabled {class}" } else { "menubar-sub-item {class}" },
            "data-name": "MenubarSubItem",
            r#type: "button",
            role: "menuitem",
            disabled,
            onclick: move |event: MouseEvent| {
                event.stop_propagation();
                if !disabled {
                    sub_ctx.is_sub_open.set(false);
                    active_menu.set(None);
                    if let Some(ref handler) = onclick {
                        handler.call(event);
                    }
                }
            },
            {children}
        }
    }
}
